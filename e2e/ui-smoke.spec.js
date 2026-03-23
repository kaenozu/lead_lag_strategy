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
});
