function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

const LABELS = {
  dice: 'Dice notation', oracle: 'Likelihood oracle', table: 'Weighted table',
  deck: 'Deck', fields: 'User-defined fields', clock: 'Progress clock',
};

function lineConfig(kind, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (kind === 'deck') return { cards: lines };
  if (kind === 'table') return { entries: lines.map((line) => {
    const [label, rawWeight] = line.split('|').map((part) => part.trim());
    return { label, weight: Number.parseInt(rawWeight || '1', 10) };
  }) };
  return { fields: lines.map((line) => {
    const [name, ...initial] = line.split('|').map((part) => part.trim());
    return { name, initial: initial.join(' | ') };
  }) };
}

function configLines(tool) {
  if (tool.kind === 'deck') return tool.config.cards.join('\n');
  if (tool.kind === 'table') return tool.config.entries.map((entry) => `${entry.label} | ${entry.weight}`).join('\n');
  return tool.config.fields.map((field) => `${field.name} | ${field.initial || ''}`).join('\n');
}

export function createSoloTools({ api, notify, dialogs, getContext }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let tools = [];
  let records = [];
  let selectedId = null;
  let busy = false;

  const byId = (id) => document.getElementById(id);
  const context = () => getContext() || {};

  function field(labelText, input) {
    const label = node('label', 'form-field', labelText);
    label.append(input);
    return label;
  }

  function renderPicker() {
    const select = byId('playToolSelect');
    if (!select) return;
    select.textContent = '';
    if (!tools.length) {
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No tools yet'; select.append(empty);
      select.disabled = true; selectedId = null; return;
    }
    if (!tools.some((tool) => tool.id === selectedId)) selectedId = tools[0].id;
    for (const tool of tools) {
      const option = document.createElement('option'); option.value = tool.id;
      option.textContent = `${tool.name} · ${LABELS[tool.kind]}`; option.selected = tool.id === selectedId; select.append(option);
    }
    select.disabled = busy;
  }

  function actionButton(label, operation, className = 'btn btn-primary', requiresActiveSession = true) {
    const button = node('button', className, label); button.type = 'button';
    button.disabled = busy || (requiresActiveSession && context().session?.status !== 'active');
    button.addEventListener('click', operation); return button;
  }

  async function execute(input) {
    const { storyId, session } = context();
    if (!storyId || !session || !selectedId || busy) return;
    busy = true; render();
    try {
      const result = await apiCall(`/stories/${storyId}/play-sessions/${session.id}/tool-results`, 'POST', { tool_id: selectedId, input });
      tools = tools.map((tool) => tool.id === result.tool.id ? result.tool : tool);
      records.push(result.record);
      showSuccess(`${result.record.summary}. Recorded locally; no AI was called.`);
    } catch (error) { showError(error.message); }
    finally { busy = false; render(); }
  }

  function renderRunner() {
    const target = byId('playToolRunner');
    if (!target) return;
    target.textContent = '';
    const tool = tools.find((item) => item.id === selectedId);
    if (!tool) { target.append(node('p', 'setting-hint', 'Create a reusable tool for this manuscript.')); return; }
    const head = node('div', 'play-tool-runner__head');
    const title = node('div'); title.append(node('h4', '', tool.name), node('p', 'setting-hint', `${LABELS[tool.kind]} · deterministic local operation`));
    const manage = node('div', 'play-tool-runner__actions');
    manage.append(
      actionButton('Edit tool', () => openToolDialog(tool), 'btn btn-secondary', false),
      actionButton('Archive tool', () => archiveTool(tool), 'btn btn-danger', false),
    );
    head.append(title, manage); target.append(head);
    if (tool.kind === 'dice') {
      const input = document.createElement('input'); input.value = tool.config.notation; input.maxLength = 30;
      target.append(field('Notation', input), actionButton('Roll and record', () => execute({ notation: input.value })));
    } else if (tool.kind === 'oracle') {
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '99'; input.value = String(tool.config.chance);
      target.append(field('Chance of yes (%)', input), actionButton('Ask and record', () => execute({ chance: Number(input.value) })));
    } else if (tool.kind === 'table') {
      target.append(node('p', 'setting-hint', `${tool.config.entries.length} weighted outcomes.`), actionButton('Draw outcome and record', () => execute({})));
    } else if (tool.kind === 'deck') {
      const remaining = tool.state.remaining?.length || 0;
      target.append(node('p', 'setting-hint', `${remaining} of ${tool.config.cards.length} cards remain. Empty decks never reset themselves.`));
      const actions = node('div', 'play-tool-runner__actions');
      actions.append(actionButton('Draw and record', () => execute({ action: 'draw' })), actionButton('Reset deck and record', () => execute({ action: 'reset' }), 'btn btn-secondary')); target.append(actions);
    } else if (tool.kind === 'fields') {
      const fields = node('div', 'play-tool-fields'); const inputs = new Map();
      for (const definition of tool.config.fields) {
        const input = document.createElement('input'); input.maxLength = 500; input.value = tool.state.values?.[definition.name] ?? definition.initial;
        inputs.set(definition.name, input); fields.append(field(definition.name, input));
      }
      target.append(fields, actionButton('Commit changed fields', () => execute({ values: Object.fromEntries([...inputs].map(([name, input]) => [name, input.value])) })));
    } else {
      const current = tool.state.current ?? tool.config.initial;
      target.append(node('p', 'setting-hint', `${current} of ${tool.config.segments} segments filled.`));
      const actions = node('div', 'play-tool-runner__actions');
      actions.append(actionButton('Clear one', () => execute({ change: -1 }), 'btn btn-secondary'), actionButton('Fill one', () => execute({ change: 1 }))); target.append(actions);
    }
  }

  function renderRecords() {
    const target = byId('playToolRecords');
    if (!target) return;
    target.textContent = '';
    if (!records.length) { target.append(node('p', 'setting-hint', 'No tool result has been committed on this path.')); return; }
    for (const record of records.slice(-30).reverse()) {
      const item = node('article', 'play-tool-record');
      item.append(node('p', 'play-turn__meta', `${record.tool_name} · ${LABELS[record.tool_kind]} · after turn ${record.after_turn_ordinal}`), node('strong', '', record.summary));
      target.append(item);
    }
  }

  function render() { renderPicker(); renderRunner(); renderRecords(); if (byId('playToolNew')) byId('playToolNew').disabled = busy || !context().storyId; }

  function configEditor(form, kind, tool = null) {
    const wrap = node('div', 'play-tool-config');
    if (kind === 'dice') {
      const input = document.createElement('input'); input.name = 'notation'; input.value = tool?.config.notation || '1d20'; input.maxLength = 30; wrap.append(field('Default dice notation', input));
    } else if (kind === 'oracle') {
      const input = document.createElement('input'); input.name = 'chance'; input.type = 'number'; input.min = '1'; input.max = '99'; input.value = tool?.config.chance || '50'; wrap.append(field('Default chance of yes (%)', input));
    } else if (['table', 'deck', 'fields'].includes(kind)) {
      const area = document.createElement('textarea'); area.name = 'lines'; area.rows = 8; area.maxLength = 30000;
      area.value = tool ? configLines(tool) : kind === 'table' ? 'Likely outcome | 3\nRare outcome | 1' : kind === 'deck' ? 'First card\nSecond card' : 'Momentum | 0\nSupply | 5';
      const label = kind === 'table' ? 'One outcome per line: label | weight' : kind === 'deck' ? 'One card per line' : 'One field per line: name | initial value';
      wrap.append(field(label, area));
    } else {
      const segments = document.createElement('input'); segments.name = 'segments'; segments.type = 'number'; segments.min = '2'; segments.max = '20'; segments.value = tool?.config.segments || '6';
      const initial = document.createElement('input'); initial.name = 'initial'; initial.type = 'number'; initial.min = '0'; initial.max = '20'; initial.value = tool?.config.initial ?? '0';
      wrap.append(field('Segments', segments), field(tool ? 'Original initial progress' : 'Initial progress', initial));
    }
    form.append(wrap); return wrap;
  }

  function readConfig(kind, wrap) {
    if (kind === 'dice') return { notation: wrap.querySelector('[name="notation"]').value };
    if (kind === 'oracle') return { chance: Number(wrap.querySelector('[name="chance"]').value) };
    if (['table', 'deck', 'fields'].includes(kind)) return lineConfig(kind, wrap.querySelector('[name="lines"]').value);
    return { segments: Number(wrap.querySelector('[name="segments"]').value), initial: Number(wrap.querySelector('[name="initial"]').value) };
  }

  function openToolDialog(tool = null) {
    const form = node('form', 'scene-form'); form.addEventListener('submit', (event) => event.preventDefault());
    const name = document.createElement('input'); name.required = true; name.maxLength = 200; name.value = tool?.name || '';
    const kind = document.createElement('select');
    for (const [value, label] of Object.entries(LABELS)) { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = value === tool?.kind; kind.append(option); }
    kind.disabled = Boolean(tool);
    form.append(field('Tool name', name), field('Tool kind', kind));
    let editor = configEditor(form, kind.value, tool);
    kind.addEventListener('change', () => { editor.remove(); editor = configEditor(form, kind.value); });
    dialogs.openDialog({ title: tool ? `Edit ${tool.name}` : 'Create a solo tool', body: form, actions: [
      { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
      { label: tool ? 'Save tool' : 'Create tool', className: 'btn-primary', onClick: async (close) => {
        if (!name.value.trim()) { name.setCustomValidity('Name this tool.'); name.reportValidity(); return; }
        close(true); busy = true; render();
        try {
          const { storyId } = context();
          const result = await apiCall(tool ? `/stories/${storyId}/solo-tools/${tool.id}` : `/stories/${storyId}/solo-tools`, tool ? 'PUT' : 'POST', { name: name.value.trim(), ...(tool ? {} : { kind: kind.value }), config: readConfig(kind.value, editor) });
          tools = tool ? tools.map((item) => item.id === result.tool.id ? result.tool : item) : [...tools, result.tool];
          selectedId = result.tool.id; showSuccess(`${result.tool.name} saved locally. No AI was called.`);
        } catch (error) { showError(error.message); }
        finally { busy = false; render(); }
      } },
    ] });
  }

  function archiveTool(tool) {
    dialogs.openDialog({ title: `Archive ${tool.name}?`, body: 'The tool leaves the picker. Every frozen result keeps its name, kind, and outcome.', actions: [
      { label: 'Keep tool', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
      { label: 'Archive tool', className: 'btn-danger', onClick: async (close) => {
        close(true); busy = true; render();
        try { await apiCall(`/stories/${context().storyId}/solo-tools/${tool.id}`, 'DELETE'); tools = tools.filter((item) => item.id !== tool.id); selectedId = tools[0]?.id || null; showSuccess('Tool archived; frozen results remain.'); }
        catch (error) { showError(error.message); }
        finally { busy = false; render(); }
      } },
    ] });
  }

  async function load() {
    const { storyId, session } = context();
    if (!storyId || !session) { tools = []; records = []; selectedId = null; render(); return; }
    const [toolResult, recordResult] = await Promise.all([
      apiCall(`/stories/${storyId}/solo-tools`), apiCall(`/stories/${storyId}/play-sessions/${session.id}/tool-results`),
    ]);
    tools = toolResult.tools || []; records = recordResult.records || [];
    render();
  }

  function init() {
    byId('playToolSelect')?.addEventListener('change', (event) => { selectedId = event.target.value || null; render(); });
    byId('playToolNew')?.addEventListener('click', () => openToolDialog());
  }

  function reset() { tools = []; records = []; selectedId = null; busy = false; render(); }
  return { init, load, reset, render };
}
