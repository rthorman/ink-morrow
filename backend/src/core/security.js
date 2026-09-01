'use strict';

const net = require('node:net');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function normalizeHost(value) {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
}

function createHostGuard({ allowLan = false, allowedHosts = [] } = {}) {
  const configured = new Set(allowedHosts.map(normalizeHost).filter(Boolean));
  const local = new Set(['localhost', '127.0.0.1', '::1']);
  return (req, res, next) => {
    const host = normalizeHost(req.headers.host || '');
    const literalLan = allowLan && net.isIP(host) !== 0;
    if (!host || (!local.has(host) && !configured.has(host) && !literalLan)) {
      return res.status(421).json({ error: 'This host is not allowed by the Ink Morrow server configuration.' });
    }
    next();
  };
}

module.exports = { createHostGuard, securityHeaders, normalizeHost };
