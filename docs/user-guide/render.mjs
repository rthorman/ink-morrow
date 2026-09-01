import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch {
  const e2eRequire = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../e2e/package.json'));
  ({ chromium } = e2eRequire('@playwright/test'));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, 'index.html');
const output = path.join(here, 'Ink-Morrow-4.0-User-Guide.pdf');
const systemChrome = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));

const browser = await chromium.launch({ headless: true, ...(systemChrome ? { executablePath: systemChrome } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1190, height: 1684 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const brokenImages = [...document.images].filter((image) => !image.complete || image.naturalWidth === 0);
    if (brokenImages.length) throw new Error(`Broken guide images: ${brokenImages.map((image) => image.src).join(', ')}`);
    const overflowingPages = [...document.querySelectorAll('.page')]
      .map((element, index) => ({ index: index + 1, overflow: element.scrollHeight - element.clientHeight }))
      .filter(({ overflow }) => overflow > 2);
    if (overflowingPages.length) throw new Error(`Guide page overflow: ${JSON.stringify(overflowingPages)}`);
  });
  await page.pdf({
    path: output,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    tagged: true,
    outline: true,
  });
  console.log(output);
} finally {
  await browser.close();
}
