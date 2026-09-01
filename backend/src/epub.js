'use strict';

// Minimal, dependency-free EPUB 3 writer.
// Entries are STORED (no compression): the EPUB spec only requires the
// `mimetype` file to be stored+first, and readers accept stored entries
// everywhere - this keeps the writer small and easy to verify.

// ---------------------------------------------------------------------------
// ZIP (stored entries only)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function zipStore(entries) {
  const { time, day } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// XHTML helpers
// ---------------------------------------------------------------------------

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paragraphsOf(content) {
  return String(content || '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `    <p>${escapeXml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

function extFor(mediaType) {
  return mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
}

function xhtmlDoc(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
${body}
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// EPUB assembly
// ---------------------------------------------------------------------------

/**
 * Build a complete EPUB for a story.
 * @param {{title: string, world: ?object, characters: object[], pages: {page_number:number, content:string}[]}} story
 * @param {?string} uuid stable unique identifier (generated when omitted)
 */
function buildEpub({ title, world, characters, pages }, uuid) {
  const uid = uuid || `urn:uuid:${require('crypto').randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const credits = [];
  if (world) credits.push(`A tale set in ${world.name}${world.genre ? ` — ${world.genre}` : ''}`);
  if (characters.length > 0) credits.push(`Featuring: ${characters.map((c) => c.name).join(', ')}`);

  const titleBody = `    <h1>${escapeXml(title)}</h1>` +
    (credits.length ? `\n${credits.map((c) => `    <p class="credit">${escapeXml(c)}</p>`).join('\n')}` : '');
  const titlePage = xhtmlDoc(title, titleBody);

  // Art shares a prose document but never becomes a numbered EPUB page.
  // The legacy singular `image` shape remains readable for older archives.
  const pageFiles = pages.map((page) => {
    let body = `    <h2>Page ${page.page_number}</h2>\n${paragraphsOf(page.content)}`;
    const imageFiles = [];
    const before = [];
    const after = [];
    if (page.image?.data) {
      const ext = extFor(page.image.mediaType);
      const filename = `page-${page.page_number}.${ext}`;
      imageFiles.push({ id: `img${page.page_number}`, name: `OEBPS/images/${filename}`, data: page.image.data, mediaType: page.image.mediaType });
      before.push(`    <div class="plate"><img src="images/${filename}" alt="${escapeXml(page.image_prompt || `Painted scene plate for page ${page.page_number}`)}"/></div>`);
    }
    for (const [index, art] of (page.art || []).entries()) {
      if (!art?.data) continue;
      const ext = extFor(art.mediaType);
      const filename = `page-${page.page_number}-art-${index + 1}.${ext}`;
      imageFiles.push({ id: `img${page.page_number}_${index + 1}`, name: `OEBPS/images/${filename}`, data: art.data, mediaType: art.mediaType });
      const markup = `    <div class="plate"><img src="images/${filename}" alt="${escapeXml(art.alt || 'Story illustration')}"/></div>`;
      (art.before ? before : after).push(markup);
    }
    body = [...before, body, ...after].join('\n');
    return { name: `OEBPS/page-${page.page_number}.xhtml`, content: xhtmlDoc(`${title} — Page ${page.page_number}`, body), imageFiles };
  });

  const navItems = [`      <li><a href="title.xhtml">Cover</a></li>`]
    .concat(pages.map((p) => `      <li><a href="page-${p.page_number}.xhtml">Page ${p.page_number}</a></li>`));
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${escapeXml(title)}</h1>
      <ol>
${navItems.join('\n')}
      </ol>
    </nav>
  </body>
</html>
`;

  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="css" href="style.css" media-type="text/css"/>',
    '    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
  ]
    .concat(
      pageFiles.flatMap((file) => file.imageFiles.map((image) =>
        `    <item id="${image.id}" href="${image.name.replace('OEBPS/', '')}" media-type="${image.mediaType}"/>`
      ))
    )
    .concat(
      pages.map(
        (p) => `    <item id="page${p.page_number}" href="page-${p.page_number}.xhtml" media-type="application/xhtml+xml"/>`
      )
    );
  const spine = ['    <itemref idref="title"/>'].concat(
    pages.map((p) => `    <itemref idref="page${p.page_number}"/>`)
  );

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(uid)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>ScribeTribe</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine>
${spine.join('\n')}
  </spine>
</package>
`;

  const css = `body { font-family: serif; line-height: 1.6; margin: 1em; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.2em; font-weight: normal; color: #444; }
p { text-indent: 1.2em; margin: 0; }
p.credit { font-style: italic; color: #555; text-indent: 0; }
div.plate { margin: 1em 0; text-align: center; }
div.plate img { max-width: 100%; }
`;

  // `mimetype` MUST be the first entry and uncompressed.
  return zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
` },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/style.css', data: css },
    { name: 'OEBPS/title.xhtml', data: titlePage },
    ...pageFiles.flatMap((file) => [
      ...file.imageFiles.map((image) => ({ name: image.name, data: image.data })),
      { name: file.name, data: file.content },
    ]),
  ]);
}

module.exports = { buildEpub, zipStore };
