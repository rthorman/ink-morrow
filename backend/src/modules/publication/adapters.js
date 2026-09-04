'use strict';

const { zipStore } = require('./zip');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PUBLICATION_FORMATS } = require('./document');
const LITERATA_CMAP = require('../../../../frontend/fonts/literata-latin-cmap.json');

const MIME = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
});

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function html(value) {
  return xml(value);
}

function markdown(value) {
  return String(value).replace(/([\\`*_[\]<>#])/g, '\\$1');
}

function rtf(value) {
  let output = '';
  for (const character of String(value)) {
    if (character === '\\' || character === '{' || character === '}') output += `\\${character}`;
    else {
      const code = character.codePointAt(0);
      if (code >= 32 && code <= 126) output += character;
      else if (code === 10) output += '\\line ';
      else if (code <= 0xffff) output += `\\u${code > 32767 ? code - 65536 : code}?`;
      else {
        const adjusted = code - 0x10000;
        const high = 0xd800 + (adjusted >> 10);
        const low = 0xdc00 + (adjusted & 0x3ff);
        output += `\\u${high - 65536}?\\u${low - 65536}?`;
      }
    }
  }
  return output;
}

function assetMap(document) {
  return new Map(document.assets.map((asset) => [asset.key, asset]));
}

function publicationLines(document) {
  const lines = [{ kind: 'title', text: document.metadata.title }];
  if (document.metadata.subtitle) lines.push({ kind: 'subtitle', text: document.metadata.subtitle });
  if (document.metadata.author) lines.push({ kind: 'author', text: document.metadata.author });
  const appendBlocks = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'paragraph') lines.push({ kind: 'paragraph', text: block.text });
      else if (block.type === 'scene_break') lines.push({ kind: 'scene_break', text: '* * *' });
      else if (block.type === 'art') {
        lines.push({
          kind: 'art',
          text: `[Illustration: ${block.alt_text || 'No description provided'}]`,
          assetKey: block.asset_key,
        });
      }
    }
  };
  for (const section of document.front_matter) {
    lines.push({ kind: 'matter', text: section.title || section.role.replace(/-/g, ' ') });
    appendBlocks(section.blocks);
  }
  for (const volume of document.volumes) {
    lines.push({ kind: 'volume', text: volume.title || `Volume ${volume.ordinal}` });
    for (const chapter of volume.chapters) {
      lines.push({ kind: 'chapter', text: chapter.title || `Chapter ${chapter.ordinal}` });
      for (const page of chapter.pages) appendBlocks(page.blocks);
    }
  }
  for (const section of document.back_matter) {
    lines.push({ kind: 'matter', text: section.title || section.role.replace(/-/g, ' ') });
    appendBlocks(section.blocks);
  }
  return lines;
}

function headingLevel(kind) {
  if (kind === 'title') return 1;
  if (kind === 'volume' || kind === 'matter') return 2;
  if (kind === 'chapter') return 3;
  return null;
}

function renderText(document) {
  return Buffer.from(`${publicationLines(document).map((line) => line.text).join('\n\n')}\n`, 'utf8');
}

function renderMarkdown(document) {
  const assets = assetMap(document);
  const chunks = [];
  for (const line of publicationLines(document)) {
    const level = headingLevel(line.kind);
    if (level) chunks.push(`${'#'.repeat(level)} ${markdown(line.text)}`);
    else if (line.kind === 'author') chunks.push(`_${markdown(line.text)}_`);
    else if (line.kind === 'art') {
      const asset = assets.get(line.assetKey);
      const source = asset ? `data:${asset.media_type};base64,${asset.content_base64}` : '';
      chunks.push(`![${markdown(line.text.slice(15, -1))}](${source})\n\n${markdown(line.text)}`);
    } else chunks.push(markdown(line.text));
  }
  return Buffer.from(`${chunks.join('\n\n')}\n`, 'utf8');
}

function renderHtml(document) {
  const assets = assetMap(document);
  const chunks = [];
  for (const line of publicationLines(document)) {
    const level = headingLevel(line.kind);
    if (level) chunks.push(`<h${level}>${html(line.text)}</h${level}>`);
    else if (line.kind === 'author') chunks.push(`<p class="author">${html(line.text)}</p>`);
    else if (line.kind === 'scene_break') chunks.push('<hr aria-label="Scene break">');
    else if (line.kind === 'art') {
      const asset = assets.get(line.assetKey);
      if (!asset) continue;
      chunks.push(`<figure><img src="data:${asset.media_type};base64,${asset.content_base64}" alt="${html(asset.alt_text)}"><figcaption>${html(line.text)}</figcaption></figure>`);
    } else chunks.push(`<p>${html(line.text).replace(/\n/g, '<br>')}</p>`);
  }
  const title = html(document.metadata.title);
  const language = html(document.metadata.language);
  return Buffer.from(`<!doctype html>\n<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body>\n${chunks.join('\n')}\n</body></html>\n`, 'utf8');
}

function renderRtf(document) {
  const assets = assetMap(document);
  const chunks = ['{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Georgia;}}\\uc1'];
  for (const line of publicationLines(document)) {
    const level = headingLevel(line.kind);
    if (level) chunks.push(`\\pard\\sa240\\b\\fs${level === 1 ? 40 : level === 2 ? 32 : 28} ${rtf(line.text)}\\b0\\fs24\\par`);
    else chunks.push(`\\pard\\sa160 ${rtf(line.text)}\\par`);
    if (line.kind === 'art') {
      const asset = assets.get(line.assetKey);
      if (asset && (asset.media_type === 'image/png' || asset.media_type === 'image/jpeg')) {
        const control = asset.media_type === 'image/png' ? '\\pngblip' : '\\jpegblip';
        chunks.push(`{\\pict${control}\n${Buffer.from(asset.content_base64, 'base64').toString('hex')}\n}`);
      }
    }
  }
  chunks.push('}');
  return Buffer.from(chunks.join('\n'), 'ascii');
}

function docxParagraph(line, relationshipId = null) {
  const level = headingLevel(line.kind);
  const style = level ? `<w:pPr><w:pStyle w:val="${level === 1 ? 'Title' : `Heading${level - 1}`}"/></w:pPr>` : '';
  const text = `<w:r><w:t xml:space="preserve">${xml(line.text)}</w:t></w:r>`;
  if (!relationshipId) return `<w:p>${style}${text}</w:p>`;
  const drawing = `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="4572000" cy="3048000"/><wp:docPr id="${relationshipId.slice(3)}" name="${xml(line.assetKey)}" descr="${xml(line.text)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${xml(line.assetKey)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="3048000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return `<w:p>${text}</w:p><w:p>${drawing}</w:p>`;
}

function extensionFor(asset) {
  return asset.media_type === 'image/jpeg' ? 'jpg' : asset.media_type === 'image/webp' ? 'webp' : 'png';
}

function renderDocx(document) {
  const assets = assetMap(document);
  const relationships = [];
  const mediaEntries = [];
  const relationshipByKey = new Map();
  for (const [index, asset] of document.assets.entries()) {
    const rid = `rId${index + 1}`;
    const ext = extensionFor(asset);
    relationshipByKey.set(asset.key, rid);
    relationships.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${asset.key}.${ext}"/>`);
    mediaEntries.push({ name: `word/media/${asset.key}.${ext}`, data: Buffer.from(asset.content_base64, 'base64') });
  }
  const body = publicationLines(document).map((line) => docxParagraph(line, line.kind === 'art' && assets.has(line.assetKey) ? relationshipByKey.get(line.assetKey) : null)).join('');
  const imageDefaults = [...new Set(document.assets.map(extensionFor))].map((ext) => `<Default Extension="${ext}" ContentType="${ext === 'jpg' ? 'image/jpeg' : `image/${ext}`}"/>`).join('');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...mediaEntries,
  ]);
}

function renderOdt(document) {
  const assets = assetMap(document);
  const entries = [];
  const manifestImages = [];
  const content = [];
  for (const line of publicationLines(document)) {
    const level = headingLevel(line.kind);
    if (level) content.push(`<text:h text:outline-level="${level}">${xml(line.text)}</text:h>`);
    else content.push(`<text:p>${xml(line.text).replace(/\n/g, '<text:line-break/>')}</text:p>`);
    if (line.kind === 'art') {
      const asset = assets.get(line.assetKey);
      if (!asset) continue;
      const filename = `Pictures/${asset.key}.${extensionFor(asset)}`;
      entries.push({ name: filename, data: Buffer.from(asset.content_base64, 'base64') });
      manifestImages.push(`<manifest:file-entry manifest:full-path="${filename}" manifest:media-type="${asset.media_type}"/>`);
      content.push(`<text:p><draw:frame draw:name="${xml(asset.key)}" svg:width="6in" svg:height="4in"><svg:title>${xml(asset.alt_text)}</svg:title><draw:image xlink:href="${filename}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`);
    }
  }
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3"><office:body><office:text>${content.join('')}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:styles/></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${manifestImages.join('')}</manifest:manifest>`;
  return zipStore([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml', data: contentXml },
    { name: 'styles.xml', data: styles },
    { name: 'META-INF/manifest.xml', data: manifest },
    ...entries,
  ]);
}

function renderEpub(document) {
  const assets = assetMap(document);
  const mediaEntries = [];
  const manifestImages = [];
  const sections = []; const included = new Set(); let body = [];
  const language = xml(document.metadata.language);
  const title = xml(document.metadata.title);
  const xhtml = (content, fixed = false) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="${language}" xml:lang="${language}"><head><title>${title}</title>${fixed ? '<meta name="viewport" content="width=1200,height=1600"/>' : ''}<link rel="stylesheet" href="style.css"/></head><body${fixed ? ' class="image-page"' : ''}>${content}</body></html>`;
  const flush = () => {
    if (!body.length) return;
    const id = sections.length ? `text-${sections.length + 1}` : 'book';
    sections.push({ id, href: `${id}.xhtml`, fixed: false, content: xhtml(body.join('\n')) }); body = [];
  };
  for (const line of publicationLines(document)) {
    const level = headingLevel(line.kind);
    if (level) body.push(`<h${level}>${xml(line.text)}</h${level}>`);
    else if (line.kind === 'scene_break') body.push('<hr/>');
    else if (line.kind === 'art') {
      const asset = assets.get(line.assetKey);
      if (!asset) continue;
      const ext = extensionFor(asset);
      const name = `images/${asset.key}.${ext}`;
      if (!included.has(asset.key)) {
        included.add(asset.key);
        mediaEntries.push({ name: `EPUB/${name}`, data: Buffer.from(asset.content_base64, 'base64') });
        manifestImages.push(`<item id="${asset.key}" href="${name}" media-type="${asset.media_type}"/>`);
      }
      flush();
      const id = `image-${sections.length + 1}`;
      sections.push({ id, href: `${id}.xhtml`, fixed: true,
        content: xhtml(`<figure><img src="${name}" alt="${xml(asset.alt_text)}"/><figcaption>${xml(line.text)}</figcaption></figure>`, true) });
    } else body.push(`<p>${xml(line.text).replace(/\n/g, '<br/>')}</p>`);
  }
  flush();
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}"><head><title>${title}</title></head><body><nav epub:type="toc" id="toc"><h1>${title}</h1><ol><li><a href="book.xhtml">${title}</a></li></ol></nav></body></html>`;
  const identifier = `urn:sha256:${createHash('sha256').update(JSON.stringify(document)).digest('hex')}`;
  const modified = /^\d{4}-\d{2}-\d{2}/.test(document.metadata.date || '')
    ? `${document.metadata.date.slice(0, 10)}T00:00:00Z`
    : '2000-01-01T00:00:00Z';
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" prefix="rendition: http://www.idpf.org/vocab/rendition/#" version="3.0" unique-identifier="book-id" xml:lang="${language}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:language>${language}</dc:language>${document.metadata.author ? `<dc:creator>${xml(document.metadata.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta><meta property="rendition:layout">reflowable</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${sections.map((section) => `<item id="${section.id}" href="${section.href}" media-type="application/xhtml+xml"/>`).join('')}<item id="css" href="style.css" media-type="text/css"/>${manifestImages.join('')}</manifest><spine>${sections.map((section) => `<itemref idref="${section.id}"${section.fixed ? ' properties="rendition:layout-pre-paginated rendition:spread-none"' : ''}/>`).join('')}</spine></package>`;
  return zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: 'EPUB/package.opf', data: opf },
    { name: 'EPUB/nav.xhtml', data: nav },
    ...sections.map((section) => ({ name: `EPUB/${section.href}`, data: section.content })),
    // EPUB 3.3 §8.2: each illustration is one fixed-layout spine page;
    // prose remains reflowable and never shares that image resource.
    { name: 'EPUB/style.css', data: 'body{font-family:serif;line-height:1.55;margin:5%;}p{orphans:2;widows:2;}img{max-width:100%;height:auto;}figure{break-inside:avoid;text-align:center;}body.image-page{width:1200px;height:1600px;margin:0;}.image-page figure{margin:0;padding:60px;box-sizing:border-box;height:1600px;}.image-page img{width:1080px;height:1000px;object-fit:contain;}.image-page figcaption{font-size:18px;line-height:1.35;overflow-wrap:anywhere;margin-top:30px;}hr{border:0;text-align:center;}hr:after{content:"* * *";}' },
    ...mediaEntries,
  ]);
}

