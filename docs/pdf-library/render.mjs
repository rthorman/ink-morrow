/* global process, console, document */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { books, editionLabel } from './books.mjs';
import { renderMarkdown } from './markdown.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch {
  const e2eRequire = createRequire(path.join(here, '../../e2e/package.json'));
  ({ chromium } = e2eRequire('@playwright/test'));
}

const systemChrome = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((candidate)=>candidate&&fsSync.existsSync(candidate));
const outputDir = path.join(here, '../pdf');
await fs.mkdir(outputDir,{recursive:true});
const css = await fs.readFile(path.join(here,'theme.css'),'utf8');
const browser = await chromium.launch({headless:true,...(systemChrome?{executablePath:systemChrome}:{})});

try {
  for (const book of books) {
    const source = path.join(here,book.source);
    const output = path.join(outputDir,book.output);
    const page = await browser.newPage({viewport:{width:1190,height:1684}});

    if (book.format === 'fixed-html') {
      await page.goto(pathToFileURL(source).href,{waitUntil:'networkidle'});
      await page.emulateMedia({media:'print',colorScheme:'light'});
      await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(()=>{
        const broken=[...document.images].filter((image)=>!image.complete||image.naturalWidth===0);
        if(broken.length)throw new Error(`Broken images: ${broken.map((image)=>image.src).join(', ')}`);
        const overflowing=[...document.querySelectorAll('.page')]
          .map((element,index)=>({page:index+1,overflow:element.scrollHeight-element.clientHeight}))
          .filter(({overflow})=>overflow>2);
        if(overflowing.length)throw new Error(`Fixed-page overflow: ${JSON.stringify(overflowing)}`);
      });
      await page.pdf({path:output,printBackground:true,preferCSSPageSize:true,tagged:true,outline:true,displayHeaderFooter:false});
      await page.close();
      console.log(output);
      continue;
    }

    const markdown = await fs.readFile(source,'utf8');
    const body = renderMarkdown(markdown);
    const headings = [...body.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)];
    const toc = `<h3>Contents</h3><div class="contents-list">${headings.map(([,id,label])=>`<a href="#${id}">${label}</a>`).join('')}</div>`;
    const bodyWithToc = body.replace('</div>',`${toc}</div>`);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ink Morrow ${editionLabel} - ${book.title}</title><style>${css}</style></head><body><section class="cover"><img src="${book.cover}" alt=""><div class="cover-copy"><div class="cover-kicker">Ink Morrow ${editionLabel}</div><h1>${book.title}</h1><div class="cover-subtitle">${book.subtitle}</div><div class="cover-meta">${book.audience} &nbsp; / &nbsp; September 2026</div></div></section><main>${bodyWithToc}</main></body></html>`;
    const intermediate = path.join(here,`.render-${book.slug}.html`);
    await fs.writeFile(intermediate,html,'utf8');
    await page.goto(pathToFileURL(intermediate).href,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>{const broken=[...document.images].filter((image)=>!image.complete||image.naturalWidth===0);if(broken.length)throw new Error(`Broken images: ${broken.map((image)=>image.src).join(', ')}`);});
    await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,tagged:true,outline:true,displayHeaderFooter:true,headerTemplate:`<div style="font:7px Georgia;color:#766a72;width:100%;padding:0 15mm;text-align:right">INK MORROW ${editionLabel.toUpperCase()}</div>`,footerTemplate:'<div style="font:7px Georgia;color:#766a72;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>YOUR CHOICES, THEIR LIVES</span><span class="pageNumber"></span></div>',margin:{top:'14mm',right:'15mm',bottom:'13mm',left:'15mm'}});
    await page.close();
    await fs.unlink(intermediate);
    console.log(output);
  }
} finally { await browser.close(); }
