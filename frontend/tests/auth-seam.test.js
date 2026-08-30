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
