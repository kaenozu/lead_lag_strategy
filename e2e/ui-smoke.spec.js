'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const signalFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'signal-response.json'), 'utf8')
);
const backtestFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'backtest-response.json'), 'utf8')
);

const artifactsDir = path.join(__dirname, '..', 'e2e-artifacts');

async function mockSidePanelApis(page) {
  await page.route('**/api/paper/verification', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ skipped: true, reason: 'e2e mock' })
    });
  });
  await page.route('**/api/walkforward/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, message: 'e2e mock' })
    });
  });
  await page.route('**/api/operating-rules', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ path: '/mock', rules: { customLines: [] } })
    });
  });

  await page.route('**/api/paper/order-csv', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      body: 'Side,Ticker,Qty,EstValue,RefPrice\nBUY,1617.T,100,100000,1000\n'
    });
  });
}

test.describe('本番 UI（静的 + API モック）', () => {
  test.beforeAll(() => {
    fs.mkdirSync(artifactsDir, { recursive: true });
  });

  test('今日の候補一覧が表示されスクリーンショットを保存する', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          windowLength: 60,
          nFactors: 3,
          lambdaReg: 0.9,
          quantile: 0.4
        })
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

    await mockSidePanelApis(page);

    await page.goto('/');

    await expect(page.getByRole('heading', { name: /今日の候補一覧/ })).toBeVisible();
    await page.getByRole('button', { name: /シグナル生成/ }).click();

    await expect(page.locator('#todaySummary')).toBeVisible();
    await expect(page.locator('#todaySummary')).toContainText('買い候補（強いと出ている業種のファンド）');
    await expect(page.locator('#todaySummary')).toContainText('1617.T');
    await expect(page.locator('#todaySummary')).toContainText('売り候補（弱いと出ている業種');
    await expect(page.locator('#todaySummary')).toContainText('1624.T');

    await expect(page.locator('.signal-table')).toBeVisible();
    await expect(page.locator('.signal-table tbody tr').first()).toBeVisible();

    const shotPath = path.join(artifactsDir, 'ui-smoke.png');
    await page.screenshot({ path: shotPath, fullPage: true });

    await test.info().attach('ui-smoke.png', {
      path: shotPath,
      contentType: 'image/png'
    });
  });

  test('時間外は起動時に自動取得せず案内メッセージを表示する', async ({ page }) => {
    await page.addInitScript(() => {
      const RealDate = Date;
      const fixedIso = '2026-03-22T12:00:00.000Z'; // JST 日曜 21:00（自動取得時間外）

      // eslint-disable-next-line no-global-assign
      Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(fixedIso);
            return;
          }
          super(...args);
        }

        static now() {
          return new RealDate(fixedIso).getTime();
        }
      };
    });

    let signalRequestCount = 0;
    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          windowLength: 60,
          nFactors: 3,
          lambdaReg: 0.9,
          quantile: 0.4
        })
      });
    });
    await page.route('**/api/signal', async (route) => {
      signalRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(signalFixture)
      });
    });

    await mockSidePanelApis(page);

    await page.goto('/');
    await expect(page.locator('#signalContent')).toContainText('時間外のため自動取得しません');
    await expect(page.locator('#signalCacheNote')).toContainText('起動時の自動実行は平日 8:45-8:55');
    await expect(page.locator('#todaySummary')).toBeHidden();
    expect(signalRequestCount).toBe(0);
  });
});
