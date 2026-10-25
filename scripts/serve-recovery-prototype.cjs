'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

// Synthetic prototype only; never serve APIs, private files or databases.
function createPrototypeServer() {
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (pathname === '/') { response.writeHead(302, { Location: '/prototypes/recovery/index.html' }).end(); return; }
    const bundled = pathname === '/preview.html';
    const allowed = ['/prototypes/recovery/', '/frontend/brand/', '/frontend/fonts/', '/frontend/styles/'];
    const file = bundled ? path.join(root, 'docs/recovery/evidence/B0-PREVIEW.html') : path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || (!bundled && !allowed.some(prefix => pathname.startsWith(prefix))) || !types[path.extname(file)]) {
      response.writeHead(404).end(); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': bundled ? "default-src 'none'; connect-src 'none'; img-src data:; font-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" : "default-src 'self'; connect-src 'none'; img-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  });
}
module.exports = { createPrototypeServer };
if (require.main === module) {
  const server = createPrototypeServer();
  server.listen(Number(process.env.PROTOTYPE_PORT || 4174), '127.0.0.1', () => {
    console.log(`Synthetic recovery prototype: http://127.0.0.1:${server.address().port}`);
  });
}
