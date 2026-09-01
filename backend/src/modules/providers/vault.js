'use strict';

const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scrypt: scryptCallback,
} = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(scryptCallback);
const WRAP_PURPOSE = Buffer.from('ink-morrow/provider-vault/wrap/v1\0', 'utf8');
const ENTRY_PURPOSE = 'ink-morrow/provider-secret/v1';
const DEFAULT_SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function vaultError(message, code = 'VAULT_UNAVAILABLE', statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function createSecretVault({
  db,
  verifyPassword,
  scryptParams = DEFAULT_SCRYPT,
} = {}) {
  let dataKey = null;
  let faulted = false;
  let lockEpoch = 0;

  const envelope = () => db.prepare('SELECT * FROM provider_vault WHERE id = 1').get();
  const secretCount = () => db.prepare('SELECT COUNT(*) AS count FROM provider_secrets').get().count;

  async function wrappingKey(password, salt, params = scryptParams) {
    const normalized = typeof password === 'string' ? password.normalize('NFC') : '';
    if (!normalized) throw vaultError('Enter the owner passphrase to unlock saved provider credentials.', 'VAULT_PASSPHRASE_REQUIRED', 401);
    return scrypt(Buffer.concat([WRAP_PURPOSE, Buffer.from(normalized, 'utf8')]), salt, 32, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: params.maxmem || Math.max(DEFAULT_SCRYPT.maxmem, 128 * params.N * params.r + 1024 * 1024),
    });
  }

  function encrypt(key, plaintext, aad) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { nonce, ciphertext, tag: cipher.getAuthTag() };
  }

  function decrypt(key, record, aad) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(record.auth_tag || record.wrap_tag));
      return Buffer.concat([decipher.update(Buffer.from(record.ciphertext || record.wrapped_key)), decipher.final()]);
    } catch {
      faulted = true;
      lock();
      throw vaultError('Saved provider credentials could not be authenticated. They remain locked.', 'VAULT_DAMAGED');
    }
  }

  function replaceKey(next) {
    if (dataKey) dataKey.fill(0);
    dataKey = Buffer.from(next);
    faulted = false;
  }

  async function createEnvelope(password, epoch) {
    if (typeof verifyPassword !== 'function' || !(await verifyPassword(password))) {
      throw vaultError('The owner passphrase was not accepted.', 'VAULT_PASSPHRASE_REJECTED', 401);
    }
    const key = randomBytes(32);
    const salt = randomBytes(16);
    let wrapKey;
    try {
      wrapKey = await wrappingKey(password, salt);
      const wrapped = encrypt(wrapKey, key, `${ENTRY_PURPOSE}:data-key`);
      db.prepare(`
        INSERT INTO provider_vault
          (id, wrap_salt, wrap_nonce, wrapped_key, wrap_tag, scrypt_n, scrypt_r, scrypt_p)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `).run(salt, wrapped.nonce, wrapped.ciphertext, wrapped.tag,
        scryptParams.N, scryptParams.r, scryptParams.p);
      if (epoch === lockEpoch) replaceKey(key);
    } finally {
      wrapKey?.fill(0);
      key.fill(0);
    }
  }

  async function unlock(password, { create = false } = {}) {
    const epoch = lockEpoch;
    const row = envelope();
    if (!row) {
      if (!create) return status();
      await createEnvelope(password, epoch);
      return status();
    }
    const params = { N: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p };
    const wrapKey = await wrappingKey(password, Buffer.from(row.wrap_salt), params);
    let key;
    try {
      key = decrypt(wrapKey, {
        nonce: row.wrap_nonce,
        wrapped_key: row.wrapped_key,
        wrap_tag: row.wrap_tag,
      }, `${ENTRY_PURPOSE}:data-key`);
    } finally {
      wrapKey.fill(0);
    }
    try {
      if (epoch === lockEpoch) replaceKey(key);
    } finally {
      key.fill(0);
    }
    return status();
  }

  async function unlockIfPresent(password) {
    if (!envelope()) return status();
    return unlock(password);
  }

  function lock() {
    lockEpoch += 1;
    if (dataKey) dataKey.fill(0);
    dataKey = null;
  }

  function status() {
    const exists = Boolean(envelope());
    return {
      state: faulted ? 'error' : !exists ? 'empty' : dataKey ? 'unlocked' : 'locked',
      persistent_available: true,
      saved_credentials: Number(secretCount()),
    };
  }

  async function ensureKey(password) {
    if (dataKey) return;
    await unlock(password, { create: true });
    if (!dataKey) throw vaultError('Saved provider credentials are locked.', 'VAULT_LOCKED', 423);
  }

  async function encryptSecret(profileId, secret, password) {
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 8192) {
      throw vaultError('Provider credential must be non-empty text of at most 8192 characters.', 'INVALID_PROVIDER_SECRET', 400);
    }
    await ensureKey(password);
    const id = randomUUID();
    const encrypted = encrypt(dataKey, Buffer.from(secret, 'utf8'), `${ENTRY_PURPOSE}:${profileId}:${id}`);
    return { id, ...encrypted };
  }

  function decryptSecret(profileId, secretId) {
    if (!dataKey) throw vaultError('Saved provider credentials are locked. Enter the owner passphrase to continue.', 'VAULT_LOCKED', 423);
    const row = db.prepare('SELECT * FROM provider_secrets WHERE id = ? AND profile_id = ?').get(secretId, profileId);
    if (!row) throw vaultError('The configured provider credential is unavailable.', 'PROVIDER_CREDENTIAL_UNAVAILABLE');
    const plaintext = decrypt(dataKey, row, `${ENTRY_PURPOSE}:${profileId}:${secretId}`);
    try { return plaintext.toString('utf8'); } finally { plaintext.fill(0); }
  }

  function plaintextValues() {
    if (!dataKey) return [];
    return db.prepare('SELECT id, profile_id FROM provider_secrets').all()
      .map((row) => decryptSecret(row.profile_id, row.id));
  }

  async function prepareRewrap(currentPassword, newPassword) {
    const row = envelope();
    if (!row) return null;
    if (!dataKey) await unlock(currentPassword);
    const key = Buffer.from(dataKey);
    const salt = randomBytes(16);
    let wrapKey;
    let wrapped;
    try {
      wrapKey = await wrappingKey(newPassword, salt);
      wrapped = encrypt(wrapKey, key, `${ENTRY_PURPOSE}:data-key`);
    } finally {
      wrapKey?.fill(0);
      key.fill(0);
    }
    return {
      salt,
      nonce: wrapped.nonce,
      ciphertext: wrapped.ciphertext,
      tag: wrapped.tag,
      N: scryptParams.N,
      r: scryptParams.r,
      p: scryptParams.p,
    };
  }

  function applyRewrap(prepared) {
    if (!prepared) return;
    db.prepare(`
      UPDATE provider_vault
         SET wrap_salt = ?, wrap_nonce = ?, wrapped_key = ?, wrap_tag = ?,
             scrypt_n = ?, scrypt_r = ?, scrypt_p = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
    `).run(prepared.salt, prepared.nonce, prepared.ciphertext, prepared.tag,
      prepared.N, prepared.r, prepared.p);
  }

  return {
    status,
    unlock,
    unlockIfPresent,
    lock,
    encryptSecret,
    decryptSecret,
    plaintextValues,
    prepareRewrap,
    applyRewrap,
  };
}

module.exports = { createSecretVault, DEFAULT_SCRYPT };
