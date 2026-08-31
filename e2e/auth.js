export const E2E_PASSWORD = 'The e2e scriptorium passphrase';
const SETUP_CODE = 'E2E-SETUP-CODE';

export async function openUnlocked(page, target = '/') {
  await page.goto(target);
  await page.waitForFunction(() =>
    document.querySelector('#authSetupForm') ||
    document.querySelector('#authLoginForm') ||
    !document.body.classList.contains('st-gated')
  );

  if (await page.locator('#authSetupForm').count()) {
    await page.fill('#authSetupCode', SETUP_CODE);
    await page.fill('#authNewPassword', E2E_PASSWORD);
    await page.fill('#authConfirmPassword', E2E_PASSWORD);
    await page.locator('#authSetupForm button[type="submit"]').click();
  } else if (await page.locator('#authLoginForm').count()) {
    await page.fill('#authPassword', E2E_PASSWORD);
    await page.locator('#authLoginForm button[type="submit"]').click();
  }

  await page.waitForFunction(() => !document.body.classList.contains('st-gated'));
  await page.waitForSelector('.container', { state: 'visible' });
}

export async function csrfToken(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok || !body.csrf_token) throw new Error('No authenticated CSRF token');
    return body.csrf_token;
  });
}

export async function apiPost(page, path, data) {
  return page.request.post(path, {
    data,
    headers: { 'X-ScribeTribe-CSRF': await csrfToken(page) },
  });
}
