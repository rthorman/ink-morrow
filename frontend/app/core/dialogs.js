// The one dialog manager: open/close stack (normally one modal), focus trap
// and opener restoration, body scroll lock, Escape/backdrop policy with a
// dirty close guard, and the two shared decision builders - destructive
// confirmation and paid-action review.
//
// Legacy feature modals (entity editors, cast editor, scene viewer) keep
// their own markup and register through wireModal(); everything NEW goes
// through here so the interaction grammar stays uniform.

import { reviewBody } from './cost.js';

export const PAID_CONSENT_KEY = 'st-paid-consent-v1';

function createDialogManager() {
  let overlay = null; // the live dialog element
  let opener = null; // element to restore focus to
  let dirtyCheck = null; // () => boolean, "closing would discard work"
  let closing = false;
  let lastSpec = null; // the open dialog's spec, for dirty-guard recovery
  let paidConsentForSession = false; // private-mode fallback if storage rejects writes

  function hasPaidConsent() {
    if (paidConsentForSession) return true;
    try {
      return localStorage.getItem(PAID_CONSENT_KEY) === '1';
    } catch {
      return false;
    }
  }

  function rememberPaidConsent() {
    paidConsentForSession = true;
    try {
      localStorage.setItem(PAID_CONSENT_KEY, '1');
    } catch {
      // Private/restricted storage: remember it for this running session.
    }
  }

  function paidReviewContent(body, review) {
    let nodes;
    if (review) {
      nodes = reviewBody(review);
    } else if (typeof body === 'string') {
      const p = document.createElement('p');
      p.textContent = body;
      nodes = [p];
    } else {
      nodes = Array.isArray(body) ? [...body] : body ? [body] : [];
    }
    const consent = document.createElement('p');
    consent.className = 'review-consent';
    consent.textContent = 'Approve once: this device remembers your consent until its site data is cleared. Future paid actions run without another approval.';
    nodes.push(consent);
    return nodes;
  }

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
    // The shared overlay joins the ONE modal stack: Escape and Tab act on
    // the topmost dialog only, whether it is shared or a wired feature modal.
    overlay.__stEl = overlay;
    overlay.__stRequestClose = () => requestClose();
    overlay.__stWired = { focusId: null };
    return overlay;
  }

  // Scroll locks are COUNTED across shared and wired modals alike: the
  // document unlocks exactly once, when the last modal of any kind closes.
  function lockScroll() {
    scrollLockCount++;
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockScroll() {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) document.documentElement.style.overflow = '';
  }

  // Open a dialog. Options:
  //   title: string (required)
  //   body:  string | Node | Node[]  (plain copy or owned elements)
  //   actions: [{ label, className, onClick(close), autofocus, disabled }]
  //   dirty: () => boolean  (blocks casual close while true)
  //   variant: '' | 'danger' | 'cost'
  //   onFreeClose: () => void  (fired when Escape/backdrop closes the dialog
  //              without a button - promise-based builders resolve "no")
  function openDialog({ title, body, actions = [], dirty = null, variant = '', labelledBy = 'dialog-manager-title', onFreeClose = null }) {
    if (overlay && !overlay.hidden) close(true); // one modal at a time
    closing = false;
    const el = ensureOverlay();
    opener = document.activeElement;
    dirtyCheck = dirty;
    lastSpec = { title, body, actions, dirty, variant, labelledBy, onFreeClose };

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
    wiredModals.push(el);
    // Focus enters at the title (non-destructive default) unless an action
    // explicitly asks; the first field gets it when a form lands in body.
    (autofocusEl || bodyEl.querySelector('input, textarea, select') || panel).focus?.();
    if (!autofocusEl && !bodyEl.querySelector('input, textarea, select')) {
      panel.setAttribute('tabindex', '-1');
      panel.focus();
    }
    installWiredListener();
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
    // Escape/backdrop (not a button) closes a promise-based dialog: its
    // caller treats that as a deliberate "no", never a hung promise.
    const onFreeClose = !force ? lastSpec?.onFreeClose : null;
    lastSpec = null;
    unlockScroll();
    const index = wiredModals.indexOf(overlay);
    if (index >= 0) wiredModals.splice(index, 1);
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
    closing = false;
    if (onFreeClose) onFreeClose();
  }

  // One shared destructive confirmation. The confirm button names the exact
  // object and quantity; the danger token and burn motif stay support.
  function confirmDestructive({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      openDialog({
        title,
        body,
        variant: 'danger',
        onFreeClose: () => resolve(false), // Escape/backdrop = a deliberate no
        actions: [
          { label: cancelLabel, className: 'btn-secondary', autofocus: true, onClick: () => { close(true); resolve(false); } },
          { label: confirmLabel, className: 'btn-danger', onClick: () => { close(true); resolve(true); } },
        ],
      });
    });
  }

  // One shared paid-action consent gate. Its first accepted review explains
  // what will be spent and sent; later actions bypass the modal on this device.
  // `body` is plain copy; `review` is the structured shared grammar (see
  // core/cost.js reviewBody) rendered as uniform rows.
  function confirmPaid({ title, body, review, confirmLabel, cancelLabel = 'Cancel', disabled = false }) {
    if (!disabled && hasPaidConsent()) return Promise.resolve(true);
    return new Promise((resolve) => {
      openDialog({
        title,
        body: paidReviewContent(body, review),
        variant: 'cost',
        onFreeClose: () => resolve(false), // Escape/backdrop = a deliberate no
        actions: [
          { label: cancelLabel, className: 'btn-secondary', autofocus: true, onClick: () => { close(true); resolve(false); } },
          { label: confirmLabel, className: 'btn-primary', disabled, onClick: () => { rememberPaidConsent(); close(true); resolve(true); } },
        ],
      });
    });
  }

  function isOpen() {
    return Boolean(overlay && !overlay.hidden);
  }

  return { openDialog, close, requestClose, confirmDestructive, confirmPaid, hasPaidConsent, isOpen };
}