function utf16beHex(value, bom = false) {
  const little = Buffer.from(String(value), 'utf16le');
  const big = Buffer.alloc(little.length + (bom ? 2 : 0));
  let offset = 0;
  if (bom) { big[0] = 0xfe; big[1] = 0xff; offset = 2; }
  for (let index = 0; index < little.length; index += 2) {
    big[offset + index] = little[index + 1];
    big[offset + index + 1] = little[index];
  }
  return big.toString('hex').toUpperCase();
}

function wrapText(value, limit = 72) {
  const lines = [];
  for (const sourceLine of String(value).split('\n')) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      if (current && current.length + word.length + 1 > limit) {
        lines.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

function pdfStream(dictionary, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${buffer.length} >>\nstream\n`, 'ascii'),
    buffer,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

function buildPdfObjects(objects, rootRef, infoRef) {
  const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let offset = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const header = Buffer.from(`${index + 1} 0 obj\n`, 'ascii');
    const body = Buffer.isBuffer(object) ? object : Buffer.from(object, 'binary');
    const footer = Buffer.from('\nendobj\n', 'ascii');
    chunks.push(header, body, footer);
    offset += header.length + body.length + footer.length;
  }
  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (const value of offsets.slice(1)) xref.push(`${String(value).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root ${rootRef} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join(''), 'ascii'));
  return Buffer.concat(chunks);
}

function renderPdf(document) {
  const lines = publicationLines(document);
  const characters = [...new Set(lines.flatMap((line) => [...line.text]))];
  const glyphFor = (character) => LITERATA_CMAP.glyphs[String(character.codePointAt(0))] || { id: 0, width: 500 };
  const cidByCharacter = new Map(characters.map((character) => [character, glyphFor(character).id]));
  const encode = (value) => [...String(value)].map((character) => cidByCharacter.get(character).toString(16).padStart(4, '0')).join('').toUpperCase();
  const mappedCharacters = characters.filter((character, index) =>
    characters.findIndex((candidate) => cidByCharacter.get(candidate) === cidByCharacter.get(character)) === index);
  const cmapEntries = mappedCharacters.map((character) =>
    `<${cidByCharacter.get(character).toString(16).padStart(4, '0').toUpperCase()}> <${utf16beHex(character)}>`).join('\n');
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /STUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${mappedCharacters.length} beginbfchar\n${cmapEntries}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const fontPath = path.join(__dirname, '../../../../frontend/fonts/literata-latin.ttf');
  const fontData = fs.readFileSync(fontPath);
  const objects = [];
  const add = (value) => { objects.push(value); return objects.length; };
  const reserve = () => add(null);
  const fontFileRef = add(pdfStream(`/Length1 ${fontData.length}`, fontData));
  const toUnicodeRef = add(pdfStream('', cmap));
  const descriptorRef = add(`<< /Type /FontDescriptor /FontName /STLiterataSubset /Flags 4 /FontBBox [-300 -300 1400 1200] /ItalicAngle 0 /Ascent 950 /Descent -250 /CapHeight 700 /StemV 80 /FontFile2 ${fontFileRef} 0 R >>`);
  const widths = mappedCharacters.map((character) => `${cidByCharacter.get(character)} [${glyphFor(character).width}]`).join(' ');
  const cidFontRef = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /STLiterataSubset /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorRef} 0 R /W [${widths}] /CIDToGIDMap /Identity >>`);
  const fontRef = add(`<< /Type /Font /Subtype /Type0 /BaseFont /STLiterataSubset /Encoding /Identity-H /DescendantFonts [${cidFontRef} 0 R] /ToUnicode ${toUnicodeRef} 0 R >>`);
  const assetRefs = new Map();
  for (const asset of document.assets) {
    const bytes = Buffer.from(asset.content_base64, 'base64');
    assetRefs.set(asset.key, add(pdfStream(`/Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, bytes)));
  }
  const pagesRef = reserve();
  const pageData = [];
  let commands = [];
  let y = 780;
  const finishPage = () => {
    if (commands.length) pageData.push(commands.join('\n'));
    commands = [];
    y = 780;
  };
  const beginActual = (value) => `/Span << /ActualText <${utf16beHex(value, true)}> >> BDC`;
  for (const line of lines) {
    const size = line.kind === 'title' ? 24 : ['volume', 'matter'].includes(line.kind) ? 18 : line.kind === 'chapter' ? 15 : 11;
    const leading = Math.ceil(size * 1.45);
    if (line.kind === 'art') {
      if (y < 300) finishPage();
      const imageRef = assetRefs.get(line.assetKey);
      if (imageRef) {
        const asset = document.assets.find((item) => item.key === line.assetKey);
        const width = 360;
        const height = Math.min(230, width * asset.height / asset.width);
        y -= height;
        commands.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 117.5 ${y.toFixed(2)} cm /Im${imageRef} Do Q`);
        y -= 18;
      }
    }
    const wrapped = wrapText(line.text, size >= 18 ? 44 : 78);
    const needed = wrapped.length * leading + (size >= 15 ? 12 : 8);
    if (y - needed < 62) finishPage();
    commands.push(beginActual(line.text));
    for (const part of wrapped) {
      commands.push(`BT /F1 ${size} Tf 1 0 0 1 64 ${y} Tm <${encode(part)}> Tj ET`);
      y -= leading;
    }
    commands.push('EMC');
    y -= size >= 15 ? 12 : 8;
  }
  finishPage();
  const pageRefs = [];
  const xObjects = [...assetRefs.entries()].map(([, ref]) => `/Im${ref} ${ref} 0 R`).join(' ');
  for (const content of pageData) {
    const contentRef = add(pdfStream('', content));
    pageRefs.push(add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRef} 0 R >> /XObject << ${xObjects} >> >> /Contents ${contentRef} 0 R >>`));
  }
  objects[pagesRef - 1] = `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] >>`;
  const catalogRef = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R /Lang (${document.metadata.language}) >>`);
  const infoRef = add(`<< /Title <${utf16beHex(document.metadata.title, true)}> /Author <${utf16beHex(document.metadata.author || '', true)}> /Creator (Ink Morrow) >>`);
  return buildPdfObjects(objects, catalogRef, infoRef);
}

function validateEpub(buffer) {
  const entries = storedZipEntries(buffer);
  const required = ['mimetype', 'META-INF/container.xml', 'EPUB/package.opf', 'EPUB/nav.xhtml', 'EPUB/book.xhtml'];
  const missing = required.filter((name) => !entries.has(name));
  if (missing.length) return { valid: false, errors: missing.map((name) => `Missing ${name}`) };
  if (entries.get('mimetype').toString() !== 'application/epub+zip') return { valid: false, errors: ['Invalid mimetype'] };
  const opf = entries.get('EPUB/package.opf').toString('utf8');
  const errors = [];
  if (!/<package\b[^>]*version="3\.0"/.test(opf)) errors.push('Package is not EPUB 3.x');
  if (!/properties="nav"/.test(opf)) errors.push('Navigation document is not declared');
  for (const match of opf.matchAll(/href="([^"]+)"/g)) {
    if (!entries.has(`EPUB/${match[1]}`)) errors.push(`Missing manifest resource ${match[1]}`);
  }
  const ids = new Set([...opf.matchAll(/<item\s+id="([^"]+)"/g)].map((match) => match[1]));
  const spine = [...opf.matchAll(/<itemref\s+idref="([^"]+)"/g)];
  if (!spine.length) errors.push('Spine is empty');
  for (const match of spine) if (!ids.has(match[1])) errors.push(`Unknown spine item ${match[1]}`);
  return { valid: errors.length === 0, errors };
}

function validatePdf(buffer) {
  const source = buffer.toString('latin1');
  const errors = [];
  if (!source.startsWith('%PDF-1.7')) errors.push('Missing PDF 1.7 header');
  if (!/xref\s/.test(source) || !/%%EOF\s*$/.test(source)) errors.push('Missing cross-reference or EOF');
  if (!/\/FontFile2\s+\d+\s+0\s+R/.test(source)) errors.push('Publication font is not embedded');
  if (!/\/ToUnicode\s+\d+\s+0\s+R/.test(source)) errors.push('Unicode extraction map is missing');
  if (!/\/Type\s*\/Page\b/.test(source)) errors.push('PDF has no page');
  return { valid: errors.length === 0, errors };
}

async function adapterDocument(document, format) {
  if (!['docx', 'odt', 'rtf', 'pdf', 'epub'].includes(format) || !document.assets.some((asset) => asset.media_type === 'image/webp')) {
    return document;
  }
  const assets = [];
  for (const asset of document.assets) {
    if (asset.media_type !== 'image/webp') { assets.push(asset); continue; }
    const image = sharp(Buffer.from(asset.content_base64, 'base64'));
    const converted = format === 'pdf' ? await image.jpeg({ quality: 88 }).toBuffer() : await image.png().toBuffer();
    assets.push({
      ...asset,
      media_type: format === 'pdf' ? 'image/jpeg' : 'image/png',
      content_base64: converted.toString('base64'),
      sha256: createHash('sha256').update(converted).digest('hex'),
    });
  }
  return { ...document, assets };
}

async function renderPublication(document, format) {
  if (!PUBLICATION_FORMATS.includes(format)) {
    const error = new Error(`Unsupported publication format: ${format}.`);
    error.statusCode = 400;
    error.code = 'PUBLICATION_FORMAT_UNSUPPORTED';
    throw error;
  }
  const adapted = await adapterDocument(document, format);
  const buffer = format === 'docx' ? renderDocx(adapted)
    : format === 'odt' ? renderOdt(adapted)
      : format === 'rtf' ? renderRtf(adapted)
        : format === 'epub' ? renderEpub(adapted)
          : format === 'pdf' ? renderPdf(adapted)
        : format === 'html' ? renderHtml(adapted)
          : format === 'md' ? renderMarkdown(adapted)
            : format === 'txt' ? renderText(adapted)
              : Buffer.from(`${JSON.stringify(adapted, null, 2)}\n`, 'utf8');
  return { buffer, contentType: MIME[format], extension: format };
}

async function *publicationChunks(document, format) {
  if (format === 'txt') {
    const lines = publicationLines(document);
    for (const [index, line] of lines.entries()) {
      yield Buffer.from(`${index ? '\n\n' : ''}${line.text}`, 'utf8');
    }
    yield Buffer.from('\n', 'utf8');
    return;
  }
  yield (await renderPublication(document, format)).buffer;
}

function semanticView(document) {
  return publicationLines(document).map(({ kind, text }) => ({ kind, text }));
}

function decodeEntities(value) {
  return String(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function storedZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (method !== 0) throw new Error('Semantic re-read supports the deterministic stored packages emitted by Ink Morrow.');
    entries.set(name, buffer.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function xmlTextSequence(source, elementPattern) {
  const values = [];
  for (const match of source.matchAll(elementPattern)) {
    const inner = match[1].replace(/<(?:w:br|text:line-break)\s*\/?\s*>/g, '\n').replace(/<[^>]+>/g, '');
    values.push(decodeEntities(inner));
  }
  return values;
}

function htmlTextSequence(source) {
  const values = [];
  const pattern = /<(h[1-3]|p|figcaption)\b[^>]*>([\s\S]*?)<\/\1>|<hr\b[^>]*>/gi;
  for (const match of source.matchAll(pattern)) {
    if (!match[1]) values.push('* * *');
    else {
      const inner = match[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      values.push(decodeEntities(inner));
    }
  }
  return values;
}

function markdownTextSequence(source) {
  return source.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).flatMap((chunk) => {
    if (/^!\[/.test(chunk)) {
      const caption = chunk.split(/\n{2,}|\n/).find((line) => !/^!\[/.test(line));
      return caption ? [caption] : [];
    }
    let value = chunk.replace(/^#{1,3}\s+/, '');
    if (/^_[\s\S]*_$/.test(value)) value = value.slice(1, -1);
    value = value.replace(/\\(.)/gs, (escaped, character) =>
      '\\`*_[]<>#'.includes(character) ? character : escaped);
    return [value];
  });
}

