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
    if(base.endsWith('/workspace'))return {state:story.state};
    if(base.endsWith('/editorial')){const rows=story.beats.filter(beat=>['opening','scene'].includes(beat.kind));const volume={id:'auto-volume',title:story.title};const chapter={id:'auto-chapter',title:'The beginning',volume_id:volume.id,after_beat_id:null,through_beat_id:null,open_tail:true};return {revision:story.revision,active_branch_id:story.active_branch_id,branch_head_id:story.head_beat_id,inspection_head_id:story.head_beat_id,latest_narrative_id:rows.at(-1)?.id||null,virtual:true,revision_id:null,layout:{version:1,volumes:[volume],chapters:[chapter]},volumes:[volume],groups:[{...chapter,start:0,end:rows.length-1,count:rows.length,first_beat_id:rows[0]?.id||null,last_beat_id:rows.at(-1)?.id||null}],next_offset:null,passage_count:rows.length};}
    if(base.endsWith('/creative'))return {revision:story.revision,target_branch_id:story.active_branch_id,expected_head_beat_id:story.head_beat_id,config_revision_id:null,reference_heads:{},cast:story.state.cast,settings:{pacing:story.state.pacing||'balanced',consequences:story.state.consequences||'gentle',boundaries:story.state.boundaries||'',voice:story.state.voice||'',focus:story.state.focus||'',play_style:story.state.play_style||'story-shaping',fourth_wall:story.state.fourth_wall||'never',quality_mode:story.state.quality_mode||'off',perspective:'flexible',speaker_id:null,focal_id:null,framing_narrator:'',tense:'past',language:'English',length:{preset:'legacy-short',target:180,unit:'words',definition_version:1},genre_description:'',tone:'',disclosure:'limited',scene_plan:null}};
    if(base.endsWith('/operation-plans'))return {plan:{id:'fixture-plan',consent_id:story.quality_generation?.review_id||'fixture-bounds',max_calls:story.quality_generation?.max_calls||1,stages:[{purpose:'draft',output_tokens:3040}]}};
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