// The complete lifecycle controller for existing feature modals (entity
// editors, cast editor, AI draft, scene prompt/viewer, audiobook): opener
// recording, initial focus, one focus trap, one Escape/backdrop policy
// through requestClose, one counted document scroll lock, and opener
// restoration (falling back to the modal underneath when stacked). Every
// wired modal shares ONE document-level listener set.
const wiredModals = [];
let wiredListenerInstalled = false;
let scrollLockCount = 0;

function topWiredModal() {
  return wiredModals.length > 0 ? wiredModals[wiredModals.length - 1] : null;
}

function focusTargetOf(modal, focusId) {
  return (
    (focusId && document.getElementById(focusId)) ||
    modal.querySelector('input:not([type="hidden"]), textarea, select, [role="dialog"] button:not([hidden])') ||
    modal.querySelector('[role="dialog"]') ||
    modal
  );
}

function trapWithin(modal, event) {
  const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && !el.closest('[hidden]'));
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function installWiredListener() {
  if (wiredListenerInstalled) return;
  wiredListenerInstalled = true;
  document.addEventListener('keydown', (event) => {
    const top = topWiredModal();
    if (!top) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      top.__stRequestClose();
    } else if (event.key === 'Tab') {
      trapWithin(top.__stEl, event);
    }
  });
}

// wireModal('modalId', { beforeClose, focusId }) → controller { el, open,
// close, requestClose, isOpen }. `beforeClose` owns the close POLICY
// (dirty guards run their confirm and close() on discard); the modal closes
// itself when it is absent.
export function wireModal(modalId, { beforeClose = null, focusId = null } = {}) {
  const modal = document.getElementById(modalId);
  if (!modal) return null;
  if (modal.__stWired) return modal.__stWired;

  const ctrl = { el: modal, opener: null, beforeClose, focusId };
  modal.__stEl = modal;
  modal.__stWired = ctrl;
  modal.__stRequestClose = () => {
    if (modal.hidden) return;
    if (ctrl.beforeClose) {
      ctrl.beforeClose(); // the feature owns the policy (dirty guards, confirms)
      return;
    }
    api.close();
  };

  const api = {
    el: modal,
    get isOpen() { return !modal.hidden; },
    open() {
      if (!modal.hidden) return;
      ctrl.opener = document.activeElement;
      modal.hidden = false;
      wiredModals.push(modal);
      scrollLockCount++;
      document.documentElement.style.overflow = 'hidden';
      const target = focusTargetOf(modal, ctrl.focusId);
      if (typeof target.focus === 'function') target.focus();
      else {
        target.setAttribute('tabindex', '-1');
        target.focus();
      }
    },
    close() {
      if (modal.hidden) return;
      modal.hidden = true;
      const index = wiredModals.indexOf(modal);
      if (index >= 0) wiredModals.splice(index, 1);
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.documentElement.style.overflow = '';
      const opener = ctrl.opener;
      ctrl.opener = null;
      if (opener && document.contains(opener) && !opener.closest('[hidden]')) opener.focus();
      else if (wiredModals.length > 0) {
        const under = topWiredModal();
        const target = focusTargetOf(under, under.__stWired?.focusId);
        if (typeof target.focus === 'function') target.focus();
      }
    },
    requestClose: modal.__stRequestClose,
  };
  ctrl.api = api;
  installWiredListener();
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.__stRequestClose();
  });
  return api;
}

// Authentication expiry is not a user-directed modal close: every sensitive
// surface disappears immediately and no dirty confirmation may keep it open.
export function forceCloseAllModals() {
  for (const modal of [...wiredModals].reverse()) {
    modal.__stWired?.api?.close();
  }
  scrollLockCount = 0;
  document.documentElement.style.overflow = '';
}

export { createDialogManager };
