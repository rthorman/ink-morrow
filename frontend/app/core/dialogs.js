// The one dialog manager: open/close stack (normally one modal), focus trap
// and opener restoration, body scroll lock, Escape/backdrop policy with a
// dirty close guard, and the two shared decision builders - destructive
// confirmation and paid-action review.
//
// Legacy feature modals (entity editors, cast editor, scene viewer) keep
// their own markup and register through wireModal(); everything NEW goes
// through here so the interaction grammar stays uniform.


function createDialogManager() {
  let overlay = null; // the live dialog element
  let opener = null; // element to restore focus to
  let dirtyCheck = null; // () => boolean, "closing would discard work"
  let closing = false;
  let lastSpec = null; // the open dialog's spec, for dirty-guard recovery

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'burn-modal dialog-manager';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="burn-modal__panel dialog-manager__panel" role="dialog" aria-modal="true">
        <h2 class="dialog-manager__title" id="dialog-manager-title"></h2>
        <div class="dialog-manager__body"></div>
        <div class="dialog-manager__actions"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) requestClose();
    });
    document.addEventListener('keydown', (event) => {
      if (overlay && !overlay.hidden) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          requestClose();
        } else if (event.key === 'Tab') {
          trapFocus(event);
        }
      }
    });
    return overlay;
  }

  function focusables() {
    if (!overlay) return [];
    return [...overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && !el.closest('[hidden]'));
  }

  function trapFocus(event) {
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockScroll() {
    document.documentElement.style.overflow = '';
  }

  // Open a dialog. Options:
  //   title: string (required)
  //   body:  string | Node | Node[]  (plain copy or owned elements)
  //   actions: [{ label, className, onClick(close), autofocus, disabled }]
  //   dirty: () => boolean  (blocks casual close while true)
  //   variant: '' | 'danger' | 'cost'
  function openDialog({ title, body, actions = [], dirty = null, variant = '', labelledBy = 'dialog-manager-title' }) {
    if (overlay && !overlay.hidden) close(true); // one modal at a time
    closing = false;
    const el = ensureOverlay();
    opener = document.activeElement;
    dirtyCheck = dirty;
    lastSpec = { title, body, actions, dirty, variant, labelledBy };

    const panel = el.querySelector('.dialog-manager__panel');
    panel.setAttribute('aria-labelledby', labelledBy);
    panel.className = 'burn-modal__panel dialog-manager__panel' + (variant ? ` dialog-manager__panel--${variant}` : '');
    el.querySelector('.dialog-manager__title').textContent = title;

    const bodyEl = el.querySelector('.dialog-manager__body');
    bodyEl.textContent = '';
    if (typeof body === 'string') {
      const p = document.createElement('p');
      p.textContent = body;
      bodyEl.appendChild(p);
    } else if (body) {
      for (const node of Array.isArray(body) ? body : [body]) bodyEl.appendChild(node);
    }

    const actionsEl = el.querySelector('.dialog-manager__actions');
    actionsEl.textContent = '';
    let autofocusEl = null;
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (action.className || 'btn-secondary');
      btn.textContent = action.label;
      if (action.disabled) btn.disabled = true;
      btn.addEventListener('click', () => {
        if (action.onClick) action.onClick(close);
        else close();
      });
      if (action.autofocus) autofocusEl = btn;
      actionsEl.appendChild(btn);
    }

    el.hidden = false;
    lockScroll();
    // Focus enters at the title (non-destructive default) unless an action
    // explicitly asks; the first field gets it when a form lands in body.
    (autofocusEl || bodyEl.querySelector('input, textarea, select') || panel).focus?.();
    if (!autofocusEl && !bodyEl.querySelector('input, textarea, select')) {
      panel.setAttribute('tabindex', '-1');
      panel.focus();
    }
    return close;
  }

  function requestClose() {
    if (dirtyCheck && dirtyCheck()) {
      // Dirty drafts ask before going anywhere - backdrop and Escape follow
      // the same rule as the cancel button. Declining re-opens the draft
      // dialog (its DOM nodes keep their values).
      const spec = lastSpec;
      confirmDestructive({
        title: 'Discard changes?',
        body: 'Your edits in this dialog have not been saved.',
        confirmLabel: 'Discard changes',
      }).then((yes) => {
        if (yes) close(true);
        else openDialog(spec);
      });
      return;
    }
    close();
  }

  function close(force = false) {
    if (!overlay || overlay.hidden || closing) return;
    if (!force && dirtyCheck && dirtyCheck()) {
      requestClose();
      return;
    }
    closing = true;
    overlay.hidden = true;
    dirtyCheck = null;
    unlockScroll();
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
    closing = false;
  }

  // One shared destructive confirmation. The confirm button names the exact
  // object and quantity; the danger token and burn motif stay support.
  function confirmDestructive({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      openDialog({
        title,
        body,
        variant: 'danger',
        actions: [
          { label: cancelLabel, className: 'btn-secondary', autofocus: true, onClick: () => { close(true); resolve(false); } },
          { label: confirmLabel, className: 'btn-danger', onClick: () => { close(true); resolve(true); } },
        ],
      });
    });
  }

  // One shared paid-action review: what will be spent, on what, and an
  // explicit button carrying the price. Faster and more accessible than a
  // slider; the confirmation is informed intent, not security theater.
  function confirmPaid({ title, body, confirmLabel, cancelLabel = 'Cancel', disabled = false }) {
    return new Promise((resolve) => {
      openDialog({
        title,
        body,
        variant: 'cost',
        actions: [
          { label: cancelLabel, className: 'btn-secondary', autofocus: true, onClick: () => { close(true); resolve(false); } },
          { label: confirmLabel, className: 'btn-primary', disabled, onClick: () => { close(true); resolve(true); } },
        ],
      });
    });
  }

  function isOpen() {
    return Boolean(overlay && !overlay.hidden);
  }

  return { openDialog, close, requestClose, confirmDestructive, confirmPaid, isOpen };
}

// Modal wiring for legacy feature modals: Escape requests close, backdrop
// requests close. onEscape is optional dirty-aware close handling.
export function wireModal(modalId, { onEscape } = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) return null;
  const closeFromEvent = (event) => {
    if (event.target === modal) {
      if (onEscape) onEscape();
      else modal.hidden = true;
    }
  };
  modal.addEventListener('click', closeFromEvent);
  if (onEscape) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) onEscape();
    });
  }
  return modal;
}

// Slider fill helper (burn/audiobook slide-to-confirm remnants; both are
// replaced by shared dialogs, kept only until the last slider is gone).
export function updateSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--burn-fill', pct + '%');
}

export { createDialogManager };
