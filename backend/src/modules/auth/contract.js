'use strict';

// Auth contract seam - presentation/state interface ONLY.
//
// Security is explicitly deferred: no password storage, comparison,
// hashing, sessions, cookies, or /api/auth/* endpoints exist here. The
// disabled adapter leaves the current application fully reachable; the
// future security phase supplies a real backend adapter and activates the
// presentational gate views with states: setup-required | locked | unlocked.

function createDisabledAuthAdapter() {
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

module.exports = { createDisabledAuthAdapter };
