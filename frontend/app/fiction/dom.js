export function el(tag, value = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

export function button(label, action, className = 'btn btn-secondary') {
  const node = el('button', label, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

export function field(label, type = 'input', value = '', options = {}) {
  const wrapper = el('div', '', `fiction-field${options.wrapperClass ? ` ${options.wrapperClass}` : ''}`);
  const control = document.createElement(type);
  control.id = `field-${globalThis.crypto.randomUUID()}`;
  if (type !== 'select') control.value = value;
  for (const [key, item] of Object.entries(options)) {
    if (!['wrapperClass', 'hint'].includes(key)) control[key] = item;
  }
  const caption = el('label', label); caption.htmlFor = control.id;
  wrapper.append(caption, control);
  if (options.hint) {
    const hint = el('p', options.hint, 'fiction-field__hint');
    hint.id = `${control.id}-hint`; control.setAttribute('aria-describedby', hint.id); wrapper.append(hint);
  }
  return { wrapper, control };
}

export function option(value, label) {
  const node = el('option', label); node.value = value; return node;
}
