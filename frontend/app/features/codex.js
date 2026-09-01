// PR 13 Codex: story-local foundations, bounded page-provenanced memory,
// and author-owned corrections. This surface never loads manuscript prose;
// evidence links route to the exact Desk page instead.

import { formatUsd } from '../core/dom.js';
import { approxCostText, estimateContinuityCost, ROUGH_TEXT_CALL_ESTIMATE } from '../core/cost.js';

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function valueText(value) {
  if (Array.isArray(value)) return value.join('; ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join('; ');
  return value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
}

function labelOf(field) {
  return String(field || '').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function createCodex({ api, state, notify, features, dialogs, router }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let routeController = router;
  let activeStoryId = null;
  let continuity = null;
  let templates = [];
  let loadToken = 0;
  let facts = [];

  function setStatus(text) {
    const status = document.getElementById('codexStatus');
    if (status) status.textContent = text;
  }

  function pageNumberForRevision(revisionId) {
    return continuity?.coverage?.pages?.find((page) => page.page_revision_id === revisionId)?.page_number || null;
  }

  function openEvidence(provenance) {
    const wrap = el('div', 'codex-evidence');
    const evidence = provenance?.evidence || provenance?.correction?.evidence || [];
    const fallbackRevision = provenance?.page_revision_id || evidence[0]?.page_revision_id;
    const pageNumber = provenance?.page_number || pageNumberForRevision(fallbackRevision);
    if (pageNumber) {
      const link = el('button', 'codex-evidence__link', `Page ${pageNumber}`);
      link.type = 'button';
      link.addEventListener('click', () => routeController.navigate('desk', {
        storyId: activeStoryId,
        pageNumber,
      }));
      wrap.appendChild(link);
    }
    if (evidence.length) {
      for (const item of evidence.slice(0, 5)) {
        const quote = el('q', 'codex-evidence__quote', item.quote || 'Cited page revision');
        wrap.appendChild(quote);
      }
    } else if (provenance?.correction) {
      wrap.appendChild(el('span', 'codex-evidence__note', 'Author correction'));
    } else if (pageNumber) {
      wrap.appendChild(el('span', 'codex-evidence__note', 'Legacy record; no direct quotation stored'));
    } else {
      wrap.appendChild(el('span', 'codex-evidence__note', 'Foundation snapshot'));
    }
    return wrap;
  }

  function factCard({ kind, title, value, provenance, correction = null }) {
    const card = el('article', 'codex-fact');
    card.dataset.codexSearch = `${kind} ${title} ${valueText(value)}`.toLowerCase();
    card.append(el('p', 'codex-fact__kind', kind), el('h4', '', title), el('p', 'codex-fact__value', valueText(value)));
    card.appendChild(openEvidence(provenance));
    if (correction) {
      const button = el('button', 'btn btn-secondary codex-fact__correct', 'Correct this fact');
      button.type = 'button';
      button.addEventListener('click', () => openCorrection(correction));
      card.appendChild(button);
    }
    return card;
  }

  function renderFoundations() {
    const target = document.getElementById('codexFoundations');
    if (!target) return;
    target.textContent = '';
    target.appendChild(el('h3', '', 'Story-local foundations'));
    target.appendChild(el('p', 'setting-hint', 'These snapshots stay with this manuscript. Later Library edits do not enter the story unless you accept individual fields below.'));
    const grid = el('div', 'codex-grid');
    const world = continuity?.world;
    if (world) {
      for (const field of ['name', 'genre', 'setting', 'description', 'lore']) {
        if (world[field]) grid.appendChild(factCard({ kind: 'World foundation', title: labelOf(field), value: world[field], provenance: null }));
      }
    }
    for (const character of continuity?.characters || []) {
      for (const field of ['role', 'relation', 'description', 'personality', 'appearance', 'background']) {
        if (character[field]) grid.appendChild(factCard({ kind: 'Character foundation', title: `${character.name} · ${labelOf(field)}`, value: character[field], provenance: null }));
      }
    }
    if (!grid.children.length) grid.appendChild(el('p', 'codex-empty', 'This manuscript has no world or cast foundations yet.'));
    target.appendChild(grid);
    renderTemplateUpdates();
  }

  function renderTemplateUpdates() {
    const target = document.getElementById('codexTemplateUpdates');
    if (!target) return;
    target.textContent = '';
    target.appendChild(el('h3', '', 'Library template updates'));
    const changed = templates.filter((entry) => entry.changes?.length);
    if (!changed.length) {
      target.appendChild(el('p', 'codex-empty', 'No Library fields differ from this manuscript’s snapshots.'));
      return;
    }
    for (const entry of changed) {
      const card = el('article', 'codex-template');
      card.appendChild(el('h4', '', `${labelOf(entry.template_kind)} template`));
      const form = el('form', 'codex-template__form');
      for (const change of entry.changes) {
        const label = el('label', 'codex-template__change');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'field';
        checkbox.value = change.field;
        label.append(checkbox, el('span', '', `${labelOf(change.field)}: “${valueText(change.from)}” → “${valueText(change.to)}”`));
        form.appendChild(label);
      }
      const importButton = el('button', 'btn btn-secondary', 'Import selected fields');
      importButton.type = 'submit';
      form.appendChild(importButton);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fields = [...form.querySelectorAll('input:checked')].map((input) => input.value);
        if (!fields.length) {
          showError('Select at least one changed field to import.');
          return;
        }
        importButton.disabled = true;
        try {
          const result = await apiCall(`/stories/${activeStoryId}/continuity/templates/${entry.template_kind}/${entry.source_template_id}/import`, 'POST', { fields });
          continuity = result.continuity;
          templates = (await apiCall(`/stories/${activeStoryId}/continuity/templates`)).templates || [];
          render();
          showSuccess(`Imported ${fields.length} selected foundation field${fields.length === 1 ? '' : 's'}. Unselected fields stayed unchanged.`);
        } catch (error) {
          showError(error.message);
        } finally {
          importButton.disabled = false;
        }
      });
      card.appendChild(form);
      target.appendChild(card);
    }
  }

  function rememberFact(target, spec) {
    facts.push(spec);
    target.appendChild(factCard(spec));
  }

  function renderCanon() {
    const target = document.getElementById('codexCanon');
    if (!target) return;
    target.textContent = '';
    facts = [];
    const sections = [
      ['Character state', el('div', 'codex-grid')],
      ['Goals and threads', el('div', 'codex-grid')],
      ['World facts and arcs', el('div', 'codex-grid')],
      ['Recent events', el('div', 'codex-grid')],
    ];
    for (const character of continuity?.characters || []) {
      const current = character.current || {};
      for (const field of ['location', 'condition', 'knowledge', 'possessions', 'personality', 'appearance', 'relationship_to_mc']) {
        const value = current[field];
        if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
        const provenance = character.evidence?.[field];
        rememberFact(sections[0][1], {
          kind: 'Character state', title: `${character.name} · ${labelOf(field)}`, value, provenance,
          correction: !Array.isArray(value) ? { scope: 'character', subject_id: character.id, field, value, title: `${character.name} · ${labelOf(field)}`, provenance } : null,
        });
      }
      for (const [otherId, relationship] of Object.entries(current.relationships || {})) {
        const other = continuity.characters.find((item) => item.id === otherId)?.name || otherId;
        const provenance = character.evidence?.[`relationship:${otherId}`];
        rememberFact(sections[0][1], { kind: 'Relationship', title: `${character.name} → ${other}`, value: relationship, provenance });
      }
    }
    for (const [collection, kind, sectionIndex] of [
      [continuity?.goals || [], 'Goal', 1], [continuity?.threads || [], 'Thread', 1],
      [continuity?.world_facts || [], 'World fact', 2], [continuity?.arcs || [], 'Arc', 2],
    ]) {
      for (const item of collection) {
        const field = kind === 'Arc' ? 'movement' : 'status';
        rememberFact(sections[sectionIndex][1], {
          kind, title: item.text || `Untitled ${kind.toLowerCase()}`, value: item[field], provenance: item.provenance,
          correction: kind === 'Arc' ? null : {
            scope: kind === 'Goal' ? 'goal' : kind === 'Thread' ? 'thread' : 'world',
            subject_id: item.id, field, value: item[field], title: item.text || kind, provenance: item.provenance,
          },
        });
      }
    }
    for (const event of [...(continuity?.events || [])].reverse()) {
      rememberFact(sections[3][1], { kind: `Event · ${event.type || 'recorded'}`, title: event.text, value: event.importance || 'recorded', provenance: event });
    }
    for (const [heading, grid] of sections) {
      const block = el('section', 'codex-canon-section');
      block.append(el('h3', '', heading), grid);
      if (!grid.children.length) grid.appendChild(el('p', 'codex-empty', 'Nothing recorded here yet.'));
      target.appendChild(block);
    }
    applyFilter();
  }

  function renderCoverage() {
    const target = document.getElementById('codexCoverage');
    if (!target) return;
    target.textContent = '';
    const coverage = continuity?.coverage;
    if (!coverage) return;
    const missing = coverage.pages.filter((page) => page.status !== 'ready');
    const heading = el('div', 'codex-coverage');
    heading.append(
      el('div', '', `${coverage.ready} of ${coverage.total} committed text pages remembered`),
      el('div', '', `${formatUsd(coverage.memory_cost_usd || 0)} recorded extraction cost`),
    );
    const explanation = el('p', 'setting-hint', 'Prepared next-page prose is not committed and never appears in remembered canon. Repair resumes from only missing or failed canonical pages.');
    target.append(heading, explanation);
    if (missing.length) {
      const repair = el('button', 'btn btn-secondary', `Repair ${missing.length} missing or failed page${missing.length === 1 ? '' : 's'}`);
      repair.type = 'button';
      repair.addEventListener('click', repairMemory);
      target.appendChild(repair);
    }
    const failures = coverage.failed || [];
    if (failures.length) {
      const list = el('ul', 'codex-failures');
      for (const failure of failures) {
        const item = el('li', '', `Page ${failure.page_number}: ${failure.error || 'Archivist extraction failed.'}`);
        list.appendChild(item);
      }
      target.appendChild(list);
    }
  }

  async function repairMemory() {
    const pages = (continuity?.coverage?.pages || []).filter((page) => page.status !== 'ready');
    if (!pages.length) return;
    const estimate = estimateContinuityCost({ models: state.modelsCache, model: state.settings.model, pageChars: state.settings.wordsPerPage * 6 }) * pages.length;
    const yes = await dialogs.confirmPaid({
      title: 'Repair remembered canon?',
      review: {
        action: `Read ${pages.length} missing or failed committed page${pages.length === 1 ? '' : 's'} in order.`,
        object: state.data.currentStory?.title || 'this manuscript',
        model: state.settings.model || 'the Archivist default model',
        quantity: `${pages.length} bounded extraction${pages.length === 1 ? '' : 's'}`,
        sends: 'each affected canonical page, its direction, cast ids, and compact prior state',
        estimate,
        maximum: estimate * 2,
        note: 'Each revision joins any extraction already in flight. Completed pages are saved immediately, so retrying resumes without rebilling them.',
      },
      confirmLabel: `Repair memory (${approxCostText(estimate)})`,
    });
    if (!yes) return;
    const buttons = document.querySelectorAll('#codexSection button');
    for (const button of buttons) button.disabled = true;
    try {
      const failed = [];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        setStatus(`Archivist repair: page ${page.page_number} · ${index + 1} of ${pages.length}`);
        const result = await apiCall(`/stories/${activeStoryId}/continuity/pages/${page.page_id}/sync`, 'POST', {
          ...(state.settings.model ? { model: state.settings.model } : {}),
        });
        state.addCostForStory(activeStoryId, result.memory?.cost_usd);
        if (result.memory?.status !== 'ready') failed.push(page.page_number);
      }
      await load(activeStoryId);
      if (failed.length) showError(`Memory still needs attention on page${failed.length === 1 ? '' : 's'} ${failed.join(', ')}.`);
      else showSuccess('Remembered canon now covers every committed text page.');
    } catch (error) {
      showError(error.message);
      await load(activeStoryId);
    } finally {
      for (const button of buttons) button.disabled = false;
    }
  }

  function openCorrection(spec) {
    const body = el('div', 'codex-correction-form');
    body.append(el('p', '', `Current value: ${valueText(spec.value)}`), openEvidence(spec.provenance));
    const valueLabel = el('label', '', 'Authoritative value');
    const value = document.createElement('textarea');
    value.rows = 3;
    value.maxLength = 10000;
    value.value = valueText(spec.value) === 'Not recorded' ? '' : valueText(spec.value);
    valueLabel.appendChild(value);
    const reasonLabel = el('label', '', 'Reason (optional)');
    const reason = document.createElement('textarea');
    reason.rows = 2;
    reason.maxLength = 2000;
    reasonLabel.appendChild(reason);
    const evidence = spec.provenance?.evidence?.[0];
    body.append(valueLabel, reasonLabel, el('p', 'setting-hint', evidence
      ? 'The visible source quotation will be attached to this correction.'
      : 'No direct quotation is available; this correction will be recorded as an author assertion.'));
    dialogs.openDialog({
      title: `Correct ${spec.title}`,
      body,
      dirty: () => value.value.trim() !== valueText(spec.value) || reason.value.trim() !== '',
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        {
          label: 'Apply', className: 'btn-primary', onClick: async (close) => {
            const next = value.value.trim();
            if (!next) {
              value.setCustomValidity('Enter the authoritative value.');
              value.reportValidity();
              return;
            }
            close(true);
            try {
              const result = await apiCall(`/stories/${activeStoryId}/continuity/corrections`, 'POST', {
                scope: spec.scope, subject_id: spec.subject_id, field: spec.field, value: next,
                reason: reason.value.trim() || null,
                evidence: evidence && spec.provenance?.page_revision_id
                  ? [{ page_revision_id: spec.provenance.page_revision_id, quote: evidence.quote }]
                  : [],
              });
              continuity = result.continuity;
              render();
              selectTab('corrections');
              showSuccess(`Correction applied as a separate author record. ${result.issues.length} possible later conflict${result.issues.length === 1 ? '' : 's'} remain warnings.`);
            } catch (error) {
              showError(error.message);
            }
          },
        },
      ],
    });
  }

  async function setIssue(issue, status) {
    try {
      const result = await apiCall(`/stories/${activeStoryId}/continuity/issues/${issue.id}`, 'PATCH', { status });
      const current = continuity.issues.find((entry) => entry.id === issue.id);
      if (current) Object.assign(current, result.issue);
      renderCorrections();
      showSuccess(status === 'acknowledged' ? 'Marked as prose you intend to keep.' : 'Warning marked resolved after your review.');
    } catch (error) {
      showError(error.message);
    }
  }

  function renderCorrections() {
    const actionTarget = document.getElementById('codexCorrectionActions');
    const correctionTarget = document.getElementById('codexCorrections');
    const issueTarget = document.getElementById('codexIssues');
    if (!actionTarget || !correctionTarget || !issueTarget) return;
    actionTarget.textContent = '';
    correctionTarget.textContent = '';
    issueTarget.textContent = '';
    actionTarget.append(el('h3', '', 'Correction workflow'), el('p', 'setting-hint', 'Choose “Correct this fact” in Remembered canon. Applying changes the folded state only; it never rewrites prose or hidden Archivist records.'));
    correctionTarget.appendChild(el('h3', '', 'Author corrections'));
    for (const correction of continuity?.corrections || []) {
      correctionTarget.appendChild(factCard({
        kind: `Correction · ${correction.scope}`, title: labelOf(correction.field), value: correction.value,
        provenance: { correction: { evidence: correction.evidence || [] } },
      }));
    }
    if (!continuity?.corrections?.length) correctionTarget.appendChild(el('p', 'codex-empty', 'No author corrections have been applied.'));
    issueTarget.appendChild(el('h3', '', 'Possible later conflicts'));
    const issues = continuity?.issues || [];
    for (const issue of issues) {
      const card = el('article', `codex-issue codex-issue--${issue.status}`);
      card.append(
        el('p', 'codex-fact__kind', labelOf(issue.status)),
        el('h4', '', `Page ${issue.detail?.page_number || 'unknown'}`),
        el('p', '', issue.detail?.reason || 'Later prose may mention the corrected subject or prior state.'),
        el('p', 'codex-issue__terms', `Matched: ${(issue.detail?.matched_terms || []).join(', ') || 'subject reference'}`),
      );
      const actions = el('div', 'codex-issue__actions');
      const intentional = el('button', 'btn btn-secondary', 'Mark prose intentional');
      intentional.type = 'button';
      intentional.disabled = issue.status === 'acknowledged';
      intentional.addEventListener('click', () => setIssue(issue, 'acknowledged'));
      const returnStory = el('button', 'btn btn-secondary', 'Return story');
      returnStory.type = 'button';
      returnStory.addEventListener('click', () => routeController.navigate('desk', { storyId: activeStoryId, pageNumber: issue.detail?.page_number }));
      const resolved = el('button', 'btn btn-secondary', 'Mark resolved');
      resolved.type = 'button';
      resolved.disabled = issue.status === 'resolved';
      resolved.addEventListener('click', () => setIssue(issue, 'resolved'));
      actions.append(intentional, returnStory, resolved);
      card.appendChild(actions);
      issueTarget.appendChild(card);
    }
    if (!issues.length) issueTarget.appendChild(el('p', 'codex-empty', 'No deterministic impact warnings.'));
    const openIssues = issues.filter((issue) => issue.status === 'open');
    if (openIssues.length) {
      const summarize = el('button', 'btn btn-secondary', `Ask AI to summarize ${openIssues.length} warning${openIssues.length === 1 ? '' : 's'} (${approxCostText(ROUGH_TEXT_CALL_ESTIMATE)})`);
      summarize.type = 'button';
      summarize.addEventListener('click', () => summarizeIssues(openIssues));
      issueTarget.appendChild(summarize);
    }
  }

  async function summarizeIssues(issues) {
    const yes = await dialogs.confirmPaid({
      title: 'Ask AI to summarize impact warnings?',
      review: {
        action: 'Summarize the selected deterministic warnings in plain language. No correction or prose change is applied.',
        object: state.data.currentStory?.title || 'this manuscript',
        model: state.settings.model || 'the Archivist default model',
        quantity: 'one bounded summary',
        sends: 'correction fields, warning reasons, matched terms, and page numbers; no manuscript prose',
        estimate: ROUGH_TEXT_CALL_ESTIMATE,
        maximum: ROUGH_TEXT_CALL_ESTIMATE,
      },
      confirmLabel: `Summarize (${approxCostText(ROUGH_TEXT_CALL_ESTIMATE)})`,
    });
    if (!yes) return;
    try {
      const result = await apiCall(`/stories/${activeStoryId}/continuity/issues/summary`, 'POST', {
        issue_ids: issues.map((issue) => issue.id),
        ...(state.settings.model ? { model: state.settings.model } : {}),
      });
      state.addCostForStory(activeStoryId, result.cost_usd);
      const target = document.getElementById('codexImpactSummary');
      target.textContent = '';
      target.append(el('h3', '', 'Optional AI summary'), el('p', '', result.summary || 'No summary was returned.'));
    } catch (error) {
      showError(error.message);
    }
  }

  function applyFilter() {
    const query = document.getElementById('codexSearch')?.value.trim().toLowerCase() || '';
    for (const card of document.querySelectorAll('#codexCanon .codex-fact')) {
      card.hidden = Boolean(query) && !card.dataset.codexSearch.includes(query);
    }
  }

  function selectTab(name) {
    const map = { foundations: 'Foundations', canon: 'Canon', corrections: 'Corrections' };
    for (const [key, suffix] of Object.entries(map)) {
      const tab = document.getElementById(`codex${suffix}Tab`);
      const panel = document.getElementById(`codex${suffix}Panel`);
      const selected = key === name;
      if (tab) tab.setAttribute('aria-selected', String(selected));
      if (panel) panel.hidden = !selected;
    }
  }

  function render() {
    renderFoundations();
    renderCoverage();
    renderCanon();
    renderCorrections();
  }

  async function chooseStory(storyId) {
    let story = state.data.currentStory?.id === storyId ? state.data.currentStory : state.data.stories.find((item) => item.id === storyId);
    if (!story) {
      await features.stories.loadStories();
      story = state.data.stories.find((item) => item.id === storyId);
    }
    if (!story) return null;
    if (state.data.currentStory?.id !== story.id) {
      features.write.resetStoryReader();
      state.data.currentStory = story;
      state.resetStoryCost();
    }
    return story;
  }

  async function load(storyId) {
    const token = ++loadToken;
    setStatus('Opening story-local foundations and bounded continuity records…');
    try {
      const [memory, review] = await Promise.all([
        apiCall(`/stories/${storyId}/continuity`),
        apiCall(`/stories/${storyId}/continuity/templates`),
      ]);
      if (token !== loadToken || activeStoryId !== storyId) return;
      continuity = memory.continuity;
      templates = review.templates || [];
      render();
      setStatus(`${continuity.coverage.ready} of ${continuity.coverage.total} committed text pages remembered. Prose stays on the Desk.`);
    } catch (error) {
      if (token !== loadToken) return;
      continuity = null;
      templates = [];
      render();
      setStatus(`Codex could not load: ${error.message}`);
      showError(error.message);
    }
  }

  async function enter(params = {}) {
    if (!params.storyId) return;
    const story = await chooseStory(params.storyId);
    if (!story) {
      showError('That story could not be found - it may have been deleted from another window.');
      routeController.navigate('library-stories');
      return;
    }
    activeStoryId = story.id;
    await load(story.id);
  }

  function init() {
    for (const name of ['Foundations', 'Canon', 'Corrections']) {
      document.getElementById(`codex${name}Tab`)?.addEventListener('click', () => selectTab(name.toLowerCase()));
    }
    document.getElementById('codexSearch')?.addEventListener('input', applyFilter);
  }

  function reset() {
    loadToken++;
    activeStoryId = null;
    continuity = null;
    templates = [];
    facts = [];
    for (const id of ['codexFoundations', 'codexTemplateUpdates', 'codexCoverage', 'codexCanon', 'codexCorrections', 'codexIssues', 'codexImpactSummary']) {
      const target = document.getElementById(id);
      if (target) target.textContent = '';
    }
    setStatus('Choose a manuscript to inspect its foundations and remembered canon.');
  }

  return { init, enter, load, render, reset, selectTab, repairMemory, setRouter(value) { routeController = value; } };
}
