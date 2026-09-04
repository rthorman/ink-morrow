import { apiFetch } from '../core/api.js';
import { el, button, field, option } from './dom.js';

const labels = { world: 'Worlds', character: 'Characters', scribe: 'Scribes' };
const label = (value) => value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
export function assetImage(url, alt, className = 'fiction-reference-image') {
  const image = el('img', '', className); image.src = url; image.alt = alt; image.loading = 'lazy';
  image.width = 640; image.height = 480;
  image.addEventListener('error', () => { image.replaceWith(el('p', `Image unavailable: ${alt}`, 'fiction-muted')); }, { once: true });
  return image;
}
export function storyImage(id, visual, className) {
  return assetImage(`/api/fiction/${encodeURIComponent(id)}/images/${encodeURIComponent(visual.asset_id)}`, visual.alt_text, className);
}

export function createVisualLibrary({ api, dialogs }) {
  const $ = (id) => document.getElementById(id);
  let metadata = null; let kind = 'world'; let offset = 0; let next = null; let live = () => false; let serial = 0; let deleting = false;
  const setup = new Map();
  const imageUrl = (entry) => `/api/fiction/catalog/${encodeURIComponent(entry.id)}/images/${encodeURIComponent(entry.image_id)}`;
  const guard = () => { const token = serial; const currentLive = live; return () => token === serial && currentLive(); };
  async function render(nextKind, isLive, nextOffset = 0) {
    serial++; kind = nextKind; offset = nextOffset; live = isLive; const active = guard();
    $('catalogTitle').textContent = labels[kind]; $('catalogEntries').textContent = 'Opening the visual catalogue…'; $('catalogStatus').textContent = '';
    $('catalogNew').disabled = true; $('catalogPrevious').disabled = true; $('catalogNext').disabled = true;
    for (const link of $('catalogTabs').querySelectorAll('a')) {
      if (link.hash === `#/catalog/${kind}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    try {
      const [info, data] = await Promise.all([api('/fiction/catalog/metadata'), api(`/fiction/catalog?kind=${kind}&offset=${offset}`)]);
      if (!active()) return;
      metadata = info; next = data.next_offset ?? null;
      const root = $('catalogEntries'); root.replaceChildren();
      for (const entry of data.entries || []) {
        const card = el('article', '', 'fiction-card');
        if (entry.image_id) card.append(assetImage(imageUrl(entry), entry.image_alt));
        card.append(el('h2', entry.name), el('p', entry.description, 'fiction-catalog-description'));
        if (entry.pending) card.append(el('p', 'Painting in progress. Refresh to check; no new purchase is needed.', 'fiction-muted'));
        for (const [name, action] of [['Edit details', () => edit(entry)], ['Image: upload or paint', () => paint(entry)], ['Delete entry', () => remove(entry)]]) {
          const control = button(name, action); control.disabled = entry.pending; card.append(control);
        }
        root.append(card);
      }
      if (!data.entries?.length) root.append(el('p', `No ${labels[kind].toLowerCase()} yet. Create a reusable reference, then choose it when starting a story.`));
      const spend = info.spend;
      $('catalogStatus').textContent = spend ? `Catalogue image spend: $${spend.known_usd.toFixed(4)} known${spend.unknown_attempts ? ` · ${spend.unknown_attempts} attempt(s) with unknown cost` : ''}. Includes deleted entries.` : '';
      $('catalogNew').disabled = false; $('catalogPrevious').hidden = offset === 0; $('catalogNext').hidden = next === null;
      $('catalogPrevious').disabled = false; $('catalogNext').disabled = false;
    } catch (error) { if (active()) { $('catalogEntries').replaceChildren(); $('catalogStatus').textContent = error.message; } }
  }
  const refresh = () => render(kind, live, offset);
  function edit(entry = null) {
    if (!metadata || !live()) return;
    const active = guard(); const editingKind = entry?.kind || kind;
    const name = field('Name', 'input', entry?.name || '', { maxLength: 200 });
    const description = field('Visible description', 'textarea', entry?.description || '', { maxLength: 2000, rows: 3 });
    const fields = new Map(); const body = [el('p', 'Reusable setup, not manuscript prose. Saving makes no AI request and never changes an existing story.'), name.wrapper, description.wrapper];
    for (const [key, limit] of Object.entries(metadata.fields[editingKind])) {
      const caption = `${label(key)}${['lore', 'motive', 'background'].includes(key) ? ' (may contain private setup notes)' : ''}`;
      const input = field(caption, 'textarea', entry?.data[key] || '', { maxLength: limit, rows: key === 'lore' ? 4 : 2 });
      fields.set(key, input.control); body.push(input.wrapper);
    }
    const focus = [];
    if (editingKind === 'scribe') {
      body.push(el('p', metadata.scribe.canon.definition));
      for (const [key, values] of Object.entries(metadata.scribe.enums)) {
        const input = field(label(key), 'select'); input.control.append(...values.map((value) => option(value, label(value))));
        const value = entry?.data[key] || metadata.scribe.defaults?.[key];
        if (value) input.control.value = value;
        fields.set(key, input.control); body.push(input.wrapper);
      }
      const area = el('fieldset'); area.append(el('legend', 'Craft focus areas'));
      for (const value of metadata.scribe.focus_areas) {
        const input = field(label(value), 'input', value, { type: 'checkbox', checked: Boolean(entry?.data.focus_areas.includes(value)) });
        focus.push(input.control); area.append(input.wrapper);
      } body.push(area);
    }
    const error = el('p'); error.setAttribute('role', 'alert'); body.push(error); let busy = false;
    dialogs.openDialog({ title: entry ? `Edit ${entry.name}` : `New ${editingKind === 'scribe' ? 'Scribe' : editingKind}`, body, actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Save details', className: 'btn-primary', pendingLabel: 'Saving…', onClick: async (close) => {
        if (busy || !active()) return;
        if (!name.control.value.trim()) { error.textContent = 'Give this entry a name.'; name.control.focus(); return; }
        busy = true;
        try {
          const data = Object.fromEntries([...fields].map(([key, input]) => [key, input.value.trim()]));
          if (editingKind === 'scribe') { data.entity_kind = 'catgirl'; data.focus_areas = focus.filter((input) => input.checked).map((input) => input.value); }
          const value = { name: name.control.value.trim(), description: description.control.value.trim(), data };
          await api(entry ? `/fiction/catalog/${entry.id}` : '/fiction/catalog', entry ? 'PUT' : 'POST', entry ? { expected_revision: entry.revision, entry: value } : { kind: editingKind, entry: value });
          if (active()) { close(true); await refresh(); }
        } catch (caught) { if (active()) error.textContent = `${caught.message} Your fields are still here.`; }
        finally { busy = false; }
      } },
    ] });
  }
  async function remove(entry) {
    if (deleting || !live()) return;
    const active = guard(); deleting = true;
    try {
      const approved = await dialogs.confirmDestructive({ title: `Delete ${entry.name}?`, body: 'This deletes one reusable entry and its catalogue image. Existing stories keep their frozen copies. The image-spend record is retained. This catalogue deletion cannot be undone.', confirmLabel: 'Delete this entry', cancelLabel: 'Keep entry' });
      if (!approved || !active()) return;
      $('catalogStatus').textContent = 'Deleting this catalogue entry…';
      $('catalogScreen').querySelectorAll('button').forEach((node) => { node.disabled = true; });
      try { await api(`/fiction/catalog/${entry.id}`, 'DELETE', { expected_revision: entry.revision }); }
      catch (caught) { if (active()) { await refresh(); $('catalogStatus').textContent = caught.message; } return; }
      if (active()) await refresh();
    } finally { deleting = false; if (live()) $('catalogRefresh').disabled = false; }
  }
  function paint(entry) {
    const active = guard(); const selected = metadata.generation;
    const alt = field('Image description', 'textarea', entry.image_alt || '', { maxLength: 1000, rows: 2 });
    const direction = field('Art direction (AI only)', 'textarea', '', { maxLength: 2000, rows: 3 });
    const shape = field('Image shape (AI only)', 'select'); shape.control.append(option('1:1', 'Square'), option('3:4', 'Portrait'), option('4:3', 'Landscape'), option('16:9', 'Wide'));
    const file = field('Upload an image instead (up to 20 MB)', 'input', '', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' });
    const error = el('p'); error.setAttribute('role', 'alert'); let busy = false;
    const valid = () => { if (!alt.control.value.trim()) { error.textContent = 'Describe the image first.'; alt.control.focus(); return false; } return active(); };
    const run = async (work, close) => {
      if (busy || !active()) return; busy = true; error.textContent = '';
      try { const data = await work(); if (data && active()) { close(true); await refresh(); } }
      catch (caught) { if (active()) { error.textContent = `${caught.message}${caught.billedAttempts ? ' This attempt may have been charged.' : ''} Refresh the catalogue before retrying; no automatic retry is made.`; show(); } }
      finally { busy = false; }
    };
    const show = () => dialogs.openDialog({ title: `Image for ${entry.name}`, body: [el('p', 'Upload is local. AI painting sends this entry’s visible description and appearance or setting, plus your art direction. Private lore and motives, and uploaded image bytes, are not sent. Existing story copies never change.'), alt.wrapper, direction.wrapper, shape.wrapper, file.wrapper,
      el('p', selected?.provider ? `Illustrator: ${selected.provider.display_name} · ${selected.model_id}` : 'Choose an illustrator in Settings to paint. Upload remains available.'), error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Save description only', className: 'btn-secondary', pendingLabel: 'Saving…', disabled: !entry.image_id, onClick: async (close) => {
        if (valid()) await run(() => api(`/fiction/catalog/${entry.id}/images/describe`, 'POST', { expected_revision: entry.revision, alt_text: alt.control.value.trim() }), close);
      } },
      { label: 'Remove image', className: 'btn-secondary', pendingLabel: 'Removing…', disabled: !entry.image_id, onClick: async (close) => {
        await run(() => api(`/fiction/catalog/${entry.id}/images/remove`, 'POST', { expected_revision: entry.revision }), close);
      } },
      { label: 'Upload image', className: 'btn-secondary', pendingLabel: 'Uploading…', onClick: async (close) => {
        if (!valid()) return;
        const image = file.control.files?.[0];
        if (!image || image.size > 20 * 1024 * 1024) { error.textContent = 'Choose an image no larger than 20 MB.'; return; }
        await run(async () => {
          const form = new FormData(); form.append('image', image); form.append('expected_revision', entry.revision); form.append('alt_text', alt.control.value.trim());
          const response = await apiFetch(`/api/fiction/catalog/${entry.id}/images/upload`, { method: 'POST', body: form });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload failed.'); return data;
        }, close);
      } },
      { label: 'Paint with AI', className: 'btn-primary', pendingLabel: 'Painting…', disabled: !selected?.provider, onClick: async (close) => {
        if (!valid()) return;
        const input = { alt_text: alt.control.value.trim(), direction: direction.control.value.trim(), aspect_ratio: shape.control.value, provider_id: selected.provider.id, model: selected.model_id };
        await run(async () => {
          const approved = await dialogs.confirmPaid({ title: `Paint ${entry.name}?`, body: 'One image request, no automatic retry. Name, visible description, appearance/setting and art direction go to the selected Illustrator. No private lore, motives or uploaded image references.',
            review: { action: `Paint a ${entry.kind} image`, object: entry.name, model: `${selected.provider.display_name} · ${selected.model_id}`, quantity: 'One image', sends: 'Visible reference fields and art direction', estimate: 0.05, note: 'Rough estimate, not a spending cap; failed requests may be charged.' }, confirmLabel: 'Paint this image' });
          if (!active()) return null;
          if (!approved) { show(); return null; }
          return api(`/fiction/catalog/${entry.id}/images/generate`, 'POST', { expected_revision: entry.revision, idempotency_key: crypto.randomUUID(), input });
        }, close);
      } },
    ] });
    show();
  }
  async function loadSetup(isLive) {
    const prior = selection();
    const retained = new Map([...setup].map(([key, data]) => [key, data.entries.filter((entry) => key === 'character' ? prior?.character_ids.includes(entry.id) : prior?.[`${key}_id`] === entry.id)]));
    setup.clear();
    const root = $('fictionCatalogueSetup'); root.replaceChildren();
    for (const entryKind of Object.keys(labels)) {
      const group = el('fieldset'); group.append(el('legend', labels[entryKind]));
      const control = entryKind === 'character' ? el('div', '', 'fiction-catalogue-choices') : el('select');
      if (entryKind !== 'character') { control.setAttribute('aria-label', `Selected ${entryKind}`); control.append(option('', `No catalogue ${entryKind}`)); }
      const message = el('p'); message.setAttribute('role', 'status');
      const preview = el('div');
      const data = { kind: entryKind, control, entries: [], next: 0, loading: false };
      const previewSelection = () => {
        preview.replaceChildren(); if (entryKind === 'character') return;
        const entry = data.entries.find((item) => item.id === control.value);
        if (entry?.image_id) preview.append(assetImage(imageUrl(entry), entry.image_alt));
        if (entry?.description) preview.append(el('p', entry.description.slice(0, 300), 'fiction-muted'));
      };
      control.addEventListener('change', previewSelection);
      const addEntry = (entry, checked = false) => {
        if (data.entries.some((item) => item.id === entry.id)) return;
        data.entries.push(entry);
        if (entryKind === 'character') {
          const item = field(entry.name, 'input', entry.id, { type: 'checkbox', checked });
          if (entry.image_id) item.wrapper.append(assetImage(imageUrl(entry), entry.image_alt, 'fiction-choice-image'));
          control.append(item.wrapper);
        } else control.append(option(entry.id, entry.name));
      };
      for (const entry of retained.get(entryKind) || []) addEntry(entry, true);
      if (entryKind !== 'character' && prior?.[`${entryKind}_id`]) control.value = prior[`${entryKind}_id`];
      const more = button(`Load ${labels[entryKind].toLowerCase()}`, async () => {
        if (data.loading || data.next === null || !isLive()) return;
        data.loading = true; more.disabled = true; message.textContent = 'Loading references…';
        try {
          const response = await api(`/fiction/catalog?kind=${entryKind}&offset=${data.next}`);
          if (!isLive()) return;
          for (const entry of response.entries || []) {
            addEntry(entry);
          }
          data.next = response.next_offset ?? null; more.hidden = data.next === null; more.textContent = `More ${labels[entryKind].toLowerCase()}`;
          previewSelection();
          message.textContent = data.entries.length ? '' : 'None yet. Create references in the Visual Library.';
        } catch (error) { if (isLive()) message.textContent = error.message; }
        finally { data.loading = false; if (isLive()) more.disabled = false; }
      });
      group.append(control, preview, message, more); root.append(group); setup.set(entryKind, data); more.click();
    }
  }
  function selection() {
    const world = setup.get('world')?.control.value || null; const scribe = setup.get('scribe')?.control.value || null;
    const characters = [...(setup.get('character')?.control.querySelectorAll('input:checked') || [])].map((input) => input.value);
    return world || scribe || characters.length ? { world_id: world, scribe_id: scribe, character_ids: characters } : null;
  }
  function resetSetup() {
    for (const data of setup.values()) {
      if (data.kind === 'character') data.control.querySelectorAll('input').forEach((input) => { input.checked = false; }); else data.control.value = '';
    }
  }
  function clear() { serial++; metadata = null; deleting = false; setup.clear(); live = () => false; $('catalogEntries').replaceChildren(); $('catalogStatus').textContent = ''; $('fictionCatalogueSetup').replaceChildren(); }
  $('catalogNew').addEventListener('click', () => edit());
  $('catalogRefresh').addEventListener('click', refresh);
  $('catalogPrevious').addEventListener('click', () => render(kind, live, Math.max(0, offset - 80)));
  $('catalogNext').addEventListener('click', () => { if (next !== null) render(kind, live, next); });
  return { render, loadSetup, selection, resetSetup, clear };
}
