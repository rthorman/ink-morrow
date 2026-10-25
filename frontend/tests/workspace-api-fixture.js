// In-memory HTTP contract for new free workspace endpoints. Existing tests keep
// their paid-provider spies focused on the actions they exercise.
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
export function workspaceApiFixture(api, storyOf) {
  const rows = new Map();
  let counter = 0;
  return async (path, method = 'GET', body) => {
    const base = path.split('?')[0];
    if(base.startsWith('/fiction/local-actions/'))return {acknowledged:true};
    if (base === '/fiction/drafts') {
      if (method === 'POST') {
        const existing = [...rows.values()].find((row) => JSON.stringify(row.scope) === JSON.stringify(body.scope));
        if (existing) return { draft: clone(existing) };
        const row = {
          id: `private-${++counter}`,
          scope: body.scope,
          revision: 1,
          content: body.content,
          submitted: null
        };
        rows.set(row.id, row);
        return { draft: clone(row) };
      }
      const scope = new URLSearchParams(path.split('?')[1] || '').get('scope');
      return scope
        ? { draft: clone([...rows.values()].find((row) => JSON.stringify(row.scope) === scope) || null) }
        : { drafts: [...rows.values()] };
    }
    if (base.startsWith('/fiction/drafts/')) {
      const id = base.split('/').at(-1);
      const row = rows.get(id);
      if (method === 'DELETE') {
        rows.delete(id);
        return { removed: true };
      }
      if (method === 'PATCH') {
        if (body.content) row.content = body.content;
        if (body.submitted) row.submitted = { ...body.submitted, content: row.content, content_revision: row.revision };
        if (body.clear_submission) row.submitted = null;
        row.revision++;
      }
      return { draft: clone(row) };
    }
    const story = storyOf();
    if (base.endsWith('/timeline'))
      return {
        entries: [...story.beats]
          .reverse()
          .map((beat, index) => ({
            ...beat,
            is_narrative: ['opening', 'scene'].includes(beat.kind),
            narrative_ordinal: story.beats.length - index,
            excerpt: beat.prose.slice(0, 240)
          })),
        next_cursor: null
      };
    if (base.endsWith('/codex')) return { records: story.state.facts || [], next_cursor: null };
    return api(path, method === 'GET' ? undefined : method, body);
  };
}
