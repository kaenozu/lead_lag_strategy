'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const signalFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'signal-response.json'), 'utf8')
);

const artifactsDir = path.join(__dirname, '..', 'e2e-artifacts');

test.describe('本番 UI（静的 + API モック）', () => {
  test.beforeAll(() => {
    fs.mkdirSync(artifactsDir, { recursive: true });
  });

  test('本日の売買候補が表示されスクリーンショットを保存する', async ({ page }) => {
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

    await page.goto('/');

    await expect(page.getByRole('heading', { name: /本日の売買候補/ })).toBeVisible();

    await expect(page.locator('#todaySummary')).toBeVisible();
    await expect(page.locator('#todaySummary')).toContainText('今日買い候補');
    await expect(page.locator('#todaySummary')).toContainText('1617.T');
    await expect(page.locator('#todaySummary')).toContainText('今日売り候補');
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
