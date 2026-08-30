// Shared catalog card anatomy: the entity reference-image display (painted
// image, pending/failed placeholders, or the missing-file degradation).
// Actions (Edit / More menu) live on the card itself, never hidden behind
// hover; the image block is presentation-only.

export const IMAGE_COST_ESTIMATE = { world: 0.04, character: 0.06 };

export function entityImageBlock(kind, row, altText) {
  const wrap = document.createElement('div');
  wrap.className = 'card-image-wrap';
  if (row.image_status === 'ready') {
    const img = document.createElement('img');
    img.className = 'card-image';
    img.src = `/api/${kind === 'world' ? 'worlds' : 'characters'}/${row.id}/image`;
    img.alt = altText;
    // A "ready" image whose file has gone missing (legacy copies) degrades
    // to the failed placeholder instead of a broken image.
    img.addEventListener('error', () => {
      const missing = document.createElement('div');
      missing.className = 'card-image card-image--failed';
      missing.textContent = 'The painting is missing.';
      if (img.parentNode) img.parentNode.replaceChild(missing, img);
    });
    wrap.appendChild(img);
  } else if (row.image_status === 'pending') {
    const pending = document.createElement('div');
    pending.className = 'card-image card-image--pending';
    pending.textContent = kind === 'world' ? 'The scene is being painted…' : 'The portrait is being painted…';
    wrap.appendChild(pending);
  } else if (row.image_status === 'failed') {
    const failed = document.createElement('div');
    failed.className = 'card-image card-image--failed';
    failed.textContent = 'The painting failed.';
    wrap.appendChild(failed);
  }
  return wrap;
}

// The card action row: one visible primary Edit plus a More menu holding
// regenerate-image (with its approximate cost) and delete. Native <details>
// keeps it keyboard-operable without a custom menu system.
export function cardActions({ name, kind, onEdit, onRegenerate, onDelete }) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn btn-secondary card-edit';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${name}`);
  edit.addEventListener('click', onEdit);
  actions.appendChild(edit);

  const more = document.createElement('details');
  more.className = 'card-more';
  const summary = document.createElement('summary');
  summary.textContent = 'More';
  summary.setAttribute('aria-label', `More actions for ${name}`);
  more.appendChild(summary);

  const menu = document.createElement('div');
  menu.className = 'card-more__menu';

  const regen = document.createElement('button');
  regen.type = 'button';
  regen.className = 'card-more__item';
  const estimate = IMAGE_COST_ESTIMATE[kind];
  regen.textContent = estimate
    ? `Regenerate image (≈$${estimate.toFixed(2)})`
    : 'Regenerate image';
  regen.addEventListener('click', () => {
    more.removeAttribute('open');
    onRegenerate();
  });
  menu.appendChild(regen);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'card-more__item card-more__item--danger';
  del.textContent = 'Delete';
  del.setAttribute('aria-label', `Delete ${name}`);
  del.addEventListener('click', () => {
    more.removeAttribute('open');
    onDelete();
  });
  menu.appendChild(del);

  more.appendChild(menu);
  actions.appendChild(more);
  return actions;
}

// While portraits/scenes are being painted in the background, refresh the
// lists until every pending brush has landed. One timer, shared by both
// catalogs, owned here.
export function createCatalogPoll({ state, loaders }) {
  let timer = null;

  function anyPending() {
    return [...state.data.worlds, ...state.data.characters].some((r) => r.image_status === 'pending');
  }

  function schedule() {
    if (timer || !anyPending()) return;
    // Jest drives loads directly; a live interval would leak across tests.
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) return;
    timer = setInterval(async () => {
      if (!anyPending()) {
        stop();
        return;
      }
      await Promise.all([loaders.loadWorlds(), loaders.loadCharacters()]);
    }, 4000);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { schedule, stop };
}
