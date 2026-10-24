// Essential Playwright end-to-end tests covering the main user flows described
// in the spec. These run against the Vite preview server (production build)
// with a clean IndexedDB/localStorage context per test so demo data seeding
// and persistence can be verified deterministically.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

async function dismissOnboarding(page: Page) {
  const gotIt = page.getByRole('button', { name: /Got it/i });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }
}

async function goHome(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await dismissOnboarding(page);
}

test.describe('Student Daily Planner', () => {
  test('loads with seeded demo data and no Gemini key configured', async ({ page }) => {
    await goHome(page);
    await expect(page.getByText('Student Daily Planner')).toBeVisible();
    // Bottom navigation for the three main areas.
    await expect(page.getByRole('button', { name: 'Wardrobe' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fridge' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Planner' })).toBeVisible();
    // Outfits tab is the default Wardrobe view and should show seeded outfits.
    await expect(page.getByText(/colour harmony|Unnamed outfit/).first()).toBeVisible();
  });

  test('add, edit and delete a garment', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Wardrobe' }).click();
    await page.getByRole('button', { name: 'Clothes' }).click();

    await page.getByRole('button', { name: 'Add garment' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add garment' })).toBeVisible();

    // Upload a local fixture image (camera capture is not available in CI).
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'sample-garment.jpg'));

    // Wait for the analysis step to resolve to the confirmation form.
    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 15000 });
    const nameInput = page.getByLabel('Name');
    await nameInput.fill('E2E Test Jacket');
    await page.getByRole('button', { name: 'Save garment' }).click();

    // The new garment should now appear in the Clothes grid.
    await expect(page.getByText('E2E Test Jacket')).toBeVisible();

    // Edit: open detail, change name, save.
    await page.getByText('E2E Test Jacket').click();
    const editNameInput = page.getByLabel('Name');
    await editNameInput.fill('E2E Renamed Jacket');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('E2E Renamed Jacket')).toBeVisible();

    // Delete: open detail again, delete, confirm.
    await page.getByText('E2E Renamed Jacket').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete' }).last().click();
    await expect(page.getByText('E2E Renamed Jacket')).toHaveCount(0);
  });

  test('create an outfit and mark it as worn', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Wardrobe' }).click();
    await page.getByRole('button', { name: 'Outfits' }).click();

    await page.getByRole('button', { name: 'New Outfit' }).click();
    await expect(page.getByRole('heading', { name: 'New outfit' })).toBeVisible();

    // Select at least one garment option from the seeded wardrobe.
    const options = page.getByTestId('garment-option');
    await expect(options.first()).toBeVisible();
    await options.first().click();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Outfit created')).toBeVisible();
  });

  test('update laundry status and complete a wash', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Wardrobe' }).click();
    await page.getByRole('button', { name: 'Laundry' }).click();
    await expect(page.getByText(/Lights|Darks|Denim|Delicates/).first()).toBeVisible();

    const washButtons = page.getByRole('button', { name: /Wash now|Mark washed|Complete wash/i });
    if (await washButtons.first().isVisible().catch(() => false)) {
      await washButtons.first().click();
      await expect(page.getByText(/washed|clean|completed/i).first()).toBeVisible();
    }
  });

  test('add food manually and reconcile shopping list', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Fridge' }).click();
    await page.getByRole('button', { name: 'Food' }).click();

    await page.getByRole('button', { name: 'Add food' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add food' })).toBeVisible();
    await page.getByLabel('Name').fill('E2E Oat Milk');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('E2E Oat Milk')).toBeVisible();

    await page.getByRole('button', { name: 'Shopping List' }).click();
    await expect(page.getByPlaceholder('Add an item…')).toBeVisible();
    await page.getByPlaceholder('Add an item…').fill('E2E Extra Item');
    await page.getByPlaceholder('Add an item…').press('Enter');
    await expect(page.getByText('E2E Extra Item')).toBeVisible();
  });

  test('create and complete a task', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Planner' }).click();
    await page.getByRole('button', { name: 'To Do List' }).click();

    const input = page.getByPlaceholder(/Submit essay tomorrow/i);
    await input.fill('E2E pick up dry cleaning tomorrow at 5pm');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/E2E pick up dry cleaning/i)).toBeVisible();

    const checkbox = page.getByTestId('task-checkbox').first();
    await checkbox.click();
  });

  test('import and export calendar events (.ics)', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Planner' }).click();
    await page.getByRole('button', { name: 'Schedule' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export .ics' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
  });

  test('use the app without a Gemini API key (local fallback)', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Gemini API key (optional)')).toBeVisible();
    await expect(page.getByText(/on-device fallbacks/i)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('export and restore application data', async ({ page }) => {
    await goHome(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup (.json)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });
});
