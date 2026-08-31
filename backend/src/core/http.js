'use strict';

// Shared HTTP response helpers. The API's error contract is a JSON
// { error: string } body - keep it stable across every feature router.

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function notFound(res, message) {
  return res.status(404).json({ error: message });
}

module.exports = { badRequest, notFound };
