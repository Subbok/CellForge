import { test, expect } from '@playwright/test';

const USERNAME = process.env.CELLFORGE_USER ?? 'suddoku';
const PASSWORD = process.env.CELLFORGE_PASS ?? 'changeme';

test.describe('Authentication', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'CellForge' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong credentials shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Username' }).fill('wronguser');
    await page.getByRole('textbox', { name: 'Password' }).fill('wrongpass');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // error message or still on login page
    await expect(page).toHaveURL('/');
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // should see dashboard buttons
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible({ timeout: 5000 });
  });
});
