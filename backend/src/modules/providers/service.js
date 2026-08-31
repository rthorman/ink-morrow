'use strict';

const { randomUUID } = require('node:crypto');
const { createSecretVault } = require('./vault');

const ROLE_CAPABILITY = Object.freeze({ scribe: 'chat', archivist: 'chat', narrator: 'speech' });
const CAPABILITIES = new Set(['chat', 'catalog', 'speech', 'image', 'generation-cost']);
const DEFAULT_PROFILE_ID = 'openrouter-default';

function providerError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : null;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return null;
  const capabilities = [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()))];
  return capabilities.length > 0 && capabilities.every((item) => CAPABILITIES.has(item)) ? capabilities.sort() : null;
}

function normalizeEndpoint(value) {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password || url.search || url.hash) return null;
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function createProviderService({ db, auth, env = process.env, vaultOptions = {} } = {}) {
  const sessionSecrets = new Map();
  const observedCatalogues = new Map();
  const vault = createSecretVault({
    db,
    verifyPassword: (password) => auth.verifyPassword(password),
    ...vaultOptions,
  });

  function ensureDefaults() {
    db.prepare(`
      INSERT OR IGNORE INTO provider_profiles
        (id, display_name, base_url, capabilities_json, credential_source,
         environment_key, timeout_ms, enabled, builtin)
      VALUES (?, 'OpenRouter', ?, ?, 'environment', 'OPENROUTER_API_KEY', ?, 1, 1)
    `).run(
      DEFAULT_PROFILE_ID,
      String(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      JSON.stringify(['catalog', 'chat', 'generation-cost', 'image', 'speech']),
      Number.parseInt(env.AI_TIMEOUT_MS || '120000', 10) || 120000
    );
    const insertRole = db.prepare(`
      INSERT OR IGNORE INTO provider_role_assignments (role, profile_id, model_id)
      VALUES (?, ?, ?)
    `);
    const scribe = env.OPENROUTER_MODEL || 'z-ai/glm-5.1';
    insertRole.run('scribe', DEFAULT_PROFILE_ID, scribe);
    insertRole.run('archivist', DEFAULT_PROFILE_ID, env.CONTINUITY_MODEL || scribe);
    insertRole.run('narrator', DEFAULT_PROFILE_ID, env.NARRATOR_MODEL || 'openai/gpt-4o-mini-tts');
  }
  ensureDefaults();

  function profileRow(id) {
    return db.prepare('SELECT * FROM provider_profiles WHERE id = ?').get(id);
  }

  function capabilitiesOf(row) {
    try { return normalizeCapabilities(JSON.parse(row.capabilities_json)) || []; } catch { return []; }
  }

  function clearSessionSecret(profileId) {
    const value = sessionSecrets.get(profileId);
    if (value) value.fill(0);
    sessionSecrets.delete(profileId);
  }

  function credentialState(row) {
    if (row.credential_source === 'environment') {
      return { source: 'environment', configured: Boolean(env[row.environment_key]), read_only: true, state: env[row.environment_key] ? 'ready' : 'missing' };
    }
    if (row.credential_source === 'session') {
      return { source: 'session', configured: sessionSecrets.has(row.id), read_only: false, state: sessionSecrets.has(row.id) ? 'ready' : 'missing' };
    }
    if (row.credential_source === 'vault') {
      const saved = Boolean(row.secret_ref && db.prepare('SELECT 1 FROM provider_secrets WHERE id = ? AND profile_id = ?').get(row.secret_ref, row.id));
      const vaultState = vault.status().state;
      return { source: 'vault', configured: saved, read_only: false, state: !saved ? 'missing' : vaultState === 'unlocked' ? 'ready' : vaultState };
    }
    return { source: 'none', configured: false, read_only: false, state: 'missing' };
  }

  function publicProfile(row) {
    return {
      id: row.id,
      display_name: row.display_name,
      base_url: row.base_url,
      capabilities: capabilitiesOf(row),
      timeout_ms: row.timeout_ms,
      enabled: Boolean(row.enabled),
      builtin: Boolean(row.builtin),
      credential: credentialState(row),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function roleState(row) {
    const profile = profileRow(row.profile_id);
    if (!profile || !profile.enabled) return 'unavailable';
    if (!capabilitiesOf(profile).includes(ROLE_CAPABILITY[row.role])) return 'unavailable';
    const credential = credentialState(profile);
    if (credential.state === 'locked' || credential.state === 'error') return credential.state;
    if (!credential.configured) return 'unconfigured';
    const observed = observedCatalogues.get(profile.id)?.get(ROLE_CAPABILITY[row.role]);
    if (observed && !observed.has(row.model_id)) return 'unavailable';
    return 'available';
  }

  function roles() {
    return db.prepare('SELECT * FROM provider_role_assignments ORDER BY role').all().map((row) => ({
      role: row.role,
      required_capability: ROLE_CAPABILITY[row.role],
      profile_id: row.profile_id,
      model_id: row.model_id,
      status: roleState(row),
      model_verified: Boolean(observedCatalogues.get(row.profile_id)?.has(ROLE_CAPABILITY[row.role])),
      updated_at: row.updated_at,
    }));
  }

  function list() {
    return {
      profiles: db.prepare('SELECT * FROM provider_profiles ORDER BY builtin DESC, display_name, id').all().map(publicProfile),
      roles: roles(),
      vault: vault.status(),
    };
  }

  function validateProfile(input, existing = null) {
    const displayName = input.display_name === undefined && existing ? existing.display_name : cleanText(input.display_name, 200);
    const endpoint = input.base_url === undefined && existing ? existing.base_url : normalizeEndpoint(input.base_url);
    const capabilities = input.capabilities === undefined && existing ? capabilitiesOf(existing) : normalizeCapabilities(input.capabilities);
    const timeout = input.timeout_ms === undefined && existing
      ? existing.timeout_ms
      : Number(input.timeout_ms === undefined ? 120000 : input.timeout_ms);
    if (!displayName) throw providerError('Provider display name must be non-empty text of at most 200 characters.', 'INVALID_PROVIDER_PROFILE');
    if (!endpoint) throw providerError('Provider endpoint must be HTTPS, or loopback HTTP, without credentials, query, or fragment.', 'INVALID_PROVIDER_ENDPOINT');
    if (!capabilities) throw providerError('Provider capabilities must be a non-empty supported list.', 'INVALID_PROVIDER_CAPABILITIES');
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 600000) {
      throw providerError('Provider timeout must be between 1000 and 600000 milliseconds.', 'INVALID_PROVIDER_TIMEOUT');
    }
    return { displayName, endpoint, capabilities, timeout, enabled: input.enabled === undefined ? Boolean(existing?.enabled ?? true) : input.enabled === true };
  }

  function createProfile(input = {}) {
    const clean = validateProfile(input);
    const id = randomUUID();
    db.prepare(`
      INSERT INTO provider_profiles
        (id, display_name, base_url, capabilities_json, timeout_ms, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, clean.displayName, clean.endpoint, JSON.stringify(clean.capabilities), clean.timeout, clean.enabled ? 1 : 0);
    return publicProfile(profileRow(id));
  }

  function updateProfile(id, input = {}) {
    const row = profileRow(id);
    if (!row) return null;
    const clean = validateProfile(input, row);
    db.prepare(`
      UPDATE provider_profiles
         SET display_name = ?, base_url = ?, capabilities_json = ?, timeout_ms = ?,
             enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).run(clean.displayName, clean.endpoint, JSON.stringify(clean.capabilities), clean.timeout, clean.enabled ? 1 : 0, id);
    return publicProfile(profileRow(id));
  }

  function deleteProfile(id) {
    const row = profileRow(id);
    if (!row) return false;
    if (row.builtin) throw providerError('The built-in OpenRouter profile cannot be deleted.', 'BUILTIN_PROVIDER', 409);
    if (db.prepare('SELECT 1 FROM provider_role_assignments WHERE profile_id = ?').get(id)) {
      throw providerError('Move every AI role away from this provider before deleting it.', 'PROVIDER_IN_USE', 409);
    }
    clearSessionSecret(id);
    db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
    observedCatalogues.delete(id);
    return true;
  }

  function deleteEncryptedSecret(row) {
    if (row.secret_ref) db.prepare('DELETE FROM provider_secrets WHERE id = ? AND profile_id = ?').run(row.secret_ref, row.id);
  }

  async function setCredential(id, { source, secret, password } = {}) {
    let row = profileRow(id);
    if (!row) return null;
    if (!['none', 'environment', 'session', 'vault'].includes(source)) {
      throw providerError('Credential source must be none, environment, session, or vault.', 'INVALID_CREDENTIAL_SOURCE');
    }
    if (source === 'environment' && id !== DEFAULT_PROFILE_ID) {
      throw providerError('Environment credentials are read-only on the built-in OpenRouter profile.', 'ENVIRONMENT_CREDENTIAL_READ_ONLY', 409);
    }
    if (source === 'session' && (typeof secret !== 'string' || !secret.trim() || secret.length > 8192)) {
      throw providerError('Provider credential must be non-empty text of at most 8192 characters.', 'INVALID_PROVIDER_SECRET');
    }
    const encrypted = source === 'vault' ? await vault.encryptSecret(id, secret, password) : null;

    db.exec('BEGIN IMMEDIATE');
    try {
      row = profileRow(id);
      if (!row) {
        db.exec('ROLLBACK');
        return null;
      }
      deleteEncryptedSecret(row);
      if (source === 'vault') {
        db.prepare(`
          INSERT INTO provider_secrets (id, profile_id, nonce, ciphertext, auth_tag)
          VALUES (?, ?, ?, ?, ?)
        `).run(encrypted.id, id, encrypted.nonce, encrypted.ciphertext, encrypted.tag);
        db.prepare(`
          UPDATE provider_profiles
             SET credential_source = 'vault', environment_key = NULL, secret_ref = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `).run(encrypted.id, id);
      } else if (source === 'environment') {
        db.prepare(`
          UPDATE provider_profiles
             SET credential_source = 'environment', environment_key = 'OPENROUTER_API_KEY', secret_ref = NULL,
                 updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(id);
      } else {
        db.prepare(`
          UPDATE provider_profiles
             SET credential_source = ?, environment_key = NULL, secret_ref = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `).run(source, id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    clearSessionSecret(id);
    if (source === 'session') sessionSecrets.set(id, Buffer.from(secret, 'utf8'));
    return publicProfile(profileRow(id));
  }

  function assignRole(role, { profile_id: profileId, model_id: modelId } = {}) {
    if (!ROLE_CAPABILITY[role]) throw providerError('Unknown AI role.', 'INVALID_PROVIDER_ROLE', 404);
    const profile = profileRow(profileId);
    const model = cleanText(modelId, 500);
    if (!profile) throw providerError('Provider profile not found.', 'PROVIDER_NOT_FOUND', 404);
    if (!model) throw providerError('Model id must be non-empty text of at most 500 characters.', 'INVALID_MODEL_ID');
    if (!capabilitiesOf(profile).includes(ROLE_CAPABILITY[role])) {
      throw providerError(`This profile does not declare the ${ROLE_CAPABILITY[role]} capability required by ${role}.`, 'PROVIDER_CAPABILITY_MISMATCH', 409);
    }
    db.prepare(`
      INSERT INTO provider_role_assignments (role, profile_id, model_id)
      VALUES (?, ?, ?)
      ON CONFLICT(role) DO UPDATE SET
        profile_id = excluded.profile_id, model_id = excluded.model_id, updated_at = CURRENT_TIMESTAMP
    `).run(role, profileId, model);
    return roles().find((entry) => entry.role === role);
  }

  function credentialValue(profile) {
    if (profile.credential_source === 'environment') return env[profile.environment_key] || '';
    if (profile.credential_source === 'session') return sessionSecrets.get(profile.id)?.toString('utf8') || '';
    if (profile.credential_source === 'vault') return vault.decryptSecret(profile.id, profile.secret_ref);
    return '';
  }

  function resolve(role, { capability = ROLE_CAPABILITY[role], model = null, credentialOptional = false } = {}) {
    const assignment = db.prepare('SELECT * FROM provider_role_assignments WHERE role = ?').get(role);
    if (!assignment) throw providerError(`The ${role} role is not configured.`, 'PROVIDER_ROLE_UNCONFIGURED', 503);
    const profile = profileRow(assignment.profile_id);
    if (!profile || !profile.enabled || !capabilitiesOf(profile).includes(capability)) {
      throw providerError(`The configured ${role} provider is unavailable.`, 'PROVIDER_UNAVAILABLE', 503);
    }
    let apiKey = '';
    try { apiKey = credentialValue(profile); } catch (error) {
      if (!credentialOptional) throw error;
    }
    if (!apiKey && !credentialOptional) {
      const error = providerError(
        profile.credential_source === 'environment'
          ? 'OpenRouter API key not configured. Set OPENROUTER_API_KEY in backend/.env'
          : `The configured ${role} provider needs a credential.`,
        'PROVIDER_CREDENTIAL_REQUIRED',
        503
      );
      throw error;
    }
    return {
      apiKey,
      baseUrl: profile.base_url.replace(/\/+$/, ''),
      model: cleanText(model, 500) || assignment.model_id,
      timeout: profile.timeout_ms,
      retryBaseDelay: Number.parseInt(env.AI_RETRY_BASE_DELAY || '800', 10) || 800,
      maxTokens: Number.parseInt(env.AI_MAX_TOKENS || '1500', 10) || 1500,
      profileId: profile.id,
      profileName: profile.display_name,
    };
  }

  function catalogConfig(profileId = null, role = 'scribe') {
    if (!profileId) {
      const config = resolve(role, { capability: 'catalog', credentialOptional: true });
      if (role === 'scribe' && config.profileId === DEFAULT_PROFILE_ID && env.OPENROUTER_MODEL) {
        config.model = env.OPENROUTER_MODEL;
      }
      return config;
    }
    const profile = profileRow(profileId);
    if (!profile || !profile.enabled || !capabilitiesOf(profile).includes('catalog')) {
      throw providerError('This provider does not expose a model catalogue.', 'PROVIDER_CATALOG_UNAVAILABLE', 409);
    }
    let apiKey = '';
    try { apiKey = credentialValue(profile); } catch { /* public catalogues remain usable while a vault is locked */ }
    return {
      apiKey,
      baseUrl: profile.base_url.replace(/\/+$/, ''),
      timeout: Math.min(profile.timeout_ms, 30000),
      profileId: profile.id,
      profileName: profile.display_name,
      model: null,
    };
  }

  function recordCatalogue(profileId, models, capability = 'chat') {
    if (!observedCatalogues.has(profileId)) observedCatalogues.set(profileId, new Map());
    observedCatalogues.get(profileId).set(capability, new Set(models.map((model) => model.id).filter(Boolean)));
  }

  function exposure(role, { data_categories = [], references = false, operation_count = 1, estimated_cost_usd = null } = {}) {
    if (!ROLE_CAPABILITY[role]) throw providerError('Unknown AI role.', 'INVALID_PROVIDER_ROLE');
    const assignment = db.prepare('SELECT * FROM provider_role_assignments WHERE role = ?').get(role);
    const profile = assignment ? profileRow(assignment.profile_id) : null;
    return {
      role,
      provider: profile ? { id: profile.id, display_name: profile.display_name } : null,
      model_id: assignment?.model_id || null,
      data_categories: [...new Set(data_categories.filter((item) => typeof item === 'string'))],
      references: Boolean(references),
      operation_count: Number.isInteger(operation_count) && operation_count > 0 ? operation_count : 1,
      estimated_cost_usd: typeof estimated_cost_usd === 'number' && Number.isFinite(estimated_cost_usd) ? estimated_cost_usd : null,
      credential_excluded_from_payload: true,
    };
  }

  function redact(value) {
    let safe = String(value);
    const candidates = [];
    for (const row of db.prepare("SELECT * FROM provider_profiles WHERE credential_source = 'environment'").all()) {
      if (env[row.environment_key]) candidates.push(String(env[row.environment_key]));
    }
    for (const secret of sessionSecrets.values()) candidates.push(secret.toString('utf8'));
    try { candidates.push(...vault.plaintextValues()); } catch { /* damaged vault stays locked */ }
    for (const secret of candidates) {
      if (secret.length >= 4) safe = safe.replaceAll(secret, '[redacted provider key]');
    }
    return safe.replace(/(?:Bearer\s+)?(?:sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,})/g, '[redacted provider key]');
  }

  function lockAll() {
    for (const id of [...sessionSecrets.keys()]) clearSessionSecret(id);
    vault.lock();
  }

  function dispose() {
    lockAll();
    observedCatalogues.clear();
  }

  return {
    vault,
    list,
    createProfile,
    updateProfile,
    deleteProfile,
    setCredential,
    assignRole,
    resolve,
    catalogConfig,
    recordCatalogue,
    exposure,
    redact,
    lockAll,
    dispose,
    DEFAULT_PROFILE_ID,
  };
}

module.exports = { createProviderService, ROLE_CAPABILITY, DEFAULT_PROFILE_ID };
