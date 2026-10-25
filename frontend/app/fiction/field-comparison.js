import { el, button, field } from './dom.js';
export const fieldValue = (value, key) =>
  key.startsWith('data.') ? value?.data?.[key.slice(5)] : value?.[key];
export function putField(value, key, next) {
  if (key.startsWith('data.')) {
    value.data ||= {};
    value.data[key.slice(5)] = next;
  } else value[key] = next;
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export function fieldComparison({
  fields,
  before,
  proposal,
  getCurrent,
  changed = () => false,
  onApply,
  title = 'Compare candidate fields',
  applyLabel = 'Use selected candidate fields',
}) {
  const root = el('section', '', 'fiction-field-comparison');
  root.append(
    el('h3', title),
    el(
      'p',
      'Only checked fields change. Fields edited since the request start unchecked. Nothing is applied to a saved entry or story by this comparison alone.',
    ),
  );
  const viewport = el('div', '', 'fiction-field-comparison__scroll');
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', title);
  const table = el('table');
  const header = el('tr');
  for (const text of [
    'Select field',
    'Submitted seed / baseline',
    'Current fields',
    'Candidate',
  ]) {
    const cell = el('th', text);
    cell.scope = 'col';
    header.append(cell);
  }
  const thead = el('thead');
  thead.append(header);
  const tbody = el('tbody');
  table.append(thead, tbody);
  viewport.append(table);
  root.append(viewport);
  const current = clone(getCurrent());
  const selection = new Map();
  const error = el('p');
  error.setAttribute('role', 'alert');
  for (const key of fields) {
    const proposed = fieldValue(proposal, key);
    if (proposed === undefined) continue;
    const modified =
      changed(key) || !equal(fieldValue(current, key), fieldValue(before, key));
    const label = key.replace('data.', '').replaceAll('_', ' ');
    const check = field(
      `Use ${label}${modified ? ' · changed since request' : ''}`,
      'input',
      '',
      {
        type: 'checkbox',
        checked: !modified && !equal(fieldValue(current, key), proposed),
      },
    );
    selection.set(key, check.control);
    const row = el('tr');
    const name = el('td');
    name.append(check.wrapper);
    row.append(name);
    for (const value of [
      fieldValue(before, key),
      fieldValue(current, key),
      proposed,
    ])
      row.append(
        el('td', Array.isArray(value) ? value.join(', ') : (value ?? '')),
      );
    tbody.append(row);
  }
  root.append(
    error,
    button(applyLabel, () => {
      const keys = [...selection]
        .filter(([, input]) => input.checked)
        .map(([key]) => key);
      if (!keys.length) {
        error.textContent = 'Select at least one field.';
        return;
      }
      const latest = clone(getCurrent());
      if (
        keys.some(
          (key) => !equal(fieldValue(latest, key), fieldValue(current, key)),
        )
      ) {
        error.textContent =
          'These fields changed after comparison. Review the refreshed comparison before applying.';
        return;
      }
      for (const key of keys)
        putField(latest, key, clone(fieldValue(proposal, key)));
      onApply(latest, keys);
    }),
  );
  return root;
}
