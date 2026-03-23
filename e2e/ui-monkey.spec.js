'use strict';

/**
 * 画面モンキーテスト: ランダム操作で JS 例外・致命的な UI 崩れが出ないことを確認する。
 * API はモック（ネットワーク・Yahoo 非依存）。
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const signalFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'signal-response.json'), 'utf8')
);
const backtestFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'backtest-response.json'), 'utf8')
);

const disclosureBody = JSON.stringify({
  short: 'E2E',
  lines: ['line1']
});

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function safeClick(locator, opts = {}) {
  const timeout = opts.timeout ?? 2000;
  try {
    await locator.click({ timeout });
  } catch {
    /* モーダル未表示など */
  }
}

/** ヘルプモーダルが開いていると背面ボタンが取れないため、必要な操作の前だけ閉じる */
async function dismissHelpModalIfOpen(page) {
  const closeBtn = page.locator('#helpModal.active .modal-close');
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ timeout: 3000 });
  }
}

const MONKEY_ACTIONS_NEED_CLEAR_UI = new Set([
  'tab_all',
  'tab_buy',
  'tab_sell',
  'signal',
  'backtest',
  'export',
  'scroll',
  'fill_window',
  'fill_lambda',
  'fill_quantile',
  'click_banner'
]);

async function setupApiMocks(page) {
  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        windowLength: 60,
        nFactors: 3,
        lambdaReg: 0.9,
        quantile: 0.4,
        disclosure: JSON.parse(disclosureBody)
      })
    });
  });

  await page.route('**/api/disclosure', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: disclosureBody
    });
  });

  await page.route('**/api/signal', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(signalFixture)
    });
  });

  await page.route('**/api/backtest', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(backtestFixture)
    });
  });
}

test.describe('UI モンキーテスト（API モック）', () => {
  test('ランダム操作でページが生存し致命的エラーがない', async ({ page }) => {
    test.setTimeout(120000);

    const seed = parseInt(process.env.MONKEY_SEED || '42', 10);
    const rand = mulberry32(seed);

    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('dialog', (d) => d.dismiss());

    await setupApiMocks(page);
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('リードラグ');

    await page.waitForFunction(() => {
      const el = document.getElementById('signalContent');
      return el && !el.querySelector('.loading');
    }, { timeout: 15000 });

    const pick = (arr) => arr[Math.floor(rand() * arr.length)];

    for (let i = 0; i < 45; i++) {
      const action = pick([
        'help_open',
        'help_close_overlay',
        'help_close_x',
        'tab_all',
        'tab_buy',
        'tab_sell',
        'signal',
        'backtest',
        'export',
        'scroll',
        'fill_window',
        'fill_lambda',
        'fill_quantile',
        'click_banner'
      ]);

      try {
        if (MONKEY_ACTIONS_NEED_CLEAR_UI.has(action)) {
          await dismissHelpModalIfOpen(page);
        }

        switch (action) {
        case 'help_open':
          await safeClick(page.locator('#helpBtn'));
          break;
        case 'help_close_overlay':
          if (await page.locator('#helpModal.active').isVisible()) {
            await page.locator('#helpModal').click({ position: { x: 5, y: 5 } });
          }
          break;
        case 'help_close_x':
          if (await page.locator('#helpModal.active').isVisible()) {
            await safeClick(page.locator('.modal-close'));
          }
          break;
        case 'tab_all':
          await page.locator('.tab[data-tab="all"]').click();
          break;
        case 'tab_buy':
          await page.locator('.tab[data-tab="buy"]').click();
          break;
        case 'tab_sell':
          await page.locator('.tab[data-tab="sell"]').click();
          break;
        case 'signal':
          await page.locator('#generateSignalBtn').click();
          await page.waitForTimeout(80);
          break;
        case 'backtest':
          await page.locator('#runBacktestBtn').click();
          await page.waitForTimeout(120);
          break;
        case 'export':
          await safeClick(page.locator('#exportCsvBtn'));
          break;
        case 'scroll':
          await page.mouse.wheel(0, pick([200, -150, 400, -200]));
          break;
        case 'fill_window':
          await page.locator('#windowLength').fill(String(20 + Math.floor(rand() * 180)));
          break;
        case 'fill_lambda':
          await page.locator('#lambdaReg').fill((rand()).toFixed(2));
          break;
        case 'fill_quantile':
          await page.locator('#quantile').fill((0.1 + rand() * 0.39).toFixed(2));
          break;
        case 'click_banner':
          await page.locator('.disclosure-banner').click();
          break;
        default:
          break;
        }
      } catch (e) {
        throw new Error(`Monkey step ${i} action=${action}: ${e.message}`);
      }

      await page.waitForTimeout(20 + Math.floor(rand() * 60));
    }

    await expect(page.locator('body')).toBeVisible();
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toEqual([]);

    const badConsole = consoleErrors.filter(
      (t) =>
        !t.includes('Failed to load resource') &&
        !t.includes('net::ERR_')
    );
    expect(badConsole, `console.error: ${badConsole.join(' | ')}`).toEqual([]);
  });
});
