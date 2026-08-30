// Auth adapter seam - DISABLED MODE ONLY.
//
// Security is explicitly deferred: no password storage, comparison,
// hashing, sessions, cookies, or /api/auth endpoints exist. This adapter
// leaves the application fully reachable; a future security phase supplies
// a real backend adapter returning setup-required | locked | unlocked and
// activates the presentational gate views. The subscribe method exists so
// the future state provider can push transitions; in disabled mode it
// never fires.

export function createDisabledAuthAdapter() {
  const listeners = new Set();
  return {
    mode: 'disabled',
    async status() {
      return { state: 'disabled' };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
