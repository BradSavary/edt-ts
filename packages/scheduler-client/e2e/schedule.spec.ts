import { test, expect } from '@playwright/test';

test.describe('SchedulePage', () => {
  test('loads and displays the planning form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Planification' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer' })).toBeVisible();
  });

  test('displays result after mocked API submission', async ({ page }) => {
    await page.route('/api/schedule', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isComplete: true,
          scheduledCount: 3,
          conflictCount: 0,
          solutions: [],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Planification' })).toBeVisible();
    // TODO: fill form inputs and submit when test fixtures are ready
  });
});