function rtfTextSequence(source) {
  const values = [];
  for (const line of source.split('\n')) {
    if (!line.includes('\\pard')) continue;
    let value = line
      .replace(/^.*?\\(?:fs\d+ )/, '')
      .replace(/^.*?\\sa\d+ /, '')
      .replace(/\\b0|\\b|\\fs\d+|\\par/g, '')
      .replace(/\\line\s?/g, '\n')
      .replace(/\\u(-?\d+)\?/g, (_, encoded) => String.fromCharCode((Number(encoded) + 65536) % 65536))
      .replace(/\\([\\{}])/g, '$1')
      .trim();
    if (value) values.push(value);
  }
  return values;
}

function decodeUtf16beHex(value) {
  const source = Buffer.from(value, 'hex');
  const start = source.length >= 2 && source[0] === 0xfe && source[1] === 0xff ? 2 : 0;
  const little = Buffer.alloc(source.length - start);
  for (let index = start; index < source.length; index += 2) {
    little[index - start] = source[index + 1];
    little[index - start + 1] = source[index];
  }
  return little.toString('utf16le');
}

function rereadPublication(format, buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (format === 'json') return semanticView(JSON.parse(source.toString('utf8'))).map((item) => item.text);
  if (format === 'pdf') {
    return [...source.toString('latin1').matchAll(/\/ActualText\s*<([A-F0-9]+)>/g)]
      .map((match) => decodeUtf16beHex(match[1]));
  }
  if (format === 'txt') return source.toString('utf8').trim().split(/\n{2,}/);
  if (format === 'md') return markdownTextSequence(source.toString('utf8'));
  if (format === 'html') return htmlTextSequence(source.toString('utf8'));
  if (format === 'rtf') return rtfTextSequence(source.toString('ascii'));
  const entries = storedZipEntries(source);
  if (format === 'epub') {
    const opf = entries.get('EPUB/package.opf')?.toString('utf8') || '';
    const items = new Map([...opf.matchAll(/<item\s+id="([^"]+)"\s+href="([^"]+)"/g)].map((match) => [match[1], match[2]]));
    return [...opf.matchAll(/<itemref\s+idref="([^"]+)"/g)].flatMap((match) => {
      const content = entries.get(`EPUB/${items.get(match[1])}`);
      if (!content) throw new Error('EPUB spine resource is missing.');
      return htmlTextSequence(content.toString('utf8'));
    });
  }
  if (format === 'docx') {
    const documentXml = entries.get('word/document.xml');
    if (!documentXml) throw new Error('DOCX has no word/document.xml.');
    return xmlTextSequence(documentXml.toString('utf8'), /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g).filter(Boolean);
  }
  if (format === 'odt') {
    const contentXml = entries.get('content.xml');
    if (!contentXml) throw new Error('ODT has no content.xml.');
    const visibleContent = contentXml.toString('utf8').replace(/<text:p><draw:frame\b[\s\S]*?<\/draw:frame><\/text:p>/g, '');
    return xmlTextSequence(visibleContent, /<(?:text:h|text:p)\b[^>]*>([\s\S]*?)<\/(?:text:h|text:p)>/g)
      .filter(Boolean);
  }
  throw new Error(`Unsupported publication format: ${format}.`);
}

module.exports = {
  MIME,
  publicationLines,
  semanticView,
  renderPublication,
  publicationChunks,
  adapterDocument,
  rereadPublication,
  storedZipEntries,
  validateEpub,
  validatePdf,
  xml,
  rtf,
};
