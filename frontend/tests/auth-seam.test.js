import { loadScript, mockFetch } from './dom-helpers.js';

// The auth seam: presentation + state contract only. Security is deferred;
// the disabled adapter must never block the app, and no dormant template
// may contain an active credential field.
describe('Auth seam (disabled adapter)', () => {
  it('the adapter reports disabled and the app opens with no barrier', async () => {
    mockFetch();
    const fw = await loadScript();
    const status = await fw.auth.status();
    expect(status.state).toBe('disabled');
    expect(fw.auth.mode).toBe('disabled');
    // The app rendered Home, unblocked
    expect(document.getElementById('homeSection').classList.contains('active')).toBe(true);
  });

  it('the gate lets every route through in disabled mode', async () => {
    mockFetch();
    const fw = await loadScript();
    expect(await fw.authGate.canRender()).toBe(true);
  });

  it('the gate also lets routes through when the adapter errors (a local app must not lock itself out)', async () => {
    mockFetch();
    const fw = await loadScript();
    const brokenGate = fw.authGate;
    // Simulate an adapter that throws
    const gate = await import('../app/features/auth/gate.js');
    const broken = gate.createAuthGate({ auth: { status: () => Promise.reject(new Error('no backend')) } });
    expect(broken).toBeTruthy();
    expect(await broken.canRender()).toBe(true);
    expect(brokenGate).toBeTruthy();
  });

  it('dormant templates contain no password inputs and stay unmounted', async () => {
    mockFetch();
    const fw = await loadScript();
    const setup = fw.authGate.buildFirstPasswordTemplate();
    const unlock = fw.authGate.buildUnlockTemplate();
    for (const surface of [setup, unlock]) {
      expect(surface.querySelectorAll('input, textarea, select, button[type="submit"]')).toHaveLength(0);
      expect(surface.getAttribute('hidden')).toBe('');
    }
    // Nothing auth-shaped mounted in the live DOM
    expect(document.querySelector('.auth-surface')).toBeNull();
    // And no credential endpoint was ever called
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/auth'))).toBe(false);
  });

  it('subscribe returns an unsubscribe and never fires in disabled mode', async () => {
    mockFetch();
    const fw = await loadScript();
    let fired = 0;
    const off = fw.auth.subscribe(() => fired++);
    expect(typeof off).toBe('function');
    off();
    expect(fired).toBe(0);
  });
});

describe('Auth seam (blocked adapter, injected)', () => {
  it('a future locked adapter blocks route rendering; disabled mode renders normally', async () => {
    window.localStorage.clear();
    // A fake FUTURE adapter that reports a locked state. It adds no
    // credentials, no endpoints, no real security - it only proves the
    // dormant gate can actually hold rendering back.
    window.__stTestAuthAdapter = {
      mode: 'locked-future',
      status: () => Promise.resolve({ state: 'locked' }),
      subscribe: () => () => {},
    };
    try {
      mockFetch();
      await loadScript();
      await new Promise((r) => setTimeout(r, 0));
      // No application section was allowed to render...
      expect(document.getElementById('homeSection').classList.contains('active')).toBe(false);
      // ...and no section got there via a later route either
      document.getElementById('writeBtn').click();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.getElementById('writeSection').classList.contains('active')).toBe(false);
    } finally {
      delete window.__stTestAuthAdapter;
    }

    // Back to the real disabled mode: the app opens exactly as before.
    mockFetch();
    const fw = await loadScript();
    const status = await fw.auth.status();
    expect(status.state).toBe('disabled');
    expect(document.getElementById('homeSection').classList.contains('active')).toBe(true);
  });

  it('a slow older gate result cannot paint over a newer transition', async () => {
    window.localStorage.clear();
    let resolveFirst;
    let calls = 0;
    window.__stTestAuthAdapter = {
      mode: 'slow-future',
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
      // The first route (home) is still waiting on its slow gate result when
      // the user moves on to Write, whose gate resolves immediately.
      document.getElementById('writeBtn').click();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.getElementById('writeSection').classList.contains('active')).toBe(true);
      // The STALE home result arrives late: Home must NOT re-render over Write.
      resolveFirst();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.getElementById('writeSection').classList.contains('active')).toBe(true);
      expect(document.getElementById('homeSection').classList.contains('active')).toBe(false);
    } finally {
      delete window.__stTestAuthAdapter;
    }
  });
});
