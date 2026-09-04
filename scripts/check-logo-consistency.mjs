import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const canonical = 'brand/ink-morrow-lockup.svg';
assert.match(read(`frontend/${canonical}`), /<svg[^>]+viewBox="0 0 900 240"/);
assert.ok(read('README.md').includes(`src="frontend/${canonical}"`), 'README must use the canonical logo');
assert.match(read('frontend/index.html'), /class="fiction-brand"[^>]*><img src="brand\/ink-morrow-lockup\.svg"/);
assert.ok(read('frontend/app/features/auth/gate.js').includes(`lockup.src = '${canonical}'`), 'Authentication must use the same artwork');
const renderer = read('docs/pdf-library/render.mjs');
assert.ok(renderer.includes(`const logoPath = '../../frontend/${canonical}'`), 'PDF covers must use the canonical artwork');
assert.ok(renderer.includes('src="${logoData}"'), 'PDF running headers must reuse the same artwork');
assert.doesNotMatch(read('frontend/styles/fiction.css'), /\.fiction-brand\s*\{[^}]*font-family/);
assert.doesNotMatch(read('README.md'), /<h1[^>]*>\s*Ink\s?Morrow\s*<\/h1>/i);
console.log('Canonical README/app/authentication/PDF logo references agree.');
