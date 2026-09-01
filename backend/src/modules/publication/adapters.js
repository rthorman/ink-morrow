'use strict';

const { zipStore } = require('../../epub');
const sharp = require('sharp');
const { PUBLICATION_FORMATS } = require('./document');

const MIME = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
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

async function adapterDocument(document, format) {
  if (!['docx', 'odt', 'rtf'].includes(format) || !document.assets.some((asset) => asset.media_type === 'image/webp')) {
    return document;
  }
  const assets = await Promise.all(document.assets.map(async (asset) => {
    if (asset.media_type !== 'image/webp') return asset;
    const png = await sharp(Buffer.from(asset.content_base64, 'base64')).png().toBuffer();
    return { ...asset, media_type: 'image/png', content_base64: png.toString('base64') };
  }));
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
    if (method !== 0) throw new Error('Semantic re-read supports the deterministic stored packages emitted by ScribeTribe.');
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

function rereadPublication(format, buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (format === 'json') return semanticView(JSON.parse(source.toString('utf8'))).map((item) => item.text);
  if (format === 'txt') return source.toString('utf8').trim().split(/\n{2,}/);
  if (format === 'md') return markdownTextSequence(source.toString('utf8'));
  if (format === 'html') return htmlTextSequence(source.toString('utf8'));
  if (format === 'rtf') return rtfTextSequence(source.toString('ascii'));
  const entries = storedZipEntries(source);
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
  xml,
  rtf,
};
