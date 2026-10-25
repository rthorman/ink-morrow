import { recoverLocalDrafts } from './local-draft-recovery.js';
import { fieldComparison } from './field-comparison.js';
import { el, field, button, option } from './dom.js';
import { createPrivateDraft } from './private-drafts.js';
import { styleField, fourthWallField } from './influence.js';
import { qualityField } from './quality.js';
const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const title = (value) =>
  value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const presetTargets = {
  brief: 180,
  developed: 400,
  extended: 800,
  'legacy-short': 180,
};
export function createCreativeStudio({
  api,
  dialogs,
  getCurrent,
  getLive,
  runAction,
}) {
  const drafts = new Set();
  let serial = 0;
  function clear() {
    serial++;
    for (const draft of drafts) draft.close();
    drafts.clear();
  }
  async function open(kind = 'configuration', subject = null) {
    const story = getCurrent();
    if (!story) return;
    const live = getLive();
    const ticket = ++serial;
    const active = () =>
      live() && serial === ticket && getCurrent()?.id === story.id;
    const body = el('div', 'Opening story-local settings…');
    dialogs.openDialog({
      title: 'Story-local creative studio',
      body: [body],
      actions: [
        {
          label: 'Close',
          className: 'btn-secondary',
          onClick: (close) => close(true),
        },
      ],
    });
    try {
      let context = await api(`/fiction/${story.id}/creative`);
      if (!active()) return;
      const metadata =
        kind === 'configuration'
          ? null
          : await api('/fiction/catalog/metadata');
      if (!active()) return;
      let base;
      let parent;
      const key = kind + ':' + (subject || '');
      const takeContext = () => {
        base = copy(
          kind === 'configuration'
            ? context.settings
            : kind === 'character'
              ? context.references.characters.find(
                  (person) => person.character_id === subject,
                ).value
              : context.references[kind],
        );
        parent =
          kind === 'configuration'
            ? context.config_revision_id
            : context.reference_heads[key] || null;
      };
      takeContext();
      const fields = new Map();
      const controls = [];
      let source = null;
      let draft;
      let editVersion = 0;
      let busy = false;
      let sceneProposalId = base.scene_plan?.id || crypto.randomUUID();
      let draftComparisonNeeded = false;
      const status = el('p');
      status.setAttribute('role', 'status');
      const error = el('p', '', 'fiction-error');
      error.setAttribute('role', 'alert');
      const older = el('section');
      const recover = button('Recover an earlier private proposal…', () =>
        recoverLocalDrafts({
          api,
          gameId: story.id,
          kind,
          subject,
          root: older,
          active,
          onCopy: (content) => {
            populate(content.form);
            source = content.source || null;
            for (const [name, input] of selected)
              input.checked = content.selected_fields?.includes(name) || false;
            for (const input of bindings)
              input.checked =
                content.binding_fact_ids?.includes(input.value) || false;
            persist();
          },
        }),
      );
      const target = el('p', '', 'workspace-scope-note');
      const recovery = el('section', '', 'workspace-draft-state');
      const contents = el('div', '', 'fiction-studio-grid');
      const notice = el(
        'p',
        kind === 'configuration'
          ? 'These settings affect future telling. Length, pacing and reading layout are independent. Perspective does not assign you a character.'
          : 'This edits the story’s own reference. The reusable template and past prose stay intact. A motive, backstory or proposed direction does not establish that an event occurred.',
      );
      function add(name, label, type = 'input', options = {}) {
        const value = base[name] ?? '';
        const input = field(
          label,
          type,
          typeof value === 'string' ? value : '',
          options,
        );
        fields.set(name, input.control);
        contents.append(input.wrapper);
        return input;
      }
      let sceneEnabled = null;
      let present = [];
      let focusChecks = [];
      let templatePanel = null;
      const selected = new Map();
      let overlap = null;
      const bindings = [];
      if (kind === 'configuration') {
        const perspective = add(
          'perspective',
          'Narrative perspective',
          'select',
        );
        perspective.control.append(
          ...[
            ['flexible', 'Flexible · deliberate scene-boundary changes'],
            ['first-person', 'First person'],
            ['close-third', 'Close third'],
            ['omniscient', 'Omniscient · preserve knowledge boundaries'],
          ].map(([value, label]) => option(value, label)),
        );
        perspective.control.value = base.perspective;
        for (const [name, label] of [
          ['speaker_id', 'First-person cast speaker'],
          ['focal_id', 'Close-third focal character'],
        ]) {
          const input = add(name, label, 'select');
          input.control.append(
            option('', 'None'),
            ...context.cast.map((person) => option(person.id, person.name)),
          );
          input.control.value = base[name] || '';
        }
        add(
          'framing_narrator',
          'Or describe an outside framing narrator',
          'textarea',
          { maxLength: 1000, rows: 2 },
        );
        const tense = add('tense', 'Narrative tense', 'select');
        tense.control.append(
          option('past', 'Past'),
          option('present', 'Present'),
        );
        tense.control.value = base.tense;
        add('language', 'Prose language', 'input', { maxLength: 100 });
        const length = field('Passage length target', 'select');
        length.control.append(
          ...Object.keys(presetTargets).map((preset) =>
            option(preset, `${title(preset)} · about ${presetTargets[preset]}`),
          ),
          option('custom', 'Custom'),
        );
        length.control.value = base.length.preset;
        fields.set('length_preset', length.control);
        contents.append(length.wrapper);
        const amount = field(
          'Length target (50–2,000)',
          'input',
          String(base.length.target),
          { type: 'number', min: 50, max: 2000 },
        );
        fields.set('length_target', amount.control);
        contents.append(amount.wrapper);
        const unit = field('Length unit', 'select');
        unit.control.append(
          option('words', 'Approximate words'),
          option('characters', 'Approximate characters'),
        );
        unit.control.value = base.length.unit;
        fields.set('length_unit', unit.control);
        contents.append(unit.wrapper);
        length.control.addEventListener('change', () => {
          if (presetTargets[length.control.value])
            amount.control.value = presetTargets[length.control.value];
          persist();
        });
        amount.control.addEventListener('input', () => {
          length.control.value = 'custom';
        });
        const pacing = add('pacing', 'Pacing', 'select');
        pacing.control.append(
          option('reflective', 'Reflective'),
          option('balanced', 'Balanced'),
          option('brisk', 'Brisk'),
        );
        pacing.control.value = base.pacing;
        const consequences = add('consequences', 'Consequences', 'select');
        consequences.control.append(
          option('gentle', 'Gentle'),
          option('dramatic', 'Dramatic'),
        );
        consequences.control.value = base.consequences;
        const style = styleField(base.play_style);
        fields.set('play_style', style.control);
        contents.append(style.wrapper);
        const fourth = fourthWallField(style, base.fourth_wall);
        fields.set('fourth_wall', fourth.control);
        contents.append(fourth.wrapper);
        const quality = qualityField(base.quality_mode);
        fields.set('quality_mode', quality.control);
        contents.append(quality.wrapper);
        add('genre_description', 'Genre in your own words', 'textarea', {
          maxLength: 1000,
          rows: 2,
        });
        add('tone', 'Tone and atmosphere', 'textarea', {
          maxLength: 1000,
          rows: 2,
        });
        add('voice', 'Narration voice', 'textarea', {
          maxLength: 1500,
          rows: 3,
        });
        add('boundaries', 'Tone and boundaries', 'textarea', {
          maxLength: 2000,
          rows: 3,
        });
        add(
          'focus',
          'Keep attention on (clear to release a previous direction)',
          'textarea',
          { maxLength: 1500, rows: 2 },
        );
        const disclosure = add('disclosure', 'Knowledge disclosure', 'select');
        disclosure.control.append(
          option(
            'limited',
            'Limited · respect discovery and character knowledge',
          ),
          option('reader-known', 'Reader-known information only'),
        );
        disclosure.control.value = base.disclosure;
        const scene = el('fieldset', '', 'fiction-studio-section');
        scene.append(
          el('legend', 'Next-scene proposal'),
          el(
            'p',
            'A proposal is not an established location, time or cast transition. Saving buys no narration. A failed request keeps it available.',
          ),
        );
        sceneEnabled = field('Include a next-scene proposal', 'input', '', {
          type: 'checkbox',
          checked: Boolean(base.scene_plan),
        });
        scene.append(sceneEnabled.wrapper);
        for (const [name, label, max] of [
          ['location', 'Proposed location', 1000],
          ['time', 'Proposed time', 500],
          ['purpose', 'Purpose of the scene', 1000],
          ['notes', 'Other proposed circumstances', 2000],
        ]) {
          const input = field(
            label,
            'textarea',
            base.scene_plan?.[name] || '',
            { maxLength: max, rows: 2 },
          );
          fields.set('scene_' + name, input.control);
          scene.append(input.wrapper);
        }
        const cast = el('fieldset');
        cast.append(el('legend', 'Proposed cast presence'));
        for (const person of context.cast) {
          const input = field(person.name, 'input', person.id, {
            type: 'checkbox',
            checked: Boolean(base.scene_plan?.present_ids.includes(person.id)),
          });
          present.push(input.control);
          cast.append(input.wrapper);
        }
        scene.append(cast);
        contents.append(scene);
      } else {
        templatePanel = el('section', '', 'fiction-studio-section');
        templatePanel.append(
          el('h3', 'Compare a reusable template'),
          el(
            'p',
            'Load a template to compare it. Only checked fields are adopted into this story.',
          ),
        );
        const templates = field('Reusable template', 'select');
        templates.control.append(option('', 'Choose a template to compare'));
        templatePanel.append(templates.wrapper);
        const templateData = await api(`/fiction/catalog?kind=${kind}`);
        if (!active()) return;
        for (const entry of templateData.entries || [])
          templates.control.append(option(entry.id, entry.name));
        templates.control.addEventListener('change', async () => {
          if (!templates.control.value) return;
          try {
            const { entry } = await api(
              `/fiction/catalog/${templates.control.value}`,
            );
            if (!active()) return;
            const candidate = {
              name: entry.name,
              description: entry.description,
              data: entry.data,
            };
            templatePanel.querySelector('.fiction-field-comparison')?.remove();
            templatePanel.append(
              fieldComparison({
                fields: [
                  ...fields.keys(),
                  ...(kind === 'scribe' ? ['data.focus_areas'] : []),
                ],
                before: base,
                proposal: candidate,
                getCurrent: value,
                title: 'Template · current story · proposed fields',
                onApply: (next, keys) => {
                  source = {
                    template_id: entry.id,
                    template_revision: entry.revision,
                  };
                  populate(next);
                  for (const [name, input] of selected)
                    if (keys.includes(name)) input.checked = true;
                  persist();
                  status.textContent =
                    'Selected template fields copied into the private proposal. Apply selected fields is still a separate action.';
                },
              }),
            );
          } catch (caught) {
            if (active()) error.textContent = caught.message;
          }
        });
        add(
          'name',
          kind === 'character'
            ? 'Reference name · cast identity stays unchanged'
            : 'Reference name',
          'input',
          { maxLength: 200 },
        );
        add('description', 'Reader-visible description', 'textarea', {
          maxLength: 2000,
          rows: 3,
        });
        for (const [name, max] of Object.entries(metadata.fields[kind])) {
          const input = field(
            `${title(name)}${['lore', 'motive', 'background'].includes(name) ? ' · private' : ''}`,
            'textarea',
            base.data[name] || '',
            {
              maxLength: max,
              rows: ['lore', 'background'].includes(name) ? 4 : 2,
            },
          );
          fields.set('data.' + name, input.control);
          contents.append(input.wrapper);
        }
        if (kind === 'scribe') {
          contents.append(
            el('p', metadata.scribe.canon.definition),
            el(
              'p',
              'The Scribe is a craft persona, separate from the Storyteller model and any future read-aloud voice. Applying it never adds her to the cast.',
            ),
          );
          for (const [name, values] of Object.entries(metadata.scribe.enums)) {
            const input = field(title(name), 'select');
            input.control.append(
              ...values.map((value) => option(value, title(value))),
            );
            input.control.value = base.data[name];
            fields.set('data.' + name, input.control);
            contents.append(input.wrapper);
          }
          const focus = el('fieldset');
          focus.append(el('legend', 'Craft focus areas'));
          for (const name of metadata.scribe.focus_areas) {
            const input = field(title(name), 'input', name, {
              type: 'checkbox',
              checked: base.data.focus_areas.includes(name),
            });
            focusChecks.push(input.control);
            focus.append(input.wrapper);
          }
          contents.append(focus);
        }
        for (const [name, control] of fields) {
          const input = field(
            `Adopt ${title(name.replace('data.', ''))}`,
            'input',
            '',
            { type: 'checkbox' },
          );
          selected.set(name, input.control);
          control
            .closest('.fiction-field')
            .append(
              el(
                'p',
                `Current story value: ${typeof (name.startsWith('data.') ? base.data[name.slice(5)] : base[name]) === 'string' ? (name.startsWith('data.') ? base.data[name.slice(5)] : base[name]) : ''}`,
                'fiction-muted',
              ),
              input.wrapper,
            );
        }
        if (kind === 'scribe') {
          const input = field('Adopt craft focus areas', 'input', '', {
            type: 'checkbox',
          });
          selected.set('data.focus_areas', input.control);
          contents.append(input.wrapper);
        }
        const truths = el('details');
        truths.append(
          el('summary', 'Recorded facts take precedence over references'),
        );
        for (const fact of context.facts || []) {
          const bound = field(
            `Keep in narration context · ${fact.visibility === 'secret' ? 'Private · ' : ''}${fact.text}`,
            'input',
            fact.id,
            {
              type: 'checkbox',
              checked: Boolean(
                context.reference_bindings?.[key]?.includes(fact.id),
              ),
            },
          );
          bindings.push(bound.control);
          truths.append(bound.wrapper);
        }
        contents.append(truths);
        overlap = field(
          'Keep the reviewed recorded facts authoritative',
          'input',
          '',
          { type: 'checkbox' },
        );
        contents.append(overlap.wrapper);
      }
      function value() {
        if (kind === 'configuration') {
          const result = { ...copy(base) };
          for (const [name, control] of fields)
            if (!name.startsWith('scene_') && !name.startsWith('length_'))
              result[name] = ['speaker_id', 'focal_id'].includes(name)
                ? control.value || null
                : control.value;
          result.length = {
            preset: fields.get('length_preset').value,
            target: Number(fields.get('length_target').value),
            unit: fields.get('length_unit').value,
            definition_version: 1,
          };
          result.scene_plan = sceneEnabled.control.checked
            ? {
                id: sceneProposalId,
                location: fields.get('scene_location').value,
                time: fields.get('scene_time').value,
                present_ids: present
                  .filter((input) => input.checked)
                  .map((input) => input.value),
                purpose: fields.get('scene_purpose').value,
                notes: fields.get('scene_notes').value,
              }
            : null;
          if (
            result.scene_plan &&
            base.scene_plan &&
            same(
              { ...result.scene_plan, id: null },
              { ...base.scene_plan, id: null },
            )
          )
            result.scene_plan = base.scene_plan;
          return result;
        }
        const result = {
          name: fields.get('name').value,
          description: fields.get('description').value,
          data: { ...base.data },
        };
        for (const [name, control] of fields)
          if (name.startsWith('data.'))
            result.data[name.slice(5)] = control.value;
        if (kind === 'scribe') {
          result.data.entity_kind = 'catgirl';
          result.data.focus_areas = focusChecks
            .filter((input) => input.checked)
            .map((input) => input.value);
        }
        return result;
      }
      function populate(form) {
        if (kind === 'configuration') {
          if (form.scene_plan?.id) sceneProposalId = form.scene_plan.id;
          for (const [name, control] of fields)
            if (!name.startsWith('scene_') && !name.startsWith('length_'))
              control.value = form[name] ?? '';
          fields.get('length_preset').value = form.length.preset;
          fields.get('length_target').value = form.length.target;
          fields.get('length_unit').value = form.length.unit;
          sceneEnabled.control.checked = Boolean(form.scene_plan);
          for (const name of ['location', 'time', 'purpose', 'notes'])
            fields.get('scene_' + name).value = form.scene_plan?.[name] || '';
          for (const input of present)
            input.checked = Boolean(
              form.scene_plan?.present_ids.includes(input.value),
            );
        } else {
          fields.get('name').value = form.name || '';
          fields.get('description').value = form.description || '';
          for (const [name, control] of fields)
            if (name.startsWith('data.'))
              control.value = form.data?.[name.slice(5)] || '';
          for (const input of focusChecks)
            input.checked = Boolean(
              form.data?.focus_areas?.includes(input.value),
            );
        }
      }
      const stateValue = () => ({
        form: value(),
        ...(kind === 'configuration'
          ? {}
          : {
              binding_fact_ids: bindings
                .filter((input) => input.checked)
                .map((input) => input.value),
              selected_fields: [...selected]
                .filter(([, input]) => input.checked)
                .map(([name]) => name),
              source,
            }),
        base_revision: parent,
      });
      function persist() {
        editVersion++;
        draft?.edit(stateValue());
      }
      function setTarget() {
        target.textContent = `Apply to ${getCurrent()?.branches.find((path) => path.id === context.target_branch_id)?.name || 'active path'} at its reviewed latest moment. ${parent ? 'A story-local revision is active.' : 'Using the frozen or original baseline.'}`;
      }
      async function attachDraft(preserve = false) {
        const proposed = stateValue();
        draft = createPrivateDraft({
          api,
          onChange: (state) => {
            if (!active()) return;
            recovery.replaceChildren();
            if (!state) return;
            recovery.append(
              el('p', state.message),
              button('Save private draft now', () =>
                draft.flush().catch((caught) => {
                  error.textContent = caught.message;
                }),
              ),
              button('Copy private proposal', async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(state.local.form, null, 2),
                  );
                } catch {
                  recovery.append(
                    field(
                      'Select and copy private proposal',
                      'textarea',
                      JSON.stringify(state.local.form, null, 2),
                      { readOnly: true },
                    ).wrapper,
                  );
                }
              }),
            );
            if (state.row?.submitted)
              recovery.append(
                button('Review previous local change', reviewPrevious),
              );
            if (state.conflict) {
              recovery.append(
                field(
                  'Local proposal',
                  'textarea',
                  JSON.stringify(state.local.form, null, 2),
                  { readOnly: true },
                ).wrapper,
                field(
                  'Saved proposal',
                  'textarea',
                  JSON.stringify(state.conflict.content.form, null, 2),
                  { readOnly: true },
                ).wrapper,
              );
              for (const [label, server] of [
                ['Use saved proposal', true],
                ['Keep compared local proposal', false],
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
        const initial = editVersion;
        const restored = await draft.open(
          {
            type: 'local-reference',
            game_id: story.id,
            branch_id: context.target_branch_id,
            head_id: context.expected_head_beat_id,
            kind,
            subject_id: subject,
            base_revision: parent,
          },
          stateValue(),
        );
        if (
          active() &&
          preserve &&
          restored &&
          !same(restored.form, proposed.form)
        ) {
          draftComparisonNeeded = true;
          recovery.append(
            field(
              'Existing saved proposal at this destination',
              'textarea',
              JSON.stringify(restored.form, null, 2),
              { readOnly: true },
            ).wrapper,
            button('Keep my proposal after comparing this saved draft', () => {
              draftComparisonNeeded = false;
              populate(proposed.form);
              draft.edit(proposed);
            }),
          );
          return;
        }
        if (active() && restored && initial === editVersion) {
          populate(restored.form);
          source = restored.source || null;
          for (const input of bindings)
            input.checked = Boolean(
              restored.binding_fact_ids?.includes(input.value),
            );
          for (const [name, input] of selected)
            input.checked = restored.selected_fields?.includes(name) || false;
        }
      }
      async function refreshTarget() {
        const proposed = value();
        const fresh = await api(`/fiction/${story.id}/creative`);
        if (!active()) return;
        const comparison = field(
          'Current latest settings or reference',
          'textarea',
          JSON.stringify(
            kind === 'configuration'
              ? fresh.settings
              : kind === 'character'
                ? fresh.references.characters.find(
                    (person) => person.character_id === subject,
                  )?.value
                : fresh.references[kind],
            null,
            2,
          ),
          { readOnly: true },
        );
        recovery.append(
          comparison.wrapper,
          button(
            'Keep my proposal at this compared latest destination',
            async () => {
              context = fresh;
              takeContext();
              populate(proposed);
              setTarget();
              await attachDraft(true);
              if (!draftComparisonNeeded) draft.edit(stateValue());
              error.textContent =
                'Destination refreshed after comparison. Review the selected fields and apply explicitly.';
            },
          ),
        );
      }
      async function reviewPrevious() {
        const row = draft.state?.row;
        if (!row?.submitted) return;
        try {
          const key = row.submitted.action_key;
          const result = await api(`/fiction/${story.id}/commands/${key}`);
          if (!active()) return;
          recovery.append(
            el(
              'p',
              `Previous local change: ${result.status}. Checking never repeats it.`,
            ),
          );
          if (result.can_start_new)
            recovery.append(
              button(
                'Acknowledge and review the latest destination',
                async () => {
                  await draft.clearSubmission();
                  await refreshTarget();
                },
              ),
            );
          else
            recovery.append(
              button('Cancel if not dispatched', async () => {
                const status = await api(
                  `/fiction/${story.id}/commands/${key}/cancel`,
                  'POST',
                  {},
                );
                if (active())
                  recovery.append(
                    el(
                      'p',
                      `Change is now ${status.status}. Check again before another local change.`,
                    ),
                  );
              }),
            );
        } catch (caught) {
          if (active()) error.textContent = caught.message;
        }
      }
      const show = () =>
        dialogs.openDialog({
          title:
            kind === 'configuration'
              ? 'Creative settings & next scene'
              : `Story-local ${kind === 'scribe' ? 'Scribe' : kind}`,
          variant: 'studio',
          body: [
            notice,
            target,
            button('Review latest destination', () =>
              refreshTarget().catch((caught) => {
                if (active()) error.textContent = caught.message;
              }),
            ),
            ...(templatePanel ? [templatePanel] : []),
            contents,
            recovery,
            recover,
            older,
            status,
            error,
          ],
          dirty: () => Boolean(draft?.state?.dirty),
          actions: [
            {
              label: 'Close',
              className: 'btn-secondary',
              onClick: (close) => close(),
            },
            {
              label:
                kind === 'configuration'
                  ? 'Save preferences'
                  : 'Apply selected fields',
              className: 'btn-primary',
              pendingLabel: 'Saving…',
              onClick: async (close) => {
                if (busy || !active()) return;
                busy = true;
                error.textContent = '';
                const version = editVersion;
                try {
                  if (draftComparisonNeeded)
                    throw Error(
                      'Compare the existing saved draft at this destination before replacing it.',
                    );
                  if (getCurrent().revision !== context.revision)
                    throw Error(
                      'The story changed. Review the latest destination before applying.',
                    );
                  if (kind === 'configuration' && same(value(), base))
                    throw Error('Change a setting before saving.');
                  if (
                    kind !== 'configuration' &&
                    ![...selected.values()].some((input) => input.checked) &&
                    same(
                      bindings
                        .filter((input) => input.checked)
                        .map((input) => input.value),
                      context.reference_bindings?.[key] || [],
                    )
                  )
                    throw Error(
                      'Select reference fields or change recorded fact bindings before applying.',
                    );
                  persist();
                  const row = await draft.flush();
                  if (!active()) return;
                  if (editVersion !== version + 1)
                    throw Error(
                      'Your fields changed while saving the proposal. Review them and apply again.',
                    );
                  const submitted = await draft.submit({
                    game_id: story.id,
                    branch_id: context.target_branch_id,
                    head_beat_id: context.expected_head_beat_id,
                    revision: context.revision,
                    purpose: 'story-local-command',
                  });
                  if (!active()) return;
                  if (editVersion !== version + 1)
                    throw Error(
                      'Your fields changed before dispatch. Review the prepared local change before trying again.',
                    );
                  const frozen = {
                    action_key: submitted.actionKey,
                    expected_revision: context.revision,
                    target_branch_id: context.target_branch_id,
                    expected_head_beat_id: context.expected_head_beat_id,
                  };
                  let payload;
                  let path;
                  if (kind === 'configuration') {
                    const proposed = row.content.form;
                    const patch = Object.fromEntries(
                      Object.keys(proposed)
                        .filter((name) => !same(proposed[name], base[name]))
                        .map((name) => [name, proposed[name]]),
                    );
                    payload = { ...frozen, expected_config_id: parent, patch };
                    path = 'configuration';
                  } else {
                    payload = {
                      ...frozen,
                      kind,
                      subject_id: subject,
                      expected_reference_id: parent,
                      proposed: row.content.form,
                      selected_fields: row.content.selected_fields,
                      binding_fact_ids: row.content.binding_fact_ids,
                      acknowledge_overlaps: overlap.control.checked,
                      ...(source ? { source } : {}),
                    };
                    path = 'references';
                  }
                  const result = await runAction(() =>
                    api(
                      `/fiction/${story.id}/commands/${path}`,
                      'POST',
                      payload,
                    ),
                  );
                  if (!active()) return;
                  if (!result?.ok) {
                    error.textContent =
                      result?.error ||
                      'The proposal was not applied. Your fields remain available.';
                    return;
                  }
                  if (editVersion <= version + 1 && !draft.state?.dirty) {
                    await draft.discard();
                    draft.close();
                    drafts.delete(draft);
                    close(true);
                  } else
                    status.textContent =
                      'The reviewed change was saved. Newer edits remain a private proposal; review the latest destination before applying them.';
                } catch (caught) {
                  if (active()) error.textContent = caught.message;
                } finally {
                  busy = false;
                }
              },
            },
          ],
        });
      for (const control of fields.values()) controls.push(control);
      controls.push(
        ...bindings,
        ...present,
        ...focusChecks,
        ...[...selected.values()],
      );
      if (sceneEnabled) controls.push(sceneEnabled.control);
      for (const control of controls)
        control.addEventListener('input', persist);
      setTarget();
      show();
      await attachDraft();
    } catch (caught) {
      if (active()) body.textContent = caught.message;
    }
  }
  return { open, clear };
}
