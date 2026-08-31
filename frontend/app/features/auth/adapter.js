// Same-origin single-owner authentication. The backend owns password hashing
// and sessions; this adapter keeps only the current CSRF token in memory.

export function createAuthAdapter() {
  const listeners = new Set();
  let current = null;
  let pendingStatus = null;

  function publish(next) {
    current = next;
    for (const listener of listeners) listener({ ...next });
    return next;
  }

  async function readJson(response) {
    try { return await response.json(); } catch { return {}; }
  }

  async function status({ refresh = false } = {}) {
    if (!refresh && current) return { ...current };
    if (pendingStatus) return pendingStatus;
    pendingStatus = (async () => {
      let response;
      try {
        response = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
      } catch {
        throw new Error('Cannot reach the ScribeTribe server.');
      }
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || 'Could not check the scriptorium lock.');
      return publish(body);
    })();
    try { return await pendingStatus; } finally { pendingStatus = null; }
  }

  async function post(path, data, { csrf = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf && current?.csrf_token) headers['X-ScribeTribe-CSRF'] = current.csrf_token;
    let response;
    try {
      response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: JSON.stringify(data || {}),
      });
    } catch {
      throw new Error('Cannot reach the ScribeTribe server.');
    }
    const body = await readJson(response);
    if (!response.ok) {
      if (body.state) publish({ state: body.state });
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.state = body.state;
      throw error;
    }
    return publish(body);
  }

  function handleUnauthorized({ state = 'locked' } = {}) {
    if (current?.state === state && !current?.csrf_token) return;
    publish({ state });
  }

  return {
    mode: 'single-owner',
    status,
    setup({ setupCode, password, remember }) {
      return post('/api/auth/setup', { setup_code: setupCode, password, remember });
    },
    login({ password, remember }) {
      return post('/api/auth/login', { password, remember });
    },
    logout() {
      return post('/api/auth/logout', {}, { csrf: true });
    },
    changePassword({ currentPassword, newPassword }) {
      return post('/api/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      }, { csrf: true });
    },
    handleUnauthorized,
    get csrfToken() { return current?.csrf_token || null; },
    get current() { return current ? { ...current } : null; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
