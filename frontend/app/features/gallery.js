// PR 14 Gallery: one owner-facing surface for local uploads, generated art,
// explicit provider references, and noncanonical manuscript placements.

import { formatMb, formatUsd } from '../core/dom.js';
import { chooseWorkspaceStory } from '../core/story-context.js';

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createGallery({ api, state, notify, features, dialogs, shell, router }) {
  const { apiCall, apiFetch, API_BASE_URL } = api;
  const { showError, showSuccess } = notify;
  let routeController = router;
  let activeStoryId = null;
  let assets = [];
  let placements = [];
  let anchors = [];
  let loadToken = 0;
  const selectedReferences = new Set();

  function setStatus(text) {
    const target = document.getElementById('galleryStatus');
    if (target) target.textContent = text;
  }

  function placementLabel(placement) {
    if (placement.after_page_id === null) return 'Before first page';
    const anchor = anchors.find((item) => item.page_id === placement.after_page_id);
    return anchor ? `After page ${anchor.page_number}` : 'Unplaced from a removed page';
  }

  function anchorSelect({ value = '__gallery__', allowGallery = true, label = 'Placement' } = {}) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    if (allowGallery) {
      const gallery = document.createElement('option');
      gallery.value = '__gallery__';
      gallery.textContent = 'Gallery only (unplaced)';
      select.appendChild(gallery);
    }
    const before = document.createElement('option');
    before.value = '';
    before.textContent = 'Before first page';
    select.appendChild(before);
    for (const anchor of anchors) {
      const option = document.createElement('option');
      option.value = anchor.page_id;
      option.textContent = `After page ${anchor.page_number}`;
      select.appendChild(option);
    }
    select.value = value;
    return select;
  }

  function syncSelectedReferences() {
    for (const id of [...selectedReferences]) {
      const asset = assets.find((item) => item.id === id);
      if (!asset?.provider_reference_allowed || asset.status !== 'ready') selectedReferences.delete(id);
    }
    features.imagery.setAssetReferences([...selectedReferences]);
    const target = document.getElementById('galleryReferenceSummary');
    if (!target) return;
    target.textContent = selectedReferences.size
      ? `${selectedReferences.size} explicitly approved Gallery image${selectedReferences.size === 1 ? '' : 's'} selected for the next AI painting.`
      : 'No Gallery images are selected for the next AI painting.';
  }

  async function mutate(work, success) {
    try {
      await work();
      await load(activeStoryId);
      await features.write.refreshStoryAssets(activeStoryId);
      if (success) showSuccess(success);
    } catch (error) {
      showError(error.message);
    }
  }

  function metadataEditor(asset, card) {
    const form = el('form', 'gallery-card__metadata');
    const titleLabel = el('label', '', 'Title');
    const title = document.createElement('input');
    title.type = 'text';
    title.maxLength = 500;
    title.value = asset.title || '';
    titleLabel.appendChild(title);
    const altLabel = el('label', '', 'Alt text');
    const alt = document.createElement('textarea');
    alt.rows = 2;
    alt.maxLength = 2000;
    alt.value = asset.alt_text || '';
    altLabel.appendChild(alt);
    const permission = el('label', 'gallery-check');
    const permissionBox = document.createElement('input');
    permissionBox.type = 'checkbox';
    permissionBox.checked = asset.provider_reference_allowed;
    permission.append(permissionBox, el('span', '', 'Permit this image to be used as a provider reference'));
    const save = el('button', 'btn btn-secondary', 'Save details');
    save.type = 'submit';
    form.append(titleLabel, altLabel, permission, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      await mutate(
        () => apiCall(`/stories/${activeStoryId}/assets/${asset.id}`, 'PATCH', {
          title: title.value.trim() || null,
          alt_text: alt.value.trim() || null,
          provider_reference_allowed: permissionBox.checked,
        }),
        'Image details saved. Provider-reference permission follows only this asset on this device.',
      );
      save.disabled = false;
    });

    const selectReference = el('label', 'gallery-check gallery-check--reference');
    const selectBox = document.createElement('input');
    selectBox.type = 'checkbox';
    selectBox.checked = selectedReferences.has(asset.id);
    selectBox.disabled = !asset.provider_reference_allowed;
    selectBox.setAttribute('aria-label', `Select ${asset.title || 'image'} for next AI painting`);
    selectBox.addEventListener('change', () => {
      if (selectBox.checked) selectedReferences.add(asset.id);
      else selectedReferences.delete(asset.id);
      syncSelectedReferences();
    });
    selectReference.append(selectBox, el('span', '', asset.provider_reference_allowed
      ? 'Include in the next AI painting'
      : 'Permit provider reference before selecting'));
    card.append(form, selectReference);
  }

  function placementEditor(asset, card) {
    const block = el('div', 'gallery-card__placements');
    block.appendChild(el('h4', '', 'Placements'));
    const rows = placements.filter((item) => item.asset_id === asset.id);
    for (const placement of rows) {
      const row = el('div', 'gallery-placement');
      const select = anchorSelect({ value: placement.after_page_id || '', allowGallery: false, label: `Move ${asset.title || 'image'} from ${placementLabel(placement)}` });
      const move = el('button', 'btn btn-secondary', 'Move');
      move.type = 'button';
      move.addEventListener('click', () => mutate(
        () => apiCall(`/stories/${activeStoryId}/placements/${placement.id}`, 'PATCH', {
          after_page_id: select.value || null,
          ordinal: placement.ordinal,
        }),
        'Placement moved. Narrative page order and remembered canon are unchanged.',
      ));
      const unplace = el('button', 'btn btn-secondary', 'Unplace');
      unplace.type = 'button';
      unplace.addEventListener('click', () => mutate(
        () => apiCall(`/stories/${activeStoryId}/placements/${placement.id}`, 'DELETE'),
        'Image returned to Gallery-only storage. The manuscript is unchanged.',
      ));
      row.append(select, move, unplace);
      block.appendChild(row);
    }
    if (!rows.length) block.appendChild(el('p', 'gallery-card__muted', 'Gallery only · not placed in the manuscript'));
    const add = el('div', 'gallery-placement gallery-placement--add');
    const select = anchorSelect({ value: '__gallery__', allowGallery: true, label: `Add placement for ${asset.title || 'image'}` });
    const button = el('button', 'btn btn-secondary', 'Add placement');
    button.type = 'button';
    button.disabled = true;
    select.addEventListener('change', () => { button.disabled = select.value === '__gallery__'; });
    button.addEventListener('click', () => mutate(
      () => apiCall(`/stories/${activeStoryId}/assets/${asset.id}/placements`, 'POST', {
        after_page_id: select.value || null,
      }),
      'Placement added without changing narrative numbering or canon.',
    ));
    add.append(select, button);
    block.appendChild(add);
    card.appendChild(block);
  }

  function provenance(asset) {
    const box = el('div', 'gallery-card__provenance');
    if (asset.source === 'uploaded') {
      box.appendChild(el('p', '', 'Source: uploaded locally · no provider request or AI analysis'));
    } else {
      const provider = asset.provider_provenance?.provider || {};
      box.appendChild(el('p', '', `Source: AI-generated${provider.profile_name ? ` via ${provider.profile_name}` : ''}${provider.model ? ` · ${provider.model}` : ''}`));
      const refs = asset.provider_provenance?.references || [];
      box.appendChild(el('p', '', refs.length ? `References sent: ${refs.length} explicitly resolved image${refs.length === 1 ? '' : 's'}` : 'References sent: none recorded'));
      if (typeof asset.spend_usd === 'number') box.appendChild(el('p', '', `Recorded painting cost: ${formatUsd(asset.spend_usd)}`));
    }
    box.appendChild(el('p', '', `${asset.width}×${asset.height} WebP · ${formatMb(asset.size_bytes || 0)} · normalized derivative · metadata stripped`));
    return box;
  }

  function render() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    grid.textContent = '';
    syncSelectedReferences();
    for (const asset of assets) {
      const card = el('article', 'gallery-card');
      const img = document.createElement('img');
      img.src = asset.content_url;
      img.alt = asset.alt_text || '';
      img.loading = 'lazy';
      const heading = el('h3', '', asset.title || (asset.source === 'uploaded' ? 'Uploaded image' : 'AI painting'));
      card.append(img, heading, provenance(asset));
      const assetPlacements = placements.filter((item) => item.asset_id === asset.id);
      if (assetPlacements.length && !String(asset.alt_text || '').trim()) {
        card.appendChild(el('p', 'gallery-alt-warning', 'Publication warning: this placed image needs alt text before it can leave through Gate. Private Gallery use is not blocked.'));
      }
      metadataEditor(asset, card);
      placementEditor(asset, card);
      const actions = el('div', 'gallery-card__actions');
      const download = el('a', 'btn btn-secondary', 'Download');
      download.href = `${API_BASE_URL}/stories/${activeStoryId}/assets/${asset.id}/content?download=1`;
      const remove = el('button', 'btn btn-danger', 'Delete image');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        const yes = await dialogs.confirmDestructive({
          title: `Delete “${asset.title || 'this image'}”?`,
          body: `The normalized image and ${assetPlacements.length} placement${assetPlacements.length === 1 ? '' : 's'} will be permanently removed. Manuscript prose, page numbering, prepared work, and canon stay unchanged.`,
          confirmLabel: 'Delete image',
        });
        if (!yes) return;
        selectedReferences.delete(asset.id);
        await mutate(() => apiCall(`/stories/${activeStoryId}/assets/${asset.id}`, 'DELETE'), 'Image and its placements deleted.');
      });
      actions.append(download, remove);
      card.appendChild(actions);
      grid.appendChild(card);
    }
    if (!assets.length) grid.appendChild(el('p', 'gallery-empty', 'No art yet. Upload any supported image locally, or paint from a committed page.'));
    setStatus(`${assets.length} image${assets.length === 1 ? '' : 's'} · ${placements.length} manuscript placement${placements.length === 1 ? '' : 's'}.`);
  }

  function openUpload(file) {
    if (!file || !activeStoryId) return;
    const previewUrl = URL.createObjectURL(file);
    const body = el('div', 'gallery-upload');
    const preview = document.createElement('img');
    preview.src = previewUrl;
    preview.alt = 'Local preview of the selected file';
    const nameLabel = el('label', '', 'Title');
    const title = document.createElement('input');
    title.type = 'text';
    title.maxLength = 500;
    title.value = file.name.replace(/\.[^.]+$/, '').slice(0, 500);
    nameLabel.appendChild(title);
    const altLabel = el('label', '', 'Alt text (recommended for publication-selected art)');
    const alt = document.createElement('textarea');
    alt.rows = 3;
    alt.maxLength = 2000;
    altLabel.appendChild(alt);
    const placementLabel = el('label', '', 'Initial placement');
    const placement = anchorSelect({ value: '__gallery__', allowGallery: true, label: 'Initial placement' });
    placementLabel.appendChild(placement);
    const permission = el('label', 'gallery-check');
    const permissionBox = document.createElement('input');
    permissionBox.type = 'checkbox';
    permission.append(permissionBox, el('span', '', 'Permit use as a provider reference (does not select or send it)'));
    body.append(
      preview,
      el('p', 'gallery-upload__notice', 'The server validates encoding, size, dimensions, container integrity, and damage; it does not classify or judge image subject matter. Device and location metadata are stripped from the retained WebP derivative.'),
      nameLabel, altLabel, placementLabel, permission,
    );
    const cleanup = () => {
      URL.revokeObjectURL(previewUrl);
      const input = document.getElementById('galleryUploadInput');
      if (input) input.value = '';
    };
    dialogs.openDialog({
      title: 'Upload an image to Gallery',
      body,
      onFreeClose: cleanup,
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => { cleanup(); close(true); } },
        {
          label: 'Upload image', className: 'btn-primary', onClick: async (close) => {
            const form = new FormData();
            form.append('image', file, file.name || 'upload');
            form.append('title', title.value.trim());
            form.append('alt_text', alt.value.trim());
            form.append('provider_reference_allowed', String(permissionBox.checked));
            if (placement.value !== '__gallery__') form.append('after_page_id', placement.value);
            close(true);
            cleanup();
            setStatus('Validating and normalizing the local image…');
            try {
              const response = await apiFetch(`/api/stories/${activeStoryId}/assets/upload`, { method: 'POST', body: form });
              let result = null;
              try { result = await response.json(); } catch { /* safe fallback below */ }
              if (!response.ok) throw new Error(result?.error || `Upload failed (${response.status})`);
              await load(activeStoryId);
              await features.write.refreshStoryAssets(activeStoryId);
              shell.checkDiskSpace();
              showSuccess(placement.value === '__gallery__'
                ? 'Image normalized and saved Gallery-only. No provider was contacted.'
                : 'Image normalized and placed without changing manuscript pages or canon. No provider was contacted.');
            } catch (error) {
              showError(error.message);
              setStatus('Upload failed technical validation; no Gallery asset was kept.');
            }
          },
        },
      ],
    });
  }

  function openPaint() {
    if (!anchors.length) {
      showError('Write or import at least one committed page before painting with AI. Upload remains available without a page.');
      return;
    }
    const body = el('div', 'gallery-paint');
    const label = el('label', '', 'Committed page to illustrate');
    const select = document.createElement('select');
    for (const anchor of anchors) {
      const option = document.createElement('option');
      option.value = String(anchor.page_number);
      option.textContent = `Page ${anchor.page_number}`;
      select.appendChild(option);
    }
    select.value = String(anchors.at(-1).page_number);
    label.appendChild(select);
    body.append(label, el('p', 'setting-hint', 'First, the writing model drafts a visible prompt from this page. You may edit it before a separately reviewed painting request. Grok refusals show their reason and editable replacement, then wait.'));
    dialogs.openDialog({
      title: 'Paint with AI',
      body,
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        {
          label: 'Draft visible prompt', className: 'btn-primary', onClick: (close) => {
            const pageNumber = Number.parseInt(select.value, 10);
            close(true);
            features.imagery.resetForContextChange(activeStoryId);
            features.imagery.setAssetReferences([...selectedReferences]);
            features.imagery.generateImagePrompt(pageNumber);
          },
        },
      ],
    });
  }

  async function load(storyId) {
    const token = ++loadToken;
    setStatus('Opening normalized images and stable placement anchors…');
    try {
      const [listing, anchorResult] = await Promise.all([
        apiCall(`/stories/${storyId}/assets`),
        apiCall(`/stories/${storyId}/assets/anchors`),
      ]);
      if (token !== loadToken || activeStoryId !== storyId) return;
      assets = listing.assets || [];
      placements = listing.placements || [];
      anchors = anchorResult.anchors || [];
      render();
    } catch (error) {
      if (token !== loadToken) return;
      assets = [];
      placements = [];
      anchors = [];
      render();
      setStatus(`Gallery could not load: ${error.message}`);
      showError(error.message);
    }
  }

  async function enter(params = {}) {
    if (!params.storyId) return;
    const story = await chooseWorkspaceStory({ storyId: params.storyId, state, features });
    if (!story) {
      showError('That manuscript could not be found - it may have been deleted from another window.');
      routeController.navigate('library-stories');
      return;
    }
    activeStoryId = story.id;
    selectedReferences.clear();
    await load(story.id);
  }

  function init() {
    document.getElementById('galleryPaintBtn')?.addEventListener('click', openPaint);
    const input = document.getElementById('galleryUploadInput');
    document.getElementById('galleryUploadBtn')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) openUpload(file);
    });
  }

  function reset() {
    loadToken++;
    activeStoryId = null;
    assets = [];
    placements = [];
    anchors = [];
    selectedReferences.clear();
    features.imagery.setAssetReferences([]);
    const grid = document.getElementById('galleryGrid');
    if (grid) grid.textContent = '';
    setStatus('Choose a manuscript to inspect its art.');
  }

  return { init, enter, load, render, reset, openUpload, openPaint, setRouter(value) { routeController = value; } };
}

