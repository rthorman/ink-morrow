// Same-origin API (backend serves this directory), so relative /api works
// everywhere - localhost, LAN, whatever host you browse from. No implicit
// retries: a paid POST must never fire twice by accident.

export const API_BASE_URL = '/api';

export async function apiCall(endpoint, method = 'GET', data = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (data && method !== 'GET') options.body = JSON.stringify(data);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, options);
  } catch {
    throw new Error('Cannot reach the server - is it running?');
  }

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
    throw error;
  }
  return body;
}
