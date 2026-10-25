// Private text lives in authenticated server drafts and this tab's memory only.
export function createPrivateDraft({ api, onChange = () => {} }) {
  let generation = 0;
  let state = null;
  let timer;
  let queue = Promise.resolve();
  let opening = Promise.resolve();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const emit = (message) => {
    if (state) {
      state.message = message;
      onChange({ ...state });
    }
  };
  async function open(scope, initial) {
    clearTimeout(timer);
    const ticket = ++generation;
    state = {
      scope: copy(scope),
      local: copy(initial),
      row: null,
      createId: crypto.randomUUID(),
      dirty: false,
      conflict: null,
      message: 'Opening private draft…'
    };
    emit(state.message);
    try {
      const read = api(`/fiction/drafts?scope=${encodeURIComponent(JSON.stringify(scope))}`);
      opening = read.catch(() => {});
      const { draft, creation } = await read;
      if (ticket === generation && state) state.creation = creation || null;
      if (ticket !== generation) return null;
      if (draft) {
        state.row = draft;
        if (!state.dirty) state.local = copy(draft.content);
        emit('Private draft recovered from the server. Expires after 30 days without a save.');
      } else emit('Unsaved private draft.');
      return draft ? copy(state.local) : null;
    } catch (error) {
      if (ticket === generation) emit(`${error.message} Kept in this tab only. Copy your text before leaving.`);
      return null;
    }
  }
  function edit(content) {
    if (!state) return;
    if (JSON.stringify(state.local) === JSON.stringify(content)) return;
    state.local = copy(content);
    state.dirty = true;
    emit('Saving private draft…');
    clearTimeout(timer);
    timer = setTimeout(() => {
      flush().catch(() => {});
    }, 650);
  }
  function flush() {
    clearTimeout(timer);
    const ticket = generation;
    const operation = async () => {
      await opening;
      if (ticket !== generation || !state) throw Error('The private draft is no longer open.');
      if (state.creation && !state.row)
        throw Error('A previous creation succeeded. Open or acknowledge its result first.');
      if (state.conflict) throw Error('Compare the server draft before saving.');
      if (!state.dirty && state.row) return state.row;
      const snapshot = copy(state.local);
      const prior = state.row;
      try {
        const { draft } = prior
          ? await api(`/fiction/drafts/${prior.id}`, 'PATCH', { expected_revision: prior.revision, content: snapshot })
          : await api('/fiction/drafts', 'POST', { id: state.createId, scope: state.scope, content: snapshot });
        if (ticket !== generation) return draft; // An acknowledged write may finish after Lock.
        state.row = draft;
        if (JSON.stringify(state.local) === JSON.stringify(snapshot)) state.dirty = false;
        emit(state.dirty ? 'Newer edits are waiting to save.' : 'Private draft saved on the server.');
        return draft;
      } catch (error) {
        if (ticket !== generation) throw error;
        if (error.code === 'DRAFT_CONFLICT') {
          try {
            state.conflict = (
              await api(`/fiction/drafts?scope=${encodeURIComponent(JSON.stringify(state.scope))}`)
            ).draft;
          } catch {
            /* keep the local copy */
          }
        }
        emit(`${error.message} Local text is retained. Copy it before leaving.`);
        throw error;
      }
    };
    queue = queue.catch(() => {}).then(operation);
    return queue;
  }
  async function submit(target, actionKey = crypto.randomUUID()) {
    const ticket = generation;
    const row = await flush();
    if (ticket !== generation || !state) throw Error('The draft was closed.');
    if (row.submitted) throw Error('A previous submission needs review before another request.');
    const { draft } = await api(`/fiction/drafts/${row.id}`, 'PATCH', {
      expected_revision: row.revision,
      submitted: { action_key: actionKey, target }
    });
    if (ticket !== generation) throw Error('The draft was closed before dispatch. No new request was sent.');
    state.row = draft;
    emit('Submission identity saved.');
    return { row: draft, actionKey };
  }
  async function clearSubmission() {
    const ticket = generation;
    const row = await flush();
    if (ticket !== generation || !state) throw Error('The draft was closed.');
    const { draft } = await api(`/fiction/drafts/${row.id}`, 'PATCH', {
      expected_revision: row.revision,
      clear_submission: true
    });
    if (ticket === generation) {
      state.row = draft;
      emit('Previous submission reviewed.');
    }
  }
  async function discard() {
    const ticket = generation;
    const row = await flush();
    if (ticket !== generation || !state) throw Error('The draft was closed.');
    await api(`/fiction/drafts/${row.id}`, 'DELETE', { expected_revision: row.revision });
    if (ticket === generation) {
      state = null;
      ++generation;
      onChange(null);
    }
  }
  function resolve(useServer) {
    if (!state?.conflict) return;
    const server = state.conflict;
    state.row = server;
    state.conflict = null;
    if (useServer) {
      state.local = copy(server.content);
      state.dirty = false;
    } else state.dirty = true;
    emit(
      useServer
        ? 'Recovered the server version.'
        : 'Local version selected. Save explicitly to replace the compared version.'
    );
    return copy(state.local);
  }
  function close() {
    clearTimeout(timer);
    ++generation;
    state = null;
    onChange(null);
  }
  return {
    open,
    acknowledgeCreation: async () => {
      const ticket = generation;
      const creation = state?.creation;
      if (!creation) return;
      await api(`/fiction/local-actions/${encodeURIComponent(creation.action_key)}/ack`, 'POST', {});
      if (ticket === generation && state) {
        state.creation = null;
        emit('Previous creation acknowledged. A new draft can now be saved.');
      }
    },
    edit,
    flush,
    submit,
    clearSubmission,
    discard,
    resolve,
    close,
    get state() {
      return state;
    }
  };
}
