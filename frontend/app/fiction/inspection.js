import { el, button, field, option } from './dom.js';
import { workspaceUrl } from './workspace-state.js';

export function createInspection({ api, dialogs, getCurrent, activate,getReadingBeat=()=>null,explore=null }) {
  const $ = (id) => document.getElementById(id);
  let serial = 0;
  let owner = null;
  let privateRoot = null;
  const roots = new Set();
  function clear() {
    ++serial;
    for (const root of roots) root.remove();
    roots.clear();
    privateRoot = null;
    owner = null;
  }
  function leave() {
    ++serial;
    privateRoot?.replaceChildren();
    roots.delete(privateRoot);
    privateRoot?.remove();
    privateRoot = null;
  }
  function root(id, parent, before = false) {
    let node = $(id);
    if (!node) {
      node = el('section', '', 'workspace-inspection');
      node.id = id;
      roots.add(node);
      if (before) $(parent).prepend(node);
      else $(parent).append(node);
    }
    return node;
  }
  function params() {
    return new URLSearchParams(location.hash.split('?')[1] || '');
  }
  function navigate(room, changes = {}) {
    const query = params();
    query.delete('task');
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    location.hash = `${workspaceUrl(getCurrent().id, room).split('?')[0]}${query.size ? '?' + query : ''}`;
  }
  function queryString(query) {
    const result = new URLSearchParams();
    for (const [client, server] of [
      ['branch', 'branch_id'],
      ['at', 'inspection_at'],
      ['presentation', 'presentation_mode']
    ])
      if (query.has(client)) result.set(server, query.get(client));
    return result;
  }
  function evidence(id, context) {
    const story = getCurrent();
    const ticket = serial;
    const body = el('div', 'Opening recorded evidence…');
    dialogs.openDialog({
      title: 'Recorded evidence',
      body: [body],
      actions: [{ label: 'Close', className: 'btn-secondary', onClick: (close) => close(true) }]
    });
    api(`/fiction/${story.id}/evidence/${id}?${context}`)
      .then((data) => {
        if (ticket !== serial || owner !== story.id) return;
        body.replaceChildren(el('p', data.beat.summary), el('p', data.precision));
        for (const source of data.sources) {
          const card = el('article', '', 'fiction-detail-card');
          card.append(el('p', source.precision));
          if (source.quote)
            card.append(
              el('blockquote', source.quote),
              el(
                'p',
                `Source: ${source.source_kind === 'narration' ? 'accepted narration' : 'private submitted material'}. Exact stored source verified.`
              )
            );
          body.append(card);
        }
        if (data.beat.prose) body.append(el('p', data.beat.prose));
        body.append(button('Open private owner sources…', () => navigate('codex', { planning: '1', source: id })));
      })
      .catch((error) => {
        if (ticket === serial) body.textContent = error.message;
      });
  }
  async function render(room) {
    const story = getCurrent();
    if (!story) return;
    leave();
    const ticket = serial;
    owner = story.id;
    const query = params();
    const context = queryString(query);
    const live = () => ticket === serial && getCurrent()?.id === story.id;
    const pathRoot = root('inspectionPath', 'workspaceChronicle', true);
    pathRoot.replaceChildren(
      el('p', 'Browse any path without changing the destination for actions.', 'workspace-scope-note')
    );
    const select = field('Browse path', 'select');
    select.control.append(...story.branches.map((path) => option(path.id, path.name)));
    select.control.value = query.get('branch') || story.active_branch_id;
    select.control.addEventListener('change', () =>
      navigate('chronicle', { branch: select.control.value, at: null, page: null, planning: null })
    );
    pathRoot.append(
      select.wrapper,
      button('Inspect latest on this path', () => navigate(room, { at: null, page: null, planning: null })),
      button('Return to active path', () => navigate(room, { branch: null, at: null, page: null, planning: null }))
    );
    const alternate = select.control.value !== story.active_branch_id;
    if (alternate)
      pathRoot.append(
        button('Make this path active…', () =>
          dialogs.openDialog({
            title: 'Change action destination?',
            body: 'Future actions will use the latest moment on this path. The other path remains saved.',
            actions: [
              { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
              {
                label: 'Make active',
                className: 'btn-primary',
                onClick: async (close) => {
                  const result = await activate(select.control.value);
                  if (result?.ok) {
                    close(true);
                    navigate('chronicle', { branch: null, at: null, page: null });
                  }
                }
              }
            ]
          })
        )
      );
    const inspected = query.has('branch') || query.has('at') || query.has('page');
    $('workspaceReader').hidden = inspected;
    if ($('workspaceCurrentCodex')) $('workspaceCurrentCodex').hidden = inspected;
    document.querySelector('.workspace-desk-footer').hidden = inspected;
    const desk = root('inspectionReader', 'workspaceDesk');
    desk.hidden = !inspected;
    if (!inspected) desk.replaceChildren();
    for(const [name,parent] of [['gate','workspaceGate'],['gallery','workspaceGallery']]){
      const scope=root(`inspection-${name}-target`,parent,true);scope.hidden=room!==name;
      if(room===name){const active=story.branches.find(path=>path.id===story.active_branch_id);scope.replaceChildren(el('p',`${name==='gate'?'Book export':'Image tools'} destination: ${active?.name||'active path'} at its latest moment. Read-only browsing does not change this destination.`,'workspace-scope-note'));}
    }
    const codex = root('inspectionCodex', 'fictionDetails', true);
    codex.hidden = room !== 'codex';
    // Current owner controls retain their explicit active/latest scope.
    if (room === 'codex')
      codex.replaceChildren(
        el('h3', 'Inspect this moment'),
        el(
          'p',
          inspected
            ? 'Records follow the inspected path and moment. Return to the active path to use its current controls.'
            : 'Public records and controls currently follow the active path at its latest moment.'
        )
      );
    try {
      if (room === 'chronicle') {
        const history = $('workspaceHistory');
        history.replaceChildren();
        const load = async (cursor) => {
          const q = new URLSearchParams(context);
          if (cursor) q.set('cursor', cursor);
          const data = await api(`/fiction/${story.id}/timeline?${q}`);
          if (!live()) return;
          $('workspaceHistoryStatus').textContent =
            'History at the inspection boundary. Narrative passages, Ask answers and local changes are separate records.';
          for (const record of data.entries) {
            const card = el('article', '', 'workspace-history-card');
            card.dataset.beatId = record.id;
            card.append(
              el('p', record.is_narrative ? `Passage ${record.narrative_ordinal}` : record.record_type==='editorial'?'Editorial organization':record.kind, 'eyebrow'),
              el('h3', record.summary),
              el('p', record.excerpt)
            );
            if(record.id===getReadingBeat())card.append(el('p','Your reading cursor','workspace-scope-note'));if(record.id===story.head_beat_id)card.append(el('p','Latest action moment','workspace-scope-note'));for(const path of story.branches.filter(path=>path.fork_beat_id===record.id))card.append(el('p',`Path branches here: ${path.name}`,'fiction-muted'));
            card.append(
              button('Inspect state here', () => navigate('codex', { at: record.id, planning: null })),
              button('Recorded evidence', () => evidence(record.id, context))
            );
            if (record.is_narrative)
              card.append(
                button('Read this passage', () => navigate('desk', { page: record.id, at: query.get('at') }))
              );
            if(explore&&data.view_branch_id===story.active_branch_id)card.append(button('Explore from this moment',()=>explore(record)));
            history.append(card);
          }
          if (data.next_cursor) {
            const more = button('Earlier history', async () => {
              more.disabled = true;
              try {
                await load(data.next_cursor);
                more.remove();
              } catch (error) {
                more.disabled = false;
                $('workspaceHistoryStatus').textContent = error.message;
              }
            });
            history.append(more);
          }
          if (!data.entries.length) history.append(el('p', 'No reader-visible records at this moment.'));
        };
        await load(null);
        const outline=root('workspaceEditorial','workspaceChronicle',true);outline.replaceChildren(el('p','Opening chapter outline…'));
        const loadOutline=async(offset=null,boundary=null)=>{const q=new URLSearchParams(context);q.set('outline','1');if(offset!==null)q.set('offset',offset);if(boundary){q.set('branch_id',boundary.view_branch_id);q.set('inspection_at',boundary.inspection_head_id||'initial');}const editorial=await api(`/fiction/${story.id}/editorial?${q}`);if(!live())return;if(offset===null)outline.replaceChildren(el('p',editorial.virtual?'Automatic episode-based layout.':'Saved layout at the inspected moment.'));let previousVolume=null;for(const chapter of editorial.groups){if(chapter.volume_id!==previousVolume){outline.append(el('h3',editorial.volumes.find(volume=>volume.id===chapter.volume_id)?.title||'Volume'));previousVolume=chapter.volume_id;}const card=el('article','','fiction-detail-card');card.append(el('h4',chapter.title),el('p',`${chapter.count?`Passages ${chapter.start+1}–${chapter.end+1}`:'Empty planned chapter'}${chapter.open_tail?' · open tail':''}${chapter.automatic?' · automatic fallback':''}`));if(chapter.first_beat_id)card.append(button('Read chapter opening',()=>navigate('desk',{page:chapter.first_beat_id,at:query.get('at')})));outline.append(card);}if(editorial.next_offset!==null){const more=button('More chapter groups',async()=>{more.disabled=true;try{await loadOutline(editorial.next_offset,editorial);more.remove();}catch(error){more.disabled=false;outline.append(el('p',error.message));}});outline.append(more);}};
        await loadOutline();
        $('fictionEditorial').hidden=inspected;
      }
      if (room === 'codex') {
        if (inspected)
          codex.append(
            button('Return to active path at latest', () =>
              navigate('codex', { branch: null, at: null, page: null, planning: null, source: null })
            )
          );
        const section = field('Records', 'select');
        section.control.append(
          ...['all','facts','people','commitments','relationships','goals','resources','promises','debts','knowledge','secrets','factions','quests','conditions','inventory'].map((name) =>
            option(name, name[0].toUpperCase() + name.slice(1))
          )
        );
        const contextLabel = el('p', '', 'workspace-scope-note');
        codex.append(contextLabel);
        const search = field('Search public records', 'input', '', { maxLength: 200 });
        const records = el('div');
        let searchSerial = 0;
        const load = async (cursor = null, append = false) => {
          const request = ++searchSerial;
          const q = new URLSearchParams(context);
          q.set('section', section.control.value);
          q.set('q', search.control.value);
          if (cursor) q.set('cursor', cursor);
          try {
            const data = await api(`/fiction/${story.id}/codex?${q}`);
            if (!live() || request !== searchSerial) return;
            contextLabel.textContent = `${story.branches.find((path) => path.id === data.view_branch_id)?.name || 'Inspected path'} · ${data.narrative_ordinal ? `after passage ${data.narrative_ordinal}` : 'before the opening'}`;
            if (!append) records.replaceChildren();
            for (const record of data.records) {
              const card = el('article', '', 'fiction-detail-card');
              card.append(
                el('h4', record.name || record.kind || 'Record'),
                el('p', record.text || record.description || '')
              );
              if(record.claim_kind)card.append(el('p',`Recorded as: ${record.claim_kind.replaceAll('-',' ')}`,'fiction-muted'));if(record.resolution_disposition)card.append(el('p',`Goal resolution: ${record.resolution_disposition.replaceAll('-',' ')}`,'fiction-muted'));if(record.campaign_section)card.append(el('p',`Campaign: ${record.campaign_section}`,'fiction-muted'));
              if (record.evidence_beat_id)
                card.append(button('Recorded evidence', () => evidence(record.evidence_beat_id, context)));
              else
                card.append(
                  el('p', record.type === 'person' ? 'Public cast description.' : 'Established at the beginning.')
                );
              records.append(card);
            }
            if (data.next_cursor) {
              const more = button('More records', async () => {
                more.disabled = true;
                await load(data.next_cursor, true);
                more.remove();
              });
              records.append(more);
            }
            if (!data.records.length) records.append(el('p', 'No matching public records at this moment.'));
          } catch (error) {
            if (live()) records.textContent = error.message;
          }
        };
        section.control.addEventListener('change', () => load());
        search.control.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            load();
          }
        });
        codex.append(
          section.wrapper,
          search.wrapper,
          button('Search records', () => load()),
          records,
          button('Open private owner planning…', () => navigate('codex', { planning: '1' }))
        );
        await load();
        if (query.get('planning') === '1' && live()) {
          privateRoot = root('inspectionPlanning', 'fictionDetails', true);
          privateRoot.replaceChildren(
            el('h3', 'Private owner planning'),
            el(
              'p',
              'Contains motives, hidden facts and private configuration. This is excluded from ordinary reading and book exports.'
            ),
            button('Close private planning', () => navigate('codex', { planning: null }))
          );
          const privateContext = new URLSearchParams(context);
          if (query.has('source')) privateContext.set('evidence_at', query.get('source'));
          const data = await api(`/fiction/${story.id}/planning?${privateContext}`);
          if (!live()) return;
          if (data.evidence) {
            privateRoot.append(el('h4', 'Private original source'), el('p', data.evidence.beat.summary));
            for (const source of data.evidence.sources) {
              privateRoot.append(el('p', source.precision));
              if (source.quote)
                privateRoot.append(
                  el('blockquote', source.quote),
                  el('p', `Exact ${source.source_kind} source verified.`)
                );
            }
            for (const [name, value] of Object.entries(data.evidence.beat.input || {}))
              if (typeof value === 'string') privateRoot.append(el('p', `${name}: ${value}`));
          }
          for (const person of data.cast)
            privateRoot.append(el('h4', person.name), el('p', person.motive || 'No private motive recorded.'));
          for (const fact of data.records) privateRoot.append(el('p', `${fact.visibility}: ${fact.text}`));
          for(const [name,value]of Object.entries(data.configuration)){if(name==='creative'&&value){privateRoot.append(el('h4','Private creative configuration'));for(const key of ['perspective','language','tense','framing_narrator','genre_description','tone'])if(value[key])privateRoot.append(el('p',`${key.replaceAll('_',' ')}: ${value[key]}`));if(value.scene_plan)privateRoot.append(el('p',`Proposed next scene: ${[value.scene_plan.location,value.scene_plan.time,value.scene_plan.purpose,value.scene_plan.notes].filter(Boolean).join(' · ')}`));}else if(value)privateRoot.append(el('p',`${name}: ${value}`));}
        }
      }
      if (room === 'desk' && inspected) {
        desk.replaceChildren(el('p', 'Opening inspected passage…'));
        const meta = await api(`/fiction/${story.id}/workspace?${context}`);
        if (!live()) return;
        const page = query.get('page') || meta.inspection_narrative_id;
        if (!page) {
          desk.replaceChildren(el('p', 'Before the first narrative passage.'));
          return;
        }
        const data = await api(`/fiction/${story.id}/passages/${encodeURIComponent(page)}?${context}`);
        if (!live()) return;
        desk.replaceChildren(
          el(
            'p',
            `Read-only inspection · Passage ${data.narrative_ordinal} · ${data.presentation_mode === 'historical' ? 'As it was at this moment' : 'Current presentation'}`,
            'workspace-scope-note'
          )
        );
        if (data.illustration) {
          const figure = el('figure');
          const img = el('img');
          img.src = `/api/fiction/${story.id}/images/${data.illustration.asset_id}`;
          img.alt = data.illustration.alt_text;
          figure.append(img);
          if (data.illustration.caption) figure.append(el('figcaption', data.illustration.caption));
          desk.append(figure);
        }
        const prose = el('article', '', 'fiction-prose');
        for (const paragraph of data.beat.prose.split(/\n\s*\n/)) prose.append(el('p', paragraph));
        desk.append(prose);
        desk.append(
          button('Return to active path at latest', () =>
            navigate('desk', { branch: null, at: null, page: null, planning: null, source: null })
          )
        );
        const navigation = el('nav', '', 'fiction-pagination');
        if (data.previous_id) navigation.append(button('Previous', () => navigate('desk', { page: data.previous_id })));
        if (data.next_id) navigation.append(button('Next', () => navigate('desk', { page: data.next_id })));
        navigation.append(
          button('Latest within inspection', () => navigate('desk', { page: null })),
          button('Inspect state after this passage', () => navigate('codex', { at: page, planning: null })),
          button('Recorded evidence', () => evidence(page, context)),
          button(data.presentation_mode === 'historical' ? 'Use current presentation' : 'As it was', () =>
            navigate('desk', {
              presentation: data.presentation_mode === 'historical' ? 'current' : 'historical',
              ...(data.presentation_mode === 'historical' ? {} : { at: page })
            })
          )
        );
        desk.append(navigation);
      }
    } catch (error) {
      if (live()) {
        const target = room === 'desk' ? desk : room === 'codex' ? codex : $('workspaceHistory');
        target.append(el('p', error.message, 'fiction-error'));
      }
    }
  }
  return { render, clear, leave };
}
