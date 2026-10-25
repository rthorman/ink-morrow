'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mime = { '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const data = file => `data:${mime[path.extname(file)]};base64,${fs.readFileSync(path.join(root, file)).toString('base64')}`;
const brand = {};
for (const file of fs.readdirSync(path.join(root, 'frontend/brand'))) {
  if (mime[path.extname(file)]) brand[file] = data('frontend/brand/' + file);
}
const fonts = read('frontend/styles/fonts.css').replace(/url\("\.\.\/fonts\/([^"\n]+)"\)/g, (_, file) => `url("${data('frontend/fonts/' + file)}")`);
const css = fonts + '\n' + read('frontend/styles/tokens.css') + '\n' + read('prototypes/recovery/prototype.css');
const fixtures = read('prototypes/recovery/fixtures.js').replaceAll('export const ', 'const ');
const code = read('prototypes/recovery/prototype.js')
  .replace(/^import .*?;\n/, '')
  .replace('const art = file => `../../frontend/brand/${file}`;', 'const art = file => embeddedArtwork[file];');
let html = read('prototypes/recovery/index.html')
  .replace(/ {2}<link rel="stylesheet"[^\n]+>\n/g, '')
  .replace('href="../../frontend/brand/favicon.svg"', `href="${brand['favicon.svg']}"`)
  .replace('</head>', `<style>${css}</style>\n</head>`)
  .replace('<script type="module" src="prototype.js"></script>', () => `<script type="module">\nconst embeddedArtwork = ${JSON.stringify(brand)};\n${fixtures}\n${code}\n</script>`);
html = html.replace('<meta name="color-scheme"', '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; base-uri \'none\'">\n  <meta name="color-scheme"');
const licenses = fs.readdirSync(path.join(root, 'frontend/fonts')).filter(file => file.startsWith('OFL-')).map(file => ({ file, text: read('frontend/fonts/' + file) }));
html = html.replace('</body>', `<script type="application/json" id="bundled-font-licenses">${JSON.stringify(licenses)}</script>\n</body>`);
const output = path.join(root, 'docs/recovery/evidence/B0-PREVIEW.html');
fs.writeFileSync(output, html);
console.log(`Self-contained synthetic preview: ${path.relative(root, output)} (${Buffer.byteLength(html)} bytes)`);
