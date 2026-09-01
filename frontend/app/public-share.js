const status = document.getElementById('shareStatus');
const target = document.getElementById('shareDocument');

function node(tag, className = '', text = '') {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function appendBlock(parent, block, assets) {
  if (block.type === 'paragraph') parent.appendChild(node('p', '', block.text));
  else if (block.type === 'scene_break') parent.appendChild(node('hr', 'share-scene-break'));
  else if (block.type === 'art') {
    const asset = assets.get(block.asset_key);
    if (!asset) return;
    const figure = node('figure', 'share-art');
    const image = node('img');
    image.src = `data:${asset.media_type};base64,${asset.content_base64}`;
    image.alt = block.alt_text || 'Image without a supplied description.';
    figure.appendChild(image);
    if (asset.title) figure.appendChild(node('figcaption', '', asset.title));
    parent.appendChild(figure);
  }
}

function matter(section, className, assets) {
  if (!section.length) return null;
  const wrapper = node('section', className);
  for (const item of section) {
    if (item.title) wrapper.appendChild(node('h2', '', item.title));
    for (const block of item.blocks || []) appendBlock(wrapper, block, assets);
  }
  return wrapper;
}

function render(publication) {
  const documentValue = publication.document;
  document.documentElement.lang = documentValue.metadata.language || 'en';
  document.title = `${documentValue.metadata.title} · ScribeTribe reading copy`;
  const heading = node('header', 'share-title');
  heading.appendChild(node('h1', '', documentValue.metadata.title));
  if (documentValue.metadata.subtitle) heading.appendChild(node('p', 'share-subtitle', documentValue.metadata.subtitle));
  if (documentValue.metadata.author) heading.appendChild(node('p', 'share-author', `by ${documentValue.metadata.author}`));
  target.appendChild(heading);
  const assets = new Map(documentValue.assets.map((asset) => [asset.key, asset]));
  const front = matter(documentValue.front_matter, 'share-matter share-matter--front', assets);
  if (front) target.appendChild(front);
  for (const volume of documentValue.volumes) {
    const volumeSection = node('section', 'share-volume');
    if (volume.title) volumeSection.appendChild(node('h2', '', volume.title));
    for (const chapter of volume.chapters) {
      const chapterSection = node('section', 'share-chapter');
      if (chapter.title) chapterSection.appendChild(node('h3', '', chapter.title));
      for (const page of chapter.pages) {
        const pageSection = node('section', 'share-page');
        pageSection.setAttribute('aria-label', `Page ${page.ordinal}`);
        for (const block of page.blocks) {
          appendBlock(pageSection, block, assets);
        }
        chapterSection.appendChild(pageSection);
      }
      volumeSection.appendChild(chapterSection);
    }
    target.appendChild(volumeSection);
  }
  const back = matter(documentValue.back_matter, 'share-matter share-matter--back', assets);
  if (back) target.appendChild(back);
  const proof = node('p', 'share-proof', `Snapshot ${publication.snapshot_sha256.slice(0, 12)} · created ${publication.created_at}`);
  if (publication.expires_at) proof.append(` · link expires ${publication.expires_at}`);
  target.appendChild(proof);
  status.hidden = true;
  target.hidden = false;
}

async function openShare() {
  const capability = window.location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw new Error('unavailable');
  const response = await fetch('/api/public-share', {
    method: 'GET',
    headers: { Authorization: `Share ${capability}` },
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('unavailable');
  const body = await response.json();
  render(body.publication);
}

openShare().catch(() => {
  status.classList.add('share-status--failed');
  status.textContent = 'This reading-copy link is unavailable. It may have expired or been revoked.';
});
