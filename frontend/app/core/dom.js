// Safe DOM helpers: user/provider content enters the DOM through
// textContent and property assignment, never interpolated HTML strings.

export function byId(id) {
  return document.getElementById(id);
}

// Give every potentially slow button operation the same visible and
// assistive-technology state, while reliably restoring the button on failure.
export function beginButtonBusy(button, label) {
  if (!button) return () => {};
  const previous = {
    disabled: button.disabled,
    label: button.textContent,
    ariaBusy: button.getAttribute('aria-busy'),
  };
  button.disabled = true;
  button.textContent = label;
  button.setAttribute('aria-busy', 'true');
  return () => {
    button.disabled = previous.disabled;
    button.textContent = previous.label;
    if (previous.ariaBusy === null) button.removeAttribute('aria-busy');
    else button.setAttribute('aria-busy', previous.ariaBusy);
  };
}

// el('button', { type: 'button', className: 'x', onClick: fn }, [children])
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'onClick') node.addEventListener('click', value);
    else if (key === 'onChange') node.addEventListener('change', value);
    else if (key === 'onInput') node.addEventListener('input', value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function formatUsd(value) {
  const v = Number(value) || 0;
  return '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(4));
}

export function formatMinutes(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatMb(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes < 1024 * 1024) return bytes > 0 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '0 KB';
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}
