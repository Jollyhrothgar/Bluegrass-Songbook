import { test } from '@playwright/test';
test('dbg', async ({ page, context }) => {
  context.on('serviceworker', w => w.on('console', m => console.log('SW', m.text())));
  await page.goto('/#search');
  await page.waitForTimeout(3000);
  await page.reload();
  await page.waitForTimeout(3000);
});
