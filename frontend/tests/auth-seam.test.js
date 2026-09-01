import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';
import { jest } from '@jest/globals';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('single-owner authentication gate', () => {
  it('fails closed and loads no private API while first-run setup is required', async () => {
    mockFetch([
      { match: '/api/auth/status', response: jsonResponse(200, { state: 'setup-required' }) },
    ]);
    const fw = await loadScript({ realAuth: true });
    await tick();

    expect(fw.auth.mode).toBe('single-owner');
    expect(document.body.classList.contains('im-gated')).toBe(true);
    expect(document.getElementById('authSetupForm')).not.toBeNull();
    expect(document.getElementById('authSetupCode').autocomplete).toBe('one-time-code');
    expect(document.getElementById('authNewPassword').autocomplete).toBe('new-password');
    const passwordToggle = document.querySelector('[aria-controls="authNewPassword"]');
    passwordToggle.click();
    expect(document.getElementById('authNewPassword').type).toBe('text');
    expect(passwordToggle.textContent).toBe('Hide');
    expect(global.fetch.mock.calls.map(([url]) => String(url))).toEqual(['/api/auth/status']);
  });

  it('submits setup, checks confirmation locally, then starts protected loading', async () => {
    mockFetch([
      { match: '/api/auth/status', response: jsonResponse(200, { state: 'setup-required' }) },
      {
        match: '/api/auth/setup',
        response: jsonResponse(201, { state: 'unlocked', csrf_token: 'fresh-csrf', expires_at: 99 }),
      },
    ]);
    const fw = await loadScript({ realAuth: true });
    await tick();
    const form = document.getElementById('authSetupForm');
    document.getElementById('authSetupCode').value = 'CODE';
    document.getElementById('authNewPassword').value = 'A sufficiently long phrase';
    document.getElementById('authConfirmPassword').value = 'Not the same long phrase';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    expect(document.querySelector('.auth-error').textContent).toMatch(/do not match/);
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/auth/setup'))).toBe(false);

    document.getElementById('authConfirmPassword').value = 'A sufficiently long phrase';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();

    const setupCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/auth/setup'));
    expect(JSON.parse(setupCall[1].body)).toMatchObject({
      setup_code: 'CODE',
      password: 'A sufficiently long phrase',
      remember: true,
    });
    expect(document.body.classList.contains('im-gated')).toBe(false);
    expect(fw.auth.csrfToken).toBe('fresh-csrf');
    expect(global.fetch.mock.calls.some(([url]) => String(url) === '/api/worlds')).toBe(true);
  });

  it('keeps an unreachable status check sealed and offers a retry', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    await loadScript({ realAuth: true });
    await tick();
    expect(document.body.classList.contains('im-gated')).toBe(true);
    expect(document.getElementById('authTitle').textContent).toBe('The door will not answer');
    expect(document.querySelector('.auth-submit').textContent).toBe('Try again');
    expect(document.querySelector('.content-section.active')).toBeNull();
  });

  it('adds CSRF to mutations and locks immediately when an API session expires', async () => {
    let worldPosts = 0;
    mockFetch([
      {
        match: '/api/auth/status',
        response: jsonResponse(200, { state: 'unlocked', csrf_token: 'live-csrf', expires_at: 99 }),
      },
      {
        match: (url, options) => String(url) === '/api/worlds' && options?.method === 'POST',
        response: {
          ok: false,
          status: 401,
          json: () => {
            worldPosts++;
            return Promise.resolve({ error: 'Unlock Ink Morrow to continue.', state: 'locked', code: 'AUTH_REQUIRED' });
          },
        },
      },
    ]);
    const fw = await loadScript({ realAuth: true });
    await tick();
    await tick();
    await expect(fw.apiCall('/worlds', 'POST', { name: 'Blocked' })).rejects.toThrow(/Unlock/);

    const call = global.fetch.mock.calls.find(([url, options]) =>
      String(url) === '/api/worlds' && options?.method === 'POST');
    expect(call[1].headers['X-InkMorrow-CSRF']).toBe('live-csrf');
    expect(worldPosts).toBe(1);
    expect(document.body.classList.contains('im-gated')).toBe(true);
    expect(document.getElementById('authLoginForm')).not.toBeNull();
    expect(fw.state().worlds).toEqual([]);
  });

  it('sends the in-memory CSRF token when the owner presses Lock', async () => {
    mockFetch([
      {
        match: '/api/auth/status',
        response: jsonResponse(200, { state: 'unlocked', csrf_token: 'lock-csrf', expires_at: 99 }),
      },
      { match: '/api/auth/logout', response: jsonResponse(200, { state: 'locked' }) },
    ]);
    await loadScript({ realAuth: true });
    await tick();
    await tick();
    document.getElementById('lockBtn').click();
    await tick();

    const logout = global.fetch.mock.calls.find(([url]) => String(url).includes('/auth/logout'));
    expect(logout[1].headers['X-InkMorrow-CSRF']).toBe('lock-csrf');
    expect(document.body.classList.contains('im-gated')).toBe(true);
  });

  it('returns to first-run setup if the terminal recovery reset occurs mid-session', async () => {
    mockFetch([
      {
        match: '/api/auth/status',
        response: jsonResponse(200, { state: 'unlocked', csrf_token: 'old-csrf', expires_at: 99 }),
      },
      {
        match: (url, options) => String(url) === '/api/worlds' && options?.method === 'POST',
        response: jsonResponse(401, {
          error: 'Initial password setup is required.',
          code: 'AUTH_REQUIRED',
          state: 'setup-required',
        }),
      },
    ]);
    const fw = await loadScript({ realAuth: true });
    await expect(fw.apiCall('/worlds', 'POST', { name: 'After reset' })).rejects.toThrow(/setup is required/i);
    await tick();

    expect(document.body.classList.contains('im-gated')).toBe(true);
    expect(document.getElementById('authSetupForm')).not.toBeNull();
  });
});

describe('route gating under injected adapters', () => {
  it('a slow stale result cannot paint an older route over a newer one', async () => {
    let resolveFirst;
    let calls = 0;
    window.__imTestAuthAdapter = {
      mode: 'slow-test',
      status: () => {
        calls++;
        if (calls === 1) return new Promise((resolve) => { resolveFirst = () => resolve({ state: 'unlocked' }); });
        return Promise.resolve({ state: 'unlocked' });
      },
      subscribe: () => () => {},
    };
    try {
      mockFetch();
      await loadScript();
      document.getElementById('writeBtn').click();
      resolveFirst();
      await tick();
      await tick();
      expect(document.getElementById('writeSection').classList.contains('active')).toBe(true);
      expect(document.getElementById('homeSection').classList.contains('active')).toBe(false);
    } finally {
      delete window.__imTestAuthAdapter;
    }
  });
});
