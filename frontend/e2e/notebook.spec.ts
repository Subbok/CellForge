import { test, expect, Page } from '@playwright/test';

const USERNAME = process.env.CELLFORGE_USER ?? 'suddoku';
const PASSWORD = process.env.CELLFORGE_PASS ?? 'changeme';

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible({ timeout: 5000 });
}

test.describe('Notebook dashboard', () => {
  test('dashboard shows file list and action buttons', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible();
  });

  test('New button opens dropdown with Notebook and Folder options', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByRole('button', { name: 'Notebook' })).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole('button', { name: 'Folder' })).toBeVisible();
  });

  test('create new notebook via New → Notebook → name modal', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'New' }).click();
    // click Notebook in dropdown
    await page.getByRole('button', { name: 'Notebook' }).click();
    // name modal appears
    await expect(page.getByRole('heading', { name: 'New notebook' })).toBeVisible({ timeout: 3000 });
    // submit with default name
    await page.getByRole('textbox').last().press('Enter');
    // modal closes, file list refreshes
    await expect(page.getByRole('heading', { name: 'New notebook' })).not.toBeVisible({ timeout: 3000 });
  });

  test('opening a notebook shows kernel picker', async ({ page }) => {
    await login(page);
    // click first .ipynb notebook in list
    const notebooks = page.locator('button').filter({ hasText: '.ipynb' });
    await expect(notebooks.first()).toBeVisible({ timeout: 3000 });
    await notebooks.first().click();
    await expect(page.getByRole('heading', { name: 'Select a kernel' })).toBeVisible({ timeout: 5000 });
  });

  test('kernel picker has Refresh and Cancel buttons', async ({ page }) => {
    await login(page);
    const notebooks = page.locator('button').filter({ hasText: '.ipynb' });
    await notebooks.first().click();
    await expect(page.getByRole('heading', { name: 'Select a kernel' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('kernel picker cancel returns to dashboard', async ({ page }) => {
    await login(page);
    const notebooks = page.locator('button').filter({ hasText: '.ipynb' });
    await notebooks.first().click();
    await expect(page.getByRole('heading', { name: 'Select a kernel' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible({ timeout: 3000 });
  });

  test('open notebook without kernel goes to editor', async ({ page }) => {
    await login(page);
    const notebooks = page.locator('button').filter({ hasText: '.ipynb' });
    await notebooks.first().click();
    await expect(page.getByRole('heading', { name: 'Select a kernel' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Open without kernel' }).click();
    await expect(page).toHaveURL(/notebook/);
  });
});

test.describe('Kernel picker', () => {
  test('refresh button works without error', async ({ page }) => {
    await login(page);
    const notebooks = page.locator('button').filter({ hasText: '.ipynb' });
    await notebooks.first().click();
    await expect(page.getByRole('heading', { name: 'Select a kernel' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Refresh' }).click();
    // list reloads — heading should still be visible after refresh
    await expect(page.getByRole('heading', { name: 'Select a kernel' })).toBeVisible({ timeout: 5000 });
  });
});
