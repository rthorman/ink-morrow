import { apiFetch } from '../core/api.js';
import { el, button, field, option } from './dom.js';

const labels = { world: 'Worlds', character: 'Characters', scribe: 'Scribes' };
const label = (value) => value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const kindName = { world: 'world', character: 'character', scribe: 'Scribe' };
const kindImage = { world: 'scene', character: 'portrait', scribe: 'portrait' };
const kindIntro = {
  world: 'Build the place as a system: atmosphere, setting, public promise and private truths the player can discover.',
  character: 'Build a person with a visible presence, an inner pattern, a past and a private motive—not a bundle of tropes.',
  scribe: 'Build a narrator with a personality and a practical craft signature that changes how the story feels moment to moment.',
};
const privateFields = new Set(['lore', 'motive', 'background']);
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
        const card = el('article', '', `fiction-card fiction-catalog-card fiction-catalog-card--${entry.kind}`);
        const visual = el('div', '', 'fiction-catalog-card__visual');
        if (entry.image_id) visual.append(assetImage(imageUrl(entry), entry.image_alt));
        else visual.append(el('span', entry.kind === 'world' ? '◇' : entry.kind === 'character' ? '♙' : '✦', 'fiction-catalog-card__sigil'));
        const content = el('div', '', 'fiction-catalog-card__content');
        const overline = el('p', kindName[entry.kind], 'fiction-catalog-card__kind');
        content.append(overline, el('h2', entry.name), el('p', entry.description || `No visible description yet. Develop this ${kindName[entry.kind]} into a richer reference.`, 'fiction-catalog-description'));
        const facts = [];
        if (entry.kind === 'world') facts.push(entry.data.genre, entry.data.setting);
        if (entry.kind === 'character') facts.push(entry.data.personality, entry.data.motive && 'Private motive set');
        if (entry.kind === 'scribe') facts.push(entry.data.diction && `${label(entry.data.diction)} diction`, ...(entry.data.focus_areas || []).slice(0, 2).map(label));
        const badges = el('div', '', 'fiction-catalog-card__badges');
        for (const fact of facts.filter(Boolean).slice(0, 3)) badges.append(el('span', String(fact).slice(0, 48)));
        if (badges.childElementCount) content.append(badges);
        if (entry.pending) content.append(el('p', `Painting ${kindImage[entry.kind]}… Refresh to check; no new purchase is needed.`, 'fiction-catalog-card__status'));
        const actions = el('div', '', 'fiction-catalog-card__actions');
        const editButton = button(`Open ${kindName[entry.kind]} studio`, () => edit(entry), 'btn btn-primary');
        const imageButton = button(entry.image_id ? `Repaint or upload` : `Paint or upload`, () => paint(entry));
        const deleteButton = button('Delete', () => remove(entry), 'btn btn-quiet-danger');
        for (const control of [editButton, imageButton, deleteButton]) control.disabled = entry.pending;
        actions.append(editButton, imageButton, deleteButton); content.append(actions); card.append(visual, content); root.append(card);
      }
      if (!data.entries?.length) root.append(el('p', `No ${labels[kind].toLowerCase()} yet. Create a reusable reference, then choose it when starting a story.`));
      const spend = info.spend;
      $('catalogStatus').textContent = spend ? `Catalogue AI spend: $${spend.known_usd.toFixed(4)} known${spend.unknown_attempts ? ` · ${spend.unknown_attempts} attempt(s) with unknown cost` : ''}. Includes reference development, images and deleted entries.` : '';
      $('catalogNew').disabled = false; $('catalogPrevious').hidden = offset === 0; $('catalogNext').hidden = next === null;
      $('catalogPrevious').disabled = false; $('catalogNext').disabled = false;
    } catch (error) { if (active()) { $('catalogEntries').replaceChildren(); $('catalogStatus').textContent = error.message; } }
  }
  const refresh = () => render(kind, live, offset);
  function edit(entry = null) {
    if (!metadata || !live()) return;
    const active = guard(); const editingKind = entry?.kind || kind;
    const name = field('Name', 'input', entry?.name || '', { maxLength: 200, wrapperClass: 'fiction-field--name', hint: 'Leave blank if you want the Storyteller to invent one.' });
    const description = field('What players notice first', 'textarea', entry?.description || '', { maxLength: 2000, rows: 4,
      hint: 'Reader-visible orientation. Deeper truths belong in the private fields below.' });
    const fields = new Map();
    const identity = el('section', '', 'fiction-studio-section'); identity.append(el('h3', 'Identity'), name.wrapper, description.wrapper);
    const depth = el('section', '', 'fiction-studio-section'); depth.append(el('h3', editingKind === 'world' ? 'World foundations' : editingKind === 'character' ? 'Inner life and history' : 'Identity and presence'));
    for (const [key, limit] of Object.entries(metadata.fields[editingKind])) {
      const caption = `${label(key)}${privateFields.has(key) ? ' · private' : ''}`;
      const input = field(caption, 'textarea', entry?.data[key] || '', { maxLength: limit, rows: ['lore', 'background'].includes(key) ? 5 : 3,
        hint: privateFields.has(key) ? 'Used by the Storyteller, but not exposed in the player-facing reference.' : '' });
      fields.set(key, input.control); depth.append(input.wrapper);
    }
    const focus = []; const craft = el('section', '', 'fiction-studio-section fiction-studio-section--craft');
    if (editingKind === 'scribe') {
      depth.prepend(el('p', metadata.scribe.canon.definition, 'fiction-studio-canon'));
      craft.append(el('h3', 'Narrative craft'), el('p', 'Choose a coherent voice, not the strongest value in every category.', 'fiction-muted'));
      const craftGrid = el('div', '', 'fiction-studio-grid');
      for (const [key, values] of Object.entries(metadata.scribe.enums)) {
        const input = field(label(key), 'select'); input.control.append(...values.map((value) => option(value, label(value))));
        const value = entry?.data[key] || metadata.scribe.defaults?.[key];
        if (value) input.control.value = value;
        fields.set(key, input.control); craftGrid.append(input.wrapper);
      }
      craft.append(craftGrid);
      const area = el('fieldset', '', 'fiction-studio-focus'); area.append(el('legend', 'Craft focus areas'));
      const areaGrid = el('div', '', 'fiction-studio-focus__grid');
      for (const value of metadata.scribe.focus_areas) {
        const input = field(label(value), 'input', value, { type: 'checkbox', checked: Boolean(entry?.data.focus_areas.includes(value)) });
        focus.push(input.control); areaGrid.append(input.wrapper);
      } area.append(areaGrid); craft.append(area);
    }
    const status = el('p', '', 'fiction-studio-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = el('p', '', 'fiction-studio-error'); error.setAttribute('role', 'alert');
    const length = field('Development depth', 'select');
    length.control.append(option('short', 'Sketch · concise'), option('medium', 'Developed · balanced'), option('long', 'Deep · richly detailed')); length.control.value = 'medium';
    const aiPanel = el('section', '', 'fiction-studio-ai');
    aiPanel.append(el('div', '', 'fiction-studio-ai__mark'), el('div', '', 'fiction-studio-ai__copy'));
    aiPanel.querySelector('.fiction-studio-ai__mark').textContent = '✦';
    aiPanel.querySelector('.fiction-studio-ai__copy').append(el('h3', entry ? 'Develop another take with AI' : 'Begin with a spark, then develop it'),
      el('p', 'The Storyteller expands what you have entered and invents into blanks. The result stays editable and is not saved automatically.'), length.wrapper);
    const develop = button('Develop with AI', () => developWithAi(), 'btn btn-primary'); aiPanel.querySelector('.fiction-studio-ai__copy').append(develop);
    const intro = el('div', '', 'fiction-studio-intro');
    const introCopy = el('div'); introCopy.append(el('p', `Reusable ${kindName[editingKind]} reference`, 'eyebrow'), el('p', kindIntro[editingKind]));
    intro.append(introCopy);
    if (entry?.image_id) intro.append(assetImage(imageUrl(entry), entry.image_alt, 'fiction-studio-intro__image'));
    const body = [intro, aiPanel, identity, depth, ...(editingKind === 'scribe' ? [craft] : []), status, error];
    let busy = false; let take = 1;
    const value = () => {
      const data = Object.fromEntries([...fields].map(([key, input]) => [key, input.value.trim()]));
      if (editingKind === 'scribe') { data.entity_kind = 'catgirl'; data.focus_areas = focus.filter((input) => input.checked).map((input) => input.value); }
      return { name: name.control.value.trim(), description: description.control.value.trim(), data };
    };
    const initial = JSON.stringify(value());
    const populate = (draft) => {
      name.control.value = draft.name || ''; description.control.value = draft.description || '';
      for (const [key, input] of fields) if (Object.hasOwn(draft.data || {}, key)) input.value = draft.data[key] || '';
      if (editingKind === 'scribe') for (const input of focus) input.checked = (draft.data?.focus_areas || []).includes(input.value);
    };
    const show = () => dialogs.openDialog({ title: entry ? `${entry.name} · ${kindName[editingKind]} studio` : `Create a ${kindName[editingKind]}`,
      body, variant: 'studio', dirty: () => JSON.stringify(value()) !== initial, actions: [
        { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close() },
        { label: 'Save details', className: 'btn-secondary', pendingLabel: 'Saving…', onClick: (close) => save(close, false) },
        { label: `Save & add ${kindImage[editingKind]}`, className: 'btn-primary', pendingLabel: 'Saving…', onClick: (close) => save(close, true) },
      ] });
    async function developWithAi() {
      if (busy || !active()) return;
      const selected = metadata.drafting;
      if (!selected?.provider) { error.textContent = 'Connect a Storyteller in Settings before asking AI to develop a reference. Your fields are still here.'; return; }
      const seed = value();
      const approved = await dialogs.confirmPaid({ title: `Develop this ${kindName[editingKind]}?`,
        review: { action: `Develop an editable ${kindName[editingKind]} reference from the current seed fields`, object: seed.name || `Untitled ${kindName[editingKind]}`,
          model: `${selected.provider.display_name} · ${selected.model_id}`, quantity: 'One structured draft; at most one corrective second call if the first result is invalid',
          sends: 'All currently entered reference fields, including private lore, motives and background', estimate: 0.03,
          note: 'Nothing is saved automatically. Provider calls may be charged even if the result is unusable.' }, confirmLabel: 'Develop this reference' });
      if (!approved) { show(); return; }
      busy = true; develop.disabled = true; develop.textContent = 'The Storyteller is developing…'; error.textContent = ''; status.textContent = 'Building a coherent reference from your seeds…'; show();
      try {
        const result = await api('/fiction/catalog/draft', 'POST', { kind: editingKind, idempotency_key: crypto.randomUUID(), input: { seed, length: length.control.value, variant: take,
          provider_id: selected.provider.id, model: selected.model_id } });
        if (!active()) return;
        populate(result.entry); take += 1;
        status.textContent = `AI take ready${typeof result.cost_usd === 'number' ? ` · $${result.cost_usd.toFixed(4)}` : ' · cost not reported'}. Review every field before saving.`;
      } catch (caught) {
        if (active()) error.textContent = `${caught.message}${caught.billedAttempts ? ' One or more provider calls may have been charged.' : ''} Your original fields are still here.`;
      } finally { busy = false; develop.disabled = false; develop.textContent = 'Develop another take'; if (active()) show(); }
    }
    async function save(close, addImage) {
      if (busy || !active()) return;
      if (!name.control.value.trim()) { error.textContent = 'Give this reference a name, or ask AI to invent one.'; name.control.focus(); return; }
      busy = true; error.textContent = '';
      try {
        const payload = value();
        const result = await api(entry ? `/fiction/catalog/${entry.id}` : '/fiction/catalog', entry ? 'PUT' : 'POST', entry ? { expected_revision: entry.revision, entry: payload } : { kind: editingKind, entry: payload });
        close(true); await refresh(); if (addImage && live()) paint(result.entry);
      } catch (caught) { if (active()) error.textContent = `${caught.message} Your fields are still here.`; }
      finally { busy = false; }
    }
    show();
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
    const imageIntro = el('div', '', 'fiction-image-studio__intro');
    if (entry.image_id) imageIntro.append(assetImage(imageUrl(entry), entry.image_alt, 'fiction-image-studio__preview'));
    const imageCopy = el('div'); imageCopy.append(el('p', 'Upload stays on this installation. AI painting uses visible reference fields plus your art direction; private lore and motives and uploaded image bytes are not sent.'),
      el('p', selected?.provider ? `Illustrator ready: ${selected.provider.display_name} · ${selected.model_id}` : 'AI painting needs an Illustrator in Settings. Upload remains available.', selected?.provider ? 'fiction-provider-ready' : 'fiction-provider-missing'));
    imageIntro.append(imageCopy);
    const imageFields = el('section', '', 'fiction-studio-section fiction-image-studio__fields'); imageFields.append(el('h3', `${label(kindImage[entry.kind])} direction`), alt.wrapper, direction.wrapper, shape.wrapper, file.wrapper);
    const show = () => dialogs.openDialog({ title: `${entry.name} · image studio`, body: [imageIntro, imageFields, error], variant: 'studio', actions: [
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
      { label: 'Paint with AI', className: 'btn-primary', pendingLabel: 'Painting…', onClick: async (close) => {
        if (!valid()) return;
        if (!selected?.provider) { error.textContent = 'Connect an Illustrator in Settings before painting with AI. Your image description and art direction are still here.'; return; }
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
