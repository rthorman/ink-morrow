import { recoverLocalDrafts } from './local-draft-recovery.js';
import { el, field, button, option } from './dom.js';
import { createPrivateDraft } from './private-drafts.js';
const sections = {
  relationships: ['relationship'],
  promises: ['commitment'],
  debts: ['commitment', 'resource'],
  knowledge: ['fact'],
  secrets: ['fact'],
  goals: ['goal'],
  factions: ['fact'],
  quests: ['goal'],
  conditions: ['fact'],
  inventory: ['resource'],
};
export function createCampaignStudio({
  api,
  dialogs,
  getCurrent,
  getLive,
  runAction,
}) {
  let serial = 0;
  const drafts = new Set();
  function clear() {
    serial++;
    for (const draft of drafts) draft.close();
    drafts.clear();
  }
  async function open() {
    const story = getCurrent();
    if (!story) return;
    const ticket = ++serial;
    const live = getLive();
    const active = () =>
      live() && serial === ticket && getCurrent()?.id === story.id;
    const root = el('div', 'Opening private campaign ledger…');
    dialogs.openDialog({
      title: 'Campaign records',
      variant: 'studio',
      body: [root],
      actions: [{ label: 'Close', onClick: (close) => close(true) }],
    });
    try {
      const context = await api(`/fiction/${story.id}/creative`);
      if (!active()) return;
      const form = el('div', '', 'fiction-studio-grid'),
        status = el('p'),
        error = el('p', '', 'fiction-error'),
        recovery = el('section');
      error.setAttribute('role', 'alert');
      status.setAttribute('role', 'status');
      let availableFacts = [...context.facts];
      const controls = {};
      const add = (name, label, type = 'input', value = '', opts = {}) => {
        const input = field(label, type, value, opts);
        controls[name] = input.control;
        form.append(input.wrapper);
        return input.control;
      };
      const existing = add('existing', 'Update a recorded item', 'select');
      existing.append(
        option('', 'Declare a new record'),
        ...context.facts.map((fact) =>
          option(
            fact.id,
            `${fact.campaign_section || fact.kind} · ${fact.text}`,
          ),
        ),
      );
      const section = add('section', 'Campaign section', 'select');
      section.append(
        ...Object.keys(sections).map((name) =>
          option(name, name[0].toUpperCase() + name.slice(1)),
        ),
      );
      const kind = add('kind', 'Record type', 'select');
      add('text', 'Recorded description', 'textarea', '', {
        maxLength: 1500,
        rows: 4,
      });
      const actor = add('actor_id', 'Whose record?', 'select');
      actor.append(
        option('', 'World or unspecified'),
        ...context.cast.map((person) => option(person.id, person.name)),
      );
      const toward = add('toward_id', 'Relationship toward', 'select');
      toward.append(
        option('', 'Unspecified'),
        ...context.cast.map((person) => option(person.id, person.name)),
      );
      const facet = add('facet', 'Relationship aspect', 'select');
      facet.append(
        ...['general', 'affection', 'trust', 'cooperation', 'expectation'].map(
          (name) => option(name, name),
        ),
      );
      add('value', 'Resource amount (optional)', 'input', '', {
        type: 'number',
        min: -1000000,
        max: 1000000,
      });
      const state = add('status', 'Record status', 'select');
      state.append(option('active', 'Active'), option('resolved', 'Resolved'));
      const disposition = add(
        'resolution_disposition',
        'How did the goal end?',
        'select',
      );
      disposition.append(
        ...['achieved', 'abandoned', 'failed', 'superseded'].map((name) =>
          option(name, name),
        ),
      );
      const visibility = add('visibility', 'Visibility', 'select');
      visibility.append(
        option('public', 'Reader-visible'),
        option('secret', 'Private world truth'),
      );
      const knowledge = el('fieldset');
      knowledge.append(el('legend', 'Known by'));
      const known = [];
      for (const person of context.cast) {
        const input = field(person.name, 'input', person.id, {
          type: 'checkbox',
        });
        known.push(input.control);
        knowledge.append(input.wrapper);
      }
      form.append(knowledge);
      add('reason', 'Why declare or correct this record?', 'textarea', '', {
        maxLength: 1500,
        rows: 2,
      });
      const notice = el(
        'p',
        'This is an explicit owner declaration on the current path. It does not narrate an event or revise earlier prose. Sections use existing facts, commitments, qualitative relationships, goals and numeric resources; they do not simulate independent faction, debt or inventory systems. Private knowledge is sent only during a reviewed narration request.',
      );
      const search = field('Find older campaign records', 'input', '', {
        type: 'search',
        maxLength: 200,
      });
      const searchStatus = el('p');
      let cursor = null;
      const searchRecords = async (append = false) => {
        try {
          const query = new URLSearchParams({ q: search.control.value });
          if (append && cursor) query.set('cursor', cursor);
          const data = await api(`/fiction/${story.id}/planning?${query}`);
          if (!active()) return;
          if (!append) availableFacts = [];
          availableFacts = [
            ...new Map(
              [...availableFacts, ...data.records].map((fact) => [
                fact.id,
                fact,
              ]),
            ).values(),
          ];
          existing.replaceChildren(
            option('', 'Declare a new record'),
            ...availableFacts.map((fact) =>
              option(
                fact.id,
                `${fact.campaign_section || fact.kind} · ${fact.text}`,
              ),
            ),
          );
          cursor = data.next_cursor;
          searchStatus.textContent = `${availableFacts.length} matching records loaded. ${cursor ? 'More are available.' : ''}`;
          more.hidden = !cursor;
        } catch (caught) {
          if (active()) error.textContent = caught.message;
        }
      };
      const more = button('More matching records', () => searchRecords(true));
      more.hidden = true;
      form.prepend(
        search.wrapper,
        button('Search older records', () => searchRecords()),
        searchStatus,
        more,
      );
      let draft,
        version = 0,
        recordId = crypto.randomUUID();
      function syncTypes() {
        const before = kind.value;
        kind.replaceChildren(
          ...sections[section.value].map((name) => option(name, name)),
        );
        if (sections[section.value].includes(before)) kind.value = before;
        if (section.value === 'secrets') visibility.value = 'secret';
        sync();
      }
      function sync() {
        for (const name of ['facet', 'toward_id'])
          controls[name].closest('.fiction-field').hidden =
            kind.value !== 'relationship';
        controls.value.closest('.fiction-field').hidden =
          kind.value !== 'resource';
        disposition.closest('.fiction-field').hidden = !(
          kind.value === 'goal' && state.value === 'resolved'
        );
      }
      function value() {
        const fact = {
          id: recordId,
          kind: kind.value,
          text: controls.text.value,
          actor_id: actor.value || null,
          known_by: known
            .filter((input) => input.checked)
            .map((input) => input.value),
          visibility: visibility.value,
          status: state.value,
          value:
            kind.value === 'resource' && controls.value.value !== ''
              ? Number(controls.value.value)
              : null,
        };
        if (kind.value === 'relationship') {
          fact.facet = facet.value;
          fact.toward_id = toward.value || null;
        }
        if (kind.value === 'goal' && state.value === 'resolved')
          fact.resolution_disposition = disposition.value;
        return {
          record: { section: section.value, fact },
          reason: controls.reason.value,
        };
      }
      function populate(content) {
        const fact = content.record.fact;
        recordId = fact.id;
        section.value = content.record.section;
        syncTypes();
        kind.value = fact.kind;
        for (const name of [
          'text',
          'actor_id',
          'toward_id',
          'facet',
          'status',
          'visibility',
          'value',
          'resolution_disposition',
        ])
          if (fact[name] !== undefined) controls[name].value = fact[name] ?? '';
        controls.reason.value = content.reason || '';
        for (const input of known)
          input.checked = fact.known_by?.includes(input.value) || false;
        sync();
      }
      const persist = () => {
        version++;
        draft?.edit({ form: value() });
      };
      existing.addEventListener('change', () => {
        const fact = availableFacts.find((fact) => fact.id === existing.value);
        if (fact) {
          populate({
            record: {
              section:
                fact.campaign_section ||
                {
                  relationship: 'relationships',
                  commitment: 'promises',
                  goal: 'goals',
                  resource: 'inventory',
                  fact: 'knowledge',
                }[fact.kind],
              fact,
            },
            reason: '',
          });
        } else recordId = crypto.randomUUID();
        persist();
      });
      section.addEventListener('change', syncTypes);
      kind.addEventListener('change', sync);
      state.addEventListener('change', sync);
      syncTypes();
      for (const control of [...Object.values(controls), ...known])
        control.addEventListener('input', persist);
      async function reviewPrevious() {
        const submitted = draft.state?.row?.submitted;
        if (!submitted) return;
        const data = await api(
          `/fiction/${story.id}/commands/${submitted.action_key}`,
        );
        if (!active()) return;
        status.textContent = `Previous declaration: ${data.status}. Checking never repeats it.`;
        if (data.can_start_new)
          recovery.append(
            button('Acknowledge and close · reopen at latest', async () => {
              await draft.clearSubmission();
              dialogs.close(true);
            }),
          );
        else
          recovery.append(
            button('Cancel if not dispatched', async () => {
              await api(
                `/fiction/${story.id}/commands/${submitted.action_key}/cancel`,
                'POST',
                {},
              );
              await reviewPrevious();
            }),
          );
      }
      draft = createPrivateDraft({
        api,
        onChange: (saved) => {
          if (!active() || !saved) return;
          recovery.replaceChildren(
            el('p', saved.message),
            button('Save private draft now', () =>
              draft.flush().catch((caught) => {
                error.textContent = caught.message;
              }),
            ),
          );
          if (saved.row?.submitted)
            recovery.append(
              button('Review previous declaration', () =>
                reviewPrevious().catch((caught) => {
                  error.textContent = caught.message;
                }),
              ),
            );
          if (saved.conflict) {
            recovery.append(
              field(
                'Local declaration',
                'textarea',
                JSON.stringify(saved.local.form, null, 2),
                { readOnly: true },
              ).wrapper,
              field(
                'Saved declaration',
                'textarea',
                JSON.stringify(saved.conflict.content.form, null, 2),
                { readOnly: true },
              ).wrapper,
            );
            for (const [label, server] of [
              ['Use saved declaration', true],
              ['Keep compared local declaration', false],
            ])
              recovery.append(
                button(label, () => {
                  const result = draft.resolve(server);
                  if (result) populate(result.form);
                }),
              );
          }
        },
      });
      drafts.add(draft);
      const older = el('section');
      const recover = button('Recover an earlier campaign proposal…', () =>
        recoverLocalDrafts({
          api,
          gameId: story.id,
          kind: 'campaign',
          root: older,
          active,
          onCopy: (content) => {
            populate(content.form);
            persist();
          },
        }),
      );
      dialogs.openDialog({
        title: 'Campaign records',
        variant: 'studio',
        body: [notice, form, recovery, recover, older, status, error],
        dirty: () => Boolean(draft.state?.dirty),
        actions: [
          {
            label: 'Close',
            className: 'btn-secondary',
            onClick: (close) => close(),
          },
          {
            label: 'Declare record',
            className: 'btn-primary',
            pendingLabel: 'Saving declaration…',
            onClick: async (close) => {
              const before = version;
              try {
                if (getCurrent().revision !== context.revision)
                  throw Error(
                    'The destination changed. Keep this draft and reopen the latest campaign ledger before declaring.',
                  );
                if (
                  !controls.text.value.trim() ||
                  !controls.reason.value.trim()
                )
                  throw Error(
                    'Add the recorded description and declaration reason.',
                  );
                persist();
                const row = await draft.flush();
                if (!active()) return;
                if (version !== before + 1)
                  throw Error(
                    'Your declaration changed while saving. Review it again.',
                  );
                const submitted = await draft.submit({
                  game_id: story.id,
                  branch_id: context.target_branch_id,
                  head_beat_id: context.expected_head_beat_id,
                  revision: context.revision,
                  purpose: 'story-local-command',
                });
                if (!active()) return;
                if (version !== before + 1)
                  throw Error(
                    'Review the prepared declaration before trying again.',
                  );
                const result = await runAction(() =>
                  api(`/fiction/${story.id}/commands/campaign`, 'POST', {
                    action_key: submitted.actionKey,
                    expected_revision: context.revision,
                    target_branch_id: context.target_branch_id,
                    expected_head_beat_id: context.expected_head_beat_id,
                    ...row.content.form,
                  }),
                );
                if (!active()) return;
                if (!result?.ok) {
                  error.textContent =
                    result?.error ||
                    'Not applied. Your private proposal remains.';
                  return;
                }
                if (version === before + 1 && !draft.state.dirty) {
                  await draft.discard();
                  draft.close();
                  drafts.delete(draft);
                  close(true);
                } else
                  status.textContent =
                    'The reviewed declaration was saved. Newer private edits remain.';
              } catch (caught) {
                if (active()) error.textContent = caught.message;
              }
            },
          },
        ],
      });
      const initial = version;
      const restored = await draft.open(
        {
          type: 'local-reference',
          kind: 'campaign',
          subject_id: null,
          base_revision: null,
          game_id: story.id,
          branch_id: context.target_branch_id,
          head_id: context.expected_head_beat_id,
        },
        { form: value() },
      );
      if (active() && restored && version === initial) populate(restored.form);
    } catch (caught) {
      if (active()) root.textContent = caught.message;
    }
  }
  return { open, clear };
}
