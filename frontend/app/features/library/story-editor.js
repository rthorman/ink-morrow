// Story editor: the Write-desk creation/cast builder plus the mid-story cast
// editor opened from Library. It edits roles, relations, and in-story state
// copies exactly as the tale has them (never the base sheets).

const CAST_EDIT_FIELDS = [
  { key: 'personality', label: 'In-story personality' },
  { key: 'appearance', label: 'In-story appearance' },
  { key: 'relationship_to_mc', label: 'Relationship to the Main Character', mc: false },
];

import { wireModal } from '../../core/dialogs.js';
import { approxCostText } from '../../core/cost.js';
import { IMAGE_COST_ESTIMATE } from '../../components/entity-card.js';

const STORY_COVER_ESTIMATE = IMAGE_COST_ESTIMATE.story;

export function createStoryEditor({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess, scribeErrorMessage } = notify;

  // Creation builder state: an explicit cast shape - centered on one lead,
  // or an ensemble - then members one at a time with starting connections.
  let storyCast = []; // [{id, role, relation}]
  let castMode = 'ensemble'; // 'centered' | 'ensemble'
  let coverReviewing = false;

  // Mid-story editor state.
  let castEdit = null; // { storyId, title, worldId, entries: [{id, role, relation, state}] }

  function leadEntry() {
    return storyCast.find((entry) => entry.role === 'mc') || null;
  }

  function leadName() {
    const lead = leadEntry();
    if (!lead) return null;
    const character = castCharacterById(lead.id);
    return character ? character.name : 'the lead';
  }

  function setCastMode(mode) {
    castMode = mode;
    const lead = leadEntry();
    if (mode === 'ensemble' && lead) {
      // Switching to ensemble removes the lead role only - the character stays.
      lead.role = 'supporting';
    }
    renderCastBuilder();
  }

  function castOrderedCharacters() {
    const storyWorld = document.getElementById('storyWorld')?.value || '';
    return [
      ...state.data.characters.filter((c) => c.world_id === storyWorld),
      ...state.data.characters.filter((c) => c.world_id !== storyWorld),
    ];
  }

  function castCharacterById(id) {
    return state.data.characters.find((c) => c.id === id) || null;
  }

  function populateSelectOptions(select, options, { placeholder = null } = {}) {
    select.textContent = '';
    if (placeholder !== null) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.appendChild(option);
    }
    const storyWorld = document.getElementById('storyWorld')?.value || '';
    options.forEach((character) => {
      const option = document.createElement('option');
      option.value = character.id;
      const otherWorld = Boolean(storyWorld) && Boolean(character.world_id) && character.world_id !== storyWorld;
      option.textContent = character.name + (otherWorld ? ' (other world)' : '');
      select.appendChild(option);
    });
  }

  function renderCastBuilder({ resetAddDraft = false } = {}) {
    const mcSelect = document.getElementById('mcSelect');
    const charSelect = document.getElementById('castCharSelect');
    const list = document.getElementById('castList');
    if (!mcSelect || !charSelect || !list) return;

    // Character portraits are polled while they are being painted. Each poll
    // reloads the catalogue and therefore re-renders this builder. Preserve
    // the member the writer is in the middle of adding; only a successful Add
    // (or successful story creation) deliberately clears this little draft.
    const relationInput = document.getElementById('castRelation');
    const tierSelect = document.getElementById('castTierSelect');
    const addBtn = document.getElementById('castAddBtn');
    const addDraft = {
      id: charSelect.value,
      role: tierSelect?.value || 'supporting',
      relation: relationInput?.value || '',
    };

    // Cast-shape choice drives everything else.
    const centeredBtn = document.getElementById('castModeCentered');
    const ensembleBtn = document.getElementById('castModeEnsemble');
    const leadRow = document.getElementById('castLeadRow');
    const hint = document.getElementById('castModeHint');
    const relationLabel = document.getElementById('castRelationLabel');
    const effectiveMode = leadEntry() ? 'centered' : castMode;
    if (centeredBtn && ensembleBtn) {
      centeredBtn.setAttribute('aria-checked', String(effectiveMode === 'centered'));
      ensembleBtn.setAttribute('aria-checked', String(effectiveMode === 'ensemble'));
      centeredBtn.classList.toggle('active', effectiveMode === 'centered');
      ensembleBtn.classList.toggle('active', effectiveMode === 'ensemble');
    }
    if (leadRow) leadRow.hidden = effectiveMode !== 'centered' || Boolean(leadEntry());
    if (hint) {
      hint.textContent = effectiveMode === 'centered'
        ? 'The scribe prioritizes the lead\u2019s voice, goals, and perception.'
        : 'No lead character. Direction and scene determine focus — no throne at this table.';
    }
    if (relationLabel) {
      const lead = leadName();
      relationLabel.textContent = lead ? `Tie to ${lead} (starting point; the story may change it)` : 'Starting connection or story note';
    }

    const chosenIds = new Set(storyCast.map((entry) => entry.id));
    const available = castOrderedCharacters().filter((c) => !chosenIds.has(c.id));
    const currentLead = leadEntry();

    // Lead picker (centered mode, no lead chosen yet): direct selection.
    const mcOptions = currentLead ? [] : available;
    populateSelectOptions(mcSelect, mcOptions, {
      placeholder: available.length > 0 ? '— Choose who the story follows —' : '— No characters available —',
    });
    mcSelect.disabled = Boolean(currentLead) || available.length === 0;

    // Member picker: everyone not yet cast (the lead included in the pool).
    populateSelectOptions(charSelect, available, {
      placeholder: available.length > 0 ? '— Choose a character —' : '— Everyone is already cast —',
    });
    charSelect.disabled = available.length === 0;

    if (addBtn) addBtn.disabled = available.length === 0;
    if (!resetAddDraft && available.some((character) => character.id === addDraft.id)) {
      charSelect.value = addDraft.id;
    }
    if (relationInput) relationInput.value = resetAddDraft ? '' : addDraft.relation;
    if (tierSelect) {
      tierSelect.value = resetAddDraft || !['supporting', 'background'].includes(addDraft.role)
        ? 'supporting'
        : addDraft.role;
    }

    // Cast list: rows with editable connection + removal.
    list.textContent = '';
    if (storyCast.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent =
        castMode === 'centered'
          ? 'No cast yet. Choose the lead above, or add anyone and let the scribe write an ensemble.'
          : 'No cast yet. Add anyone below — or start with an empty ensemble and cast mid-story.';
      list.appendChild(empty);
    }
    storyCast.forEach((entry) => {
      const character = castCharacterById(entry.id);
      const row = document.createElement('div');
      row.className = 'cast-list__row' + (entry.role === 'mc' ? ' cast-list__row--mc' : '');

      const name = document.createElement('span');
      name.className = 'cast-list__name';
      name.textContent = character ? character.name : entry.id;

      const role = document.createElement('span');
      role.className = `cast-list__role cast-list__role--${entry.role}`;
      role.textContent = entry.role === 'mc' ? 'Lead' : entry.role === 'supporting' ? 'Supporting' : 'Background';

      row.append(name, role);

      if (entry.role !== 'mc') {
        const relation = document.createElement('input');
        relation.type = 'text';
        relation.className = 'cast-list__relation';
        relation.maxLength = 2000;
        relation.value = entry.relation || '';
        const lead = leadName();
        relation.setAttribute('aria-label', lead ? `Tie of ${character ? character.name : entry.id} to ${lead}` : `Starting connection for ${character ? character.name : entry.id}`);
        relation.placeholder = lead ? `tie to ${lead}…` : 'starting connection or story note…';
        relation.addEventListener('input', () => {
          entry.relation = relation.value.trim() || null;
        });
        row.appendChild(relation);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cast-list__remove';
      remove.textContent = entry.role === 'mc' ? '✕ Replace lead' : '✕ Remove';
      remove.setAttribute('aria-label', `Remove ${character ? character.name : entry.id} from the cast`);
      remove.addEventListener('click', () => {
        storyCast = storyCast.filter((e) => e.id !== entry.id);
        renderCastBuilder();
      });
      row.appendChild(remove);
      list.appendChild(row);
    });

    renderStoryReview();
  }

  // The review line: what will actually be created, in plain words.
  function renderStoryReview() {
    const review = document.getElementById('storyReview');
    if (!review) return;
    const worldSelect = document.getElementById('storyWorld');
    const world = worldSelect ? state.data.worlds.find((w) => w.id === worldSelect.value) : null;
    const lead = leadName();
    const parts = [
      world ? `World: ${world.name}` : 'Unbound world',
      lead ? `Centered on ${lead}` : 'Ensemble',
      `${storyCast.length} cast member${storyCast.length === 1 ? '' : 's'}`,
    ];
    review.textContent = parts.join(' · ');
  }

  function addCastMember() {
    const charSelect = document.getElementById('castCharSelect');
    if (!charSelect || !charSelect.value) return;
    const tierSelect = document.getElementById('castTierSelect');
    const relationInput = document.getElementById('castRelation');
    const role = tierSelect && tierSelect.value === 'background' ? 'background' : 'supporting';
    const relation = relationInput && relationInput.value.trim() ? relationInput.value.trim() : null;
    storyCast.push({ id: charSelect.value, role, relation });
    renderCastBuilder({ resetAddDraft: true });
  }

  function chooseMainCharacter() {
    const mcSelect = document.getElementById('mcSelect');
    if (!mcSelect || !mcSelect.value) return;
    storyCast = [{ id: mcSelect.value, role: 'mc', relation: null }, ...storyCast.filter((e) => e.role !== 'mc' && e.id !== mcSelect.value)];
    renderCastBuilder();
  }

  async function handleStorySubmit(event) {
    event.preventDefault();
    const form = event.target;
    const withCover = event.submitter?.id === 'storyWithCoverBtn';
    if (withCover) {
      if (coverReviewing) return;
      coverReviewing = true;
      const yes = await dialogs.confirmPaid({
        title: 'Create this story and paint its cover?',
        review: {
          action: 'Create the story, then paint a vertical cover in the background.',
          object: `story "${document.getElementById('storyTitle').value.trim() || '(untitled)'}"`,
          quantity: 'one 1K cover painting',
          sends: 'the title, maturity level, world description, cast appearance details, and available reference paintings',
          estimate: STORY_COVER_ESTIMATE,
          note: '"Create without cover" binds the same story without sending an image request.',
        },
        confirmLabel: `Create & paint (${approxCostText(STORY_COVER_ESTIMATE)})`,
      });
      coverReviewing = false;
      if (!yes) return;
    }
    // A Main Character is optional: with one, the scribe keeps the tale
    // centered on them; without one, she writes an ensemble that follows
    // wherever the writer's directions point.
    const cast = storyCast.map((entry) => ({ ...entry, state: null }));
    try {
      const data = await apiCall('/stories', 'POST', {
        generate_image: withCover,
        title: document.getElementById('storyTitle').value,
        world_id: document.getElementById('storyWorld').value || null,
        tone: document.getElementById('storyTone').value,
        characters: cast,
      });
      form.reset();
      storyCast = [];
      renderCastBuilder({ resetAddDraft: true });
      document.getElementById('storyTone').value = 'fade-to-black';
      // The tale exists now; fold the creation desk before opening it.
      closeCreator();
      await features.stories.loadStories();
      features.write.openStory(data.story.id);
      showSuccess(withCover ? 'Story created — the cover is being painted.' : 'Story created.');
    } catch (error) {
      showError(error.message);
    }
  }

  // -- mid-story cast editor (roster/details) ----------------------------------
  // A high-value workflow, not a secondary pile of textareas: roster left,
  // selected member's sheet right, dirty state guarded, focus stable.

  let castEditSelected = null; // member id whose detail sheet is open
  let castEditSnapshot = null; // entries as loaded; drift means "dirty"
  let castEditSaved = false; // last save result for the status line
  let storyCastModal = null; // wired lifecycle controller

  function castEditCharacter(id) {
    return state.data.characters.find((c) => c.id === id) || null;
  }

  function castEditLead() {
    return castEdit ? castEdit.entries.find((e) => e.role === 'mc') || null : null;
  }

  function castEditLeadName() {
    const lead = castEditLead();
    if (!lead) return null;
    const character = castEditCharacter(lead.id);
    return character ? character.name : 'the lead';
  }

  function castEditDirty() {
    return Boolean(castEdit && castEditSnapshot &&
      JSON.stringify(castEdit.entries) !== JSON.stringify(castEditSnapshot));
  }

  async function openStoryCastEditor(story) {
    const modal = document.getElementById('storyCastModal');
    if (!modal) return;
    try {
      // Fresh truth: generation may have evolved the sheets since the list loaded
      const data = await apiCall(`/stories/${story.id}`);
      const fresh = data.story;
      castEdit = {
        storyId: fresh.id,
        title: fresh.title,
        worldId: fresh.world_id,
        entries: (fresh.characters || []).map((e) => ({
          id: e.id,
          role: e.role,
          relation: e.relation ?? null,
          state: e.state && typeof e.state === 'object' && !Array.isArray(e.state) ? { ...e.state } : null,
        })),
      };
      castEditSnapshot = JSON.parse(JSON.stringify(castEdit.entries));
      castEditSaved = false;
      castEditSelected = castEdit.entries.length > 0 ? castEdit.entries[0].id : null;
      renderStoryCastEditor();
      storyCastModal?.open(); // wired lifecycle: focus entry, scroll lock, opener
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  function closeStoryCastEditor() {
    storyCastModal?.close(); // restores the opener, unlocks the document
    castEdit = null;
    castEditSnapshot = null;
    castEditSelected = null;
  }

  // Closing a dirty editor asks before discarding - Cancel, Escape, backdrop.
  function requestCloseStoryCastEditor() {
    if (!castEditDirty()) return closeStoryCastEditor();
    dialogs
      .confirmDestructive({
        title: 'Discard cast changes?',
        body: 'Your edits to this cast have not been saved.',
        confirmLabel: 'Discard changes',
      })
      .then((yes) => {
        if (yes) closeStoryCastEditor();
      });
  }

  function castEditStatus() {
    const status = document.getElementById('storyCastStatus');
    if (!status) return;
    if (castEditSaved) status.textContent = 'Saved.';
    else status.textContent = castEditDirty() ? 'Unsaved changes' : '';
  }

  function renderStoryCastEditor() {
    const list = document.getElementById('storyCastList');
    const detail = document.getElementById('storyCastDetail');
    const modeEl = document.getElementById('storyCastMode');
    const note = document.getElementById('storyCastNote');
    if (!list || !detail || !castEdit) return;

    // Header: title, cast shape, dirty/saved status
    if (modeEl) {
      const lead = castEditLeadName();
      modeEl.textContent = lead ? `Centered on ${lead}` : 'Ensemble — direction and scene determine focus';
    }
    castEditStatus();

    // Roster: one row per member; selecting opens the detail sheet.
    list.textContent = '';
    if (castEdit.entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      // Never ask for a lead unless centered mode is active; an empty
      // ensemble is a valid tale.
      empty.textContent = 'No cast. Add anyone below — a Lead, Supporting, or Background — or keep the tale an empty ensemble.';
      list.appendChild(empty);
    }
    for (const entry of castEdit.entries) {
      const character = castEditCharacter(entry.id);
      const name = character ? character.name : entry.id;
      const row = document.createElement('div');
      row.className = 'cast-edit-member__row' + (entry.id === castEditSelected ? ' cast-edit-member__row--selected' : '');
      row.setAttribute('role', 'listitem');

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'cast-edit-member__select';
      selectBtn.textContent = name + (entry.role === 'mc' ? ' — Lead' : '');
      selectBtn.setAttribute('aria-current', entry.id === castEditSelected ? 'true' : 'false');
      selectBtn.addEventListener('click', () => {
        castEditSelected = entry.id;
        renderStoryCastEditor();
      });
      row.appendChild(selectBtn);

      const roleLabel = document.createElement('span');
      roleLabel.className = 'cast-edit-member__rolelabel';
      roleLabel.textContent = entry.role === 'mc' ? 'Lead' : entry.role === 'supporting' ? 'Supporting' : 'Background';
      row.appendChild(roleLabel);

      if (character && character.world_id && castEdit.worldId && character.world_id !== castEdit.worldId) {
        const otherWorld = document.createElement('span');
        otherWorld.className = 'cast-edit-member__provenance';
        otherWorld.textContent = 'other world';
        row.appendChild(otherWorld);
      }
      if (entry.state && Object.keys(entry.state).length > 0) {
        const modified = document.createElement('span');
        modified.className = 'cast-edit-member__modified';
        modified.textContent = 'changed by the story';
        row.appendChild(modified);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cast-list__remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove ${name} from the cast`);
      remove.addEventListener('click', () => {
        castEdit.entries = castEdit.entries.filter((e) => e.id !== entry.id);
        if (castEditSelected === entry.id) castEditSelected = castEdit.entries.length > 0 ? castEdit.entries[0].id : null;
        renderStoryCastEditor();
      });
      row.appendChild(remove);
      list.appendChild(row);
    }

    // The add row: everyone not yet cast, the story's own world first.
    const addSelect = document.getElementById('storyCastAddSelect');
    const addBtn = document.getElementById('storyCastAddBtn');
    if (addSelect) {
      const chosen = new Set(castEdit.entries.map((e) => e.id));
      const available = [
        ...state.data.characters.filter((c) => c.world_id === castEdit.worldId),
        ...state.data.characters.filter((c) => c.world_id !== castEdit.worldId),
      ].filter((c) => !chosen.has(c.id));
      addSelect.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = available.length ? '— Choose a character —' : '— Everyone is already cast —';
      addSelect.appendChild(placeholder);
      available.forEach((c) => {
        const option = document.createElement('option');
        option.value = c.id;
        const otherWorld = Boolean(c.world_id) && c.world_id !== castEdit.worldId;
        option.textContent = c.name + (otherWorld ? ' (other world)' : '');
        addSelect.appendChild(option);
      });
      addSelect.disabled = available.length === 0;
      if (addBtn) addBtn.disabled = available.length === 0;
      const relation = document.getElementById('storyCastAddRelation');
      if (relation) relation.value = '';
      const roleSelect = document.getElementById('storyCastAddRole');
      if (roleSelect) {
        roleSelect.value = 'supporting';
        // A lead can be added directly when none exists - never force
        // add-then-promote.
        const leadOption = roleSelect.querySelector('option[value="mc"]');
        if (leadOption) leadOption.disabled = Boolean(castEditLead());
        roleSelect.value = 'supporting';
      }
    }

    renderCastEditDetail();

    if (note) {
      const hasMc = Boolean(castEditLead());
      note.hidden = hasMc || castEdit.entries.length === 0;
      if (!note.hidden) note.textContent = 'No lead — the scribe writes an ensemble. Promote anyone to Lead from their sheet.';
    }
  }

  // The selected member's detail sheet. Role changes update the entry and
  // the roster WITHOUT rebuilding this pane, so focus and drafts stay put.
  function renderCastEditDetail() {
    const detail = document.getElementById('storyCastDetail');
    if (!detail || !castEdit) return;
    // Role changes re-render this pane; the focused control and cursor
    // position survive by index (values are bound to the entry itself).
    const controls = () => [...detail.querySelectorAll('input, textarea, select')];
    const activeBefore = document.activeElement;
    const focusIdx = activeBefore && detail.contains(activeBefore) ? controls().indexOf(activeBefore) : -1;
    detail.textContent = '';
    const entry = castEdit.entries.find((e) => e.id === castEditSelected);
    if (!entry) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = castEdit.entries.length === 0 ? 'Select a member to edit their sheet.' : 'Select a member from the roster.';
      detail.appendChild(empty);
      return;
    }
    const character = castEditCharacter(entry.id);
    const name = character ? character.name : entry.id;

    const head = document.createElement('div');
    head.className = 'cast-edit-detail__head';
    const title = document.createElement('h3');
    title.textContent = name;
    head.appendChild(title);

    // Direct shape actions on this member.
    const actions = document.createElement('div');
    actions.className = 'cast-edit-detail__actions';
    if (entry.role !== 'mc') {
      const makeLead = document.createElement('button');
      makeLead.type = 'button';
      makeLead.className = 'btn btn-secondary';
      makeLead.textContent = 'Make lead';
      makeLead.title = 'This character becomes the lead; the current lead moves to Supporting.';
      makeLead.addEventListener('click', () => {
        const oldLead = castEditLead();
        if (oldLead) oldLead.role = 'supporting';
        entry.role = 'mc';
        castEditSaved = false;
        renderStoryCastEditor();
      });
      actions.appendChild(makeLead);
    } else {
      const toEnsemble = document.createElement('button');
      toEnsemble.type = 'button';
      toEnsemble.className = 'btn btn-secondary';
      toEnsemble.textContent = 'Switch to ensemble';
      toEnsemble.title = 'Removes the lead role; the character stays in the cast.';
      toEnsemble.addEventListener('click', () => {
        dialogs
          .openDialog({
            title: 'Switch to ensemble?',
            body: 'No lead character. Direction and scene determine focus — the scribe follows wherever the writing points. The character stays in the cast.',
            actions: [
              { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
              {
                label: 'Switch to ensemble',
                className: 'btn-primary',
                onClick: (close) => {
                  entry.role = 'supporting';
                  castEditSaved = false;
                  close(true);
                  renderStoryCastEditor();
                },
              },
            ],
          });
      });
      actions.appendChild(toEnsemble);
    }
    head.appendChild(actions);
    detail.appendChild(head);

    // Role
    const roleLabel = document.createElement('label');
    roleLabel.textContent = 'Role';
    const role = document.createElement('select');
    for (const value of ['mc', 'supporting', 'background']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'mc' ? 'Lead' : value === 'supporting' ? 'Supporting' : 'Background';
      role.appendChild(option);
    }
    role.value = entry.role;
    // A second lead demotes the current one - the scribe follows one lead.
    role.addEventListener('change', () => {
      entry.role = role.value;
      if (role.value === 'mc') {
        for (const other of castEdit.entries) if (other.id !== entry.id && other.role === 'mc') other.role = 'supporting';
      }
      castEditSaved = false;
      // Roster + header only; this pane keeps focus and drafts.
      renderStoryCastEditor();
    });
    detail.append(roleLabel, role);

    // Starting connection (lead has none: nothing to tie to)
    if (entry.role !== 'mc') {
      const relationLabel = document.createElement('label');
      const lead = castEditLeadName();
      relationLabel.textContent = lead ? `Tie to ${lead} at the start` : 'Starting connection or story note';
      const relation = document.createElement('input');
      relation.type = 'text';
      relation.maxLength = 2000;
      relation.value = entry.relation || '';
      relation.placeholder = lead ? `tie to ${lead}…` : 'starting connection…';
      relation.addEventListener('input', () => {
        entry.relation = relation.value.trim() || null;
        castEditSaved = false;
        castEditStatus();
      });
      detail.append(relationLabel, relation);
    }

    // The in-story sheet, exactly as the tale has it. Empty = inherited from
    // the base sheet (shown as the placeholder).
    const sheet = document.createElement('div');
    sheet.className = 'cast-edit-member__sheet';
    for (const field of CAST_EDIT_FIELDS) {
      if (field.mc === false && entry.role === 'mc') continue;
      const label = document.createElement('label');
      const lead = castEditLeadName();
      label.textContent = field.mc === false && lead ? `In-story ${field.key.replace('_', ' ')} (vs. ${lead})` : field.label;
      const input = document.createElement('textarea');
      input.rows = 2;
      input.maxLength = 2000;
      input.value = entry.state?.[field.key] || '';
      const base = character?.[field.key] ? `base: ${String(character[field.key]).slice(0, 120)}` : 'base sheet is empty here';
      input.placeholder = base;
      input.setAttribute('aria-label', `${field.label} of ${name} in this story`);
      input.addEventListener('input', () => {
        const value = input.value.trim();
        if (!entry.state) entry.state = {};
        if (value) entry.state[field.key] = value;
        else delete entry.state[field.key];
        castEditSaved = false;
        castEditStatus();
      });
      sheet.append(label, input);
    }
    detail.appendChild(sheet);

    if (focusIdx >= 0) {
      const el = controls()[focusIdx];
      if (el) {
        el.focus();
        if (el.setSelectionRange && typeof el.value === 'string' && el.value) {
          try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not a text control */ }
        }
      }
    }
  }

  function addCastEditorMember() {
    if (!castEdit) return;
    const addSelect = document.getElementById('storyCastAddSelect');
    if (!addSelect || !addSelect.value) return;
    const roleSelect = document.getElementById('storyCastAddRole');
    const relationInput = document.getElementById('storyCastAddRelation');
    let role = 'supporting';
    if (roleSelect) {
      if (roleSelect.value === 'background') role = 'background';
      // Direct lead add when none exists (option disabled otherwise).
      if (roleSelect.value === 'mc' && !castEditLead()) role = 'mc';
    }
    const relation = relationInput && relationInput.value.trim() ? relationInput.value.trim() : null;
    const entry = { id: addSelect.value, role, relation, state: null };
    castEdit.entries.push(entry);
    castEditSelected = entry.id; // open the fresh member's sheet
    castEditSaved = false;
    renderStoryCastEditor();
  }

  async function saveStoryCastEditor() {
    if (!castEdit) return;
    const btn = document.getElementById('storyCastSaveBtn');
    const storyId = castEdit.storyId;
    const title = castEdit.title;
    const entries = castEdit.entries;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    try {
      await apiCall(`/stories/${storyId}`, 'PUT', { characters: entries });
      closeStoryCastEditor();
      await features.stories.loadStories();
      // An open reader keeps its pages; only the cast (and totals) moved
      if (state.data.currentStory && state.data.currentStory.id === storyId) {
        state.data.currentStory = state.data.stories.find((s) => s.id === storyId) || state.data.currentStory;
        state.resetStoryCost();
      }
      showSuccess(`The cast of "${title}" is bound.`);
    } catch (error) {
      showError(scribeErrorMessage(error.message)); // floats above the modal
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save cast';
      }
    }
  }

  function init() {
    document.getElementById('storyForm').addEventListener('submit', handleStorySubmit);
    // Story creation lives at the writing desk. Keep its disclosure behavior
    // with the editor rather than making Library own a control on another route.
    const newStoryBtn = document.getElementById('storyNewBtn');
    if (newStoryBtn) {
      newStoryBtn.addEventListener('click', () => {
        const wrap = document.getElementById('storyCreateWrap');
        const opening = wrap.hidden;
        wrap.hidden = !opening;
        newStoryBtn.setAttribute('aria-expanded', String(opening));
        if (opening) document.getElementById('storyTitle').focus();
        else wrap.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
    }
    document.getElementById('storyWorld').addEventListener('change', () => {
      renderCastBuilder();
      renderStoryReview();
    });
    document.getElementById('storyTitle').addEventListener('input', renderStoryReview);
    const mcSelect = document.getElementById('mcSelect');
    if (mcSelect) mcSelect.addEventListener('change', () => { if (mcSelect.value) chooseMainCharacter(); });
    const castAddBtn = document.getElementById('castAddBtn');
    if (castAddBtn) castAddBtn.addEventListener('click', addCastMember);
    const centeredBtn = document.getElementById('castModeCentered');
    if (centeredBtn) centeredBtn.addEventListener('click', () => setCastMode('centered'));
    const ensembleBtn = document.getElementById('castModeEnsemble');
    if (ensembleBtn) ensembleBtn.addEventListener('click', () => setCastMode('ensemble'));

    // Contextual explicit-tone acknowledgement: the FIRST time this browser
    // selects the explicit tone, one honest explanation - no global gate.
    const toneSelect = document.getElementById('storyTone');
    if (toneSelect) {
      toneSelect.addEventListener('change', () => {
        if (toneSelect.value !== 'explicit') return;
        let acked = false;
        try {
          acked = localStorage.getItem('st-tone-explicit-ok') === '1';
        } catch {
          acked = false;
        }
        if (acked) return;
        dialogs
          .openDialog({
            title: 'Explicit tone',
            body: 'The explicit maturity level asks the scribe for 18+ prose. Only you will read it. Choose another level before creating if that is not what you want.',
            variant: 'cost',
            actions: [
              {
                label: 'Choose a different tone',
                className: 'btn-secondary',
                onClick: (close) => {
                  toneSelect.value = 'fade-to-black';
                  close(true);
                },
              },
              {
                label: 'I am 18 or older — use explicit',
                className: 'btn-primary',
                onClick: (close) => {
                  try {
                    localStorage.setItem('st-tone-explicit-ok', '1');
                  } catch {
                    /* private mode: this session only */
                  }
                  close(true);
                },
              },
            ],
          });
      });
    }

    const save = document.getElementById('storyCastSaveBtn');
    const cancel = document.getElementById('storyCastCancelBtn');
    const add = document.getElementById('storyCastAddBtn');
    if (!save || !cancel) return;
    // One wired lifecycle; the dirty guard is the close policy.
    storyCastModal = wireModal('storyCastModal', { beforeClose: requestCloseStoryCastEditor });
    save.addEventListener('click', saveStoryCastEditor);
    cancel.addEventListener('click', requestCloseStoryCastEditor);
    if (add) add.addEventListener('click', addCastEditorMember);
  }

  function openCreator() {
    const wrap = document.getElementById('storyCreateWrap');
    const button = document.getElementById('storyNewBtn');
    if (!wrap) return;
    wrap.hidden = false;
    if (button) button.setAttribute('aria-expanded', 'true');
    document.getElementById('storyTitle')?.focus();
  }

  function closeCreator() {
    const wrap = document.getElementById('storyCreateWrap');
    const button = document.getElementById('storyNewBtn');
    if (wrap) wrap.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  return {
    renderCastBuilder,
    addCastMember,
    chooseMainCharacter,
    handleStorySubmit,
    openStoryCastEditor,
    closeStoryCastEditor,
    requestCloseStoryCastEditor,
    renderStoryCastEditor,
    addCastEditorMember,
    saveStoryCastEditor,
    storyCast: () => storyCast.map((e) => ({ ...e })),
    __castEditState: () =>
      castEdit
        ? { ...castEdit, entries: castEdit.entries.map((e) => ({ ...e, state: e.state ? { ...e.state } : null })) }
        : null,
    init,
    openCreator,
    closeCreator,
  };
}
