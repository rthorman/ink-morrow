const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

function inline(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure><img src="$2" alt="$1"><figcaption>$1</figcaption></figure>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function table(lines) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
  const rows = lines.map(cells);
  const head = rows.shift();
  return `<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let listType = null;
  let quote = [];
  let code = null;
  let callout = null;

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listType) html.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (code !== null) {
      if (line.startsWith('```')) {
        html.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
        code = null;
      } else code += `${line}\n`;
      continue;
    }
    if (line.startsWith('```')) { flushAll(); code = ''; continue; }
    if (callout) {
      if (line.trim() === ':::') {
        flushParagraph();
        html.push('</div>');
        callout = null;
      } else if (!line.trim()) flushParagraph();
      else paragraph.push(line.trim());
      continue;
    }
    const calloutMatch = line.match(/^:::\s+(note|warning|danger|good)\s*(.*)$/);
    if (calloutMatch) {
      flushAll();
      callout = calloutMatch[1];
      html.push(`<div class="callout ${callout}">${calloutMatch[2] ? `<span class="callout-title">${inline(calloutMatch[2])}</span>` : ''}`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-+/.test(lines[index + 1] || '')) {
      flushAll();
      const tableLines = [line];
      index += 2;
      while (index < lines.length && /^\|.*\|\s*$/.test(lines[index])) { tableLines.push(lines[index]); index += 1; }
      index -= 1;
      html.push(table(tableLines));
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const label = heading[2];
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${level} id="${id}">${inline(label)}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(); flushQuote();
      const wanted = unordered ? 'ul' : 'ol';
      if (listType !== wanted) { flushList(); listType = wanted; html.push(`<${wanted}>`); }
      html.push(`<li>${inline((unordered || ordered)[1])}</li>`);
      continue;
    }
    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) { flushParagraph(); flushList(); quote.push(blockquote[1]); continue; }
    if (/^---+$/.test(line.trim())) { flushAll(); html.push('<hr>'); continue; }
    if (!line.trim()) { flushAll(); continue; }
    if (/^<\/?[a-z][^>]*>$/i.test(line.trim())) {
      flushAll();
      html.push(line.trim());
      continue;
    }
    paragraph.push(line.trim());
  }
  flushAll();
  if (code !== null) html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
  if (callout) html.push('</div>');
  return html.join('\n');
}
