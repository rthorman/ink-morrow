// Same-origin API (backend serves this directory), so relative /api works
// everywhere - localhost, LAN, whatever host you browse from. No implicit
// retries: a paid POST must never fire twice by accident.

export const API_BASE_URL = '/api';

let csrfProvider = () => null;
let unauthorizedHandler = () => {};
const WRITER_SESSION_KEY = 'st-writer-session-v1';

export function writerSessionId() {
  try {
    let value = window.sessionStorage.getItem(WRITER_SESSION_KEY);
    if (!value) {
      const id = globalThis.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      value = `writer:${id}`;
      window.sessionStorage.setItem(WRITER_SESSION_KEY, value);
    }
    return value;
  } catch {
    return 'writer:memory-only';
  }
}

export function configureApiSecurity({ getCsrfToken = () => null, onUnauthorized = () => {} } = {}) {
  csrfProvider = getCsrfToken;
  unauthorizedHandler = onUnauthorized;
}

export async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = csrfProvider();
    if (token) headers['X-ScribeTribe-CSRF'] = token;
    headers['X-ScribeTribe-Writer-Session'] ||= writerSessionId();
  }

  let response;
  try {
    response = await fetch(url, { ...options, method, headers, credentials: 'same-origin' });
  } catch {
    throw new Error('Cannot reach the server - is it running?');
  }
  if (response.status === 401) {
    let state = 'locked';
    try {
      const body = await response.clone().json();
      if (body?.state) state = body.state;
    } catch { /* a binary/plain response still means the session is gone */ }
    unauthorizedHandler({ state });
  }
  return response;
}

export async function apiCall(endpoint, method = 'GET', data = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (data && method !== 'GET') options.body = JSON.stringify(data);

  const response = await apiFetch(`${API_BASE_URL}${endpoint}`, options);

  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON (e.g. 204)
  }

  if (!response.ok) {
    const error = new Error((body && body.error) || `Request failed (${response.status})`);
    // Preserve optional billing metadata from failed paid requests. Feature
    // flows decide whether the spend belongs to the session only or to the
    // current story as well.
    if (body && Object.prototype.hasOwnProperty.call(body, 'cost_usd')) {
      error.costUsd = typeof body.cost_usd === 'number' && Number.isFinite(body.cost_usd)
        ? body.cost_usd
        : null;
    }
    if (body && Number.isInteger(body.billed_attempts) && body.billed_attempts > 0) {
      error.billedAttempts = body.billed_attempts;
    }
    error.status = response.status;
    if (body?.code) error.code = body.code;
    if (body?.state) error.state = body.state;
    throw error;
  }
  return body;
}
