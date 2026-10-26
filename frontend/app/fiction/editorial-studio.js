import { el, field, button, option } from './dom.js';
import { createPrivateDraft } from './private-drafts.js';
import { recoverLocalDrafts } from './local-draft-recovery.js';
const copy = (value) => JSON.parse(JSON.stringify(value));
export function createEditorialStudio({
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
    const loading = el('div', 'Opening chapter organization…');
    dialogs.openDialog({
      title: 'Chapters & volumes',
      body: [loading],
      onFreeClose: () => {
        serial++;
      },
      actions: [
        {
          label: 'Close',
          onClick: (close) => {
            serial++;
            close(true);
          },
        },
      ],
    });
    try {
      const context = await api(`/fiction/${story.id}/editorial`);
      if (!active()) return;
      let layout = copy(context.layout),
        draft,
        version = 0,
        busy = false,
        cursor = null,
        searchSerial = 0;
      const known = new Map();
      const choices = new Set();
      for (const group of context.groups) {
        if (group.after_beat_id)
          known.set(group.after_beat_id, {
            id: group.after_beat_id,
            ordinal: group.start,
            summary: 'Chapter boundary',
          });
        if (group.through_beat_id)
          known.set(group.through_beat_id, {
            id: group.through_beat_id,
            ordinal: group.end + 1,
            summary: 'Chapter boundary',
          });
      }
      const status = el('p'),
        error = el('p', '', 'fiction-error'),
        recovery = el('section'),
        older = el('section'),
        volumes = el('section'),
        chapters = el('section'),
        preview = el('section');
      status.setAttribute('role', 'status');
      error.setAttribute('role', 'alert');
      const notice = el(
        'p',
        'Organize this story’s chapters and optional volumes. Saving changes navigation and future book exports. Prose, episode endings, scene circumstances and recorded truth keep their own identities. This task buys no AI response.',
      );
      volumes.id = 'editorialVolumes';
      chapters.id = 'editorialChapters';
      preview.id = 'editorialPreview';
      const target = el(
        'p',
        `${story.branches.find((path) => path.id === context.active_branch_id)?.name || 'Active path'} · reviewed latest moment. ${context.virtual ? 'The episode-based layout is still automatic. Saving adopts this layout.' : 'Using this path’s saved layout.'}`,
        'workspace-scope-note',
      );
      const search = field('Find passage boundaries', 'input', '', {
        type: 'search',
        maxLength: 200,
      });
      const searchNote = el(
        'p',
        'Boundary choices load in pages of 80. Existing saved boundaries remain available.',
      );
      function persist() {
        version++;
        draft?.edit({ form: copy(layout), base_revision: context.revision_id });
        preview.replaceChildren();
      }
      function boundary(label, id, onChange) {
        const input = field(label, 'select');
        input.control.append(option('', 'Before the first passage'));
        const ids = new Set([...choices, ...(id ? [id] : [])]);
        for (const key of [...ids].sort(
          (a, b) => (known.get(a)?.ordinal || 0) - (known.get(b)?.ordinal || 0),
        )) {
          const row = known.get(key);
          input.control.append(
            option(
              key,
              row
                ? `Passage ${row.ordinal} · ${row.summary}`
                : 'Retained boundary · load its passage to inspect',
            ),
          );
        }
        input.control.value = id || '';
        input.control.addEventListener('change', () => {
          onChange(input.control.value || null);
          persist();
        });
        return input;
      }
      function render() {
        volumes.replaceChildren(el('h3', 'Volumes'));
        chapters.replaceChildren(el('h3', 'Chapters in reading order'));
        for (const volume of layout.volumes) {
          const card = el('article', '', 'fiction-detail-card');
          const name = field('Volume title', 'input', volume.title, {
            maxLength: 200,
          });
          name.control.addEventListener('input', () => {
            volume.title = name.control.value;
            persist();
            for (const select of chapters.querySelectorAll(
              'select[data-editorial-volume]',
            ))
              for (const choice of select.options) {
                const item = layout.volumes.find(
                  (item) => item.id === choice.value,
                );
                if (item) choice.textContent = item.title || 'Untitled volume';
              }
          });
          card.append(
            name.wrapper,
            button('Remove unused volume', () => {
              if (
                layout.chapters.some(
                  (chapter) => chapter.volume_id === volume.id,
                )
              ) {
                error.textContent =
                  'This volume still contains chapters. Reassign or remove those chapters first.';
                return;
              }
              if (layout.volumes.length === 1) return;
              layout.volumes = layout.volumes.filter(
                (item) => item.id !== volume.id,
              );
              persist();
              render();
            }),
          );
          volumes.append(card);
        }
        for (const [index, chapter] of layout.chapters.entries()) {
          const card = el('article', '', 'fiction-detail-card');
          card.append(
            el(
              'h4',
              `Chapter ${index + 1}${chapter.open_tail ? ' · open tail' : ''}`,
            ),
          );
          const name = field('Chapter title', 'input', chapter.title, {
            maxLength: 200,
          });
          name.control.addEventListener('input', () => {
            chapter.title = name.control.value;
            persist();
          });
          const volume = field('In volume', 'select');
          volume.control.dataset.editorialVolume = 'true';
          volume.control.append(
            ...layout.volumes.map((item) =>
              option(item.id, item.title || 'Untitled volume'),
            ),
          );
          volume.control.value = chapter.volume_id;
          volume.control.addEventListener('change', () => {
            chapter.volume_id = volume.control.value;
            persist();
          });
          const after = boundary(
            'Begin after passage',
            chapter.after_beat_id,
            (value) => {
              chapter.after_beat_id = value;
            },
          );
          const through = boundary(
            'End through passage',
            chapter.through_beat_id,
            (value) => {
              chapter.through_beat_id = value;
            },
          );
          through.control.disabled = chapter.open_tail;
          const groupFields = el('div', '', 'editorial-fields');
          groupFields.append(
            name.wrapper,
            volume.wrapper,
            after.wrapper,
            ...(chapter.open_tail
              ? [
                  el(
                    'p',
                    'The open tail includes future passages on this path, until you start another chapter.',
                  ),
                ]
              : [through.wrapper]),
          );
          card.append(groupFields);
          const split = boundary('Split after passage', null, () => {});
          const splitButton = button('Split this chapter', () => {
            const id = split.control.value;
            if (!id) {
              error.textContent =
                'Choose a passage inside this chapter before splitting.';
              return;
            }
            const next = {
              ...chapter,
              id: crypto.randomUUID(),
              title: 'Another chapter',
              after_beat_id: id,
            };
            chapter.through_beat_id = id;
            chapter.open_tail = false;
            layout.chapters.splice(index + 1, 0, next);
            persist();
            render();
          });
          card.append(
            split.wrapper,
            splitButton,
            button('Remove this chapter grouping', () => {
              if (layout.chapters.length === 1) {
                error.textContent =
                  'Keep one open chapter. You can rename it or use the automatic layout.';
                return;
              }
              layout.chapters.splice(index, 1);
              if (chapter.open_tail) {
                const tail = layout.chapters.at(-1);
                tail.open_tail = true;
                tail.through_beat_id = null;
              }
              persist();
              render();
            }),
            el(
              'p',
              'Grouping removal keeps all passages. Unassigned ranges appear automatically; chronology cannot be rearranged.',
              'fiction-muted',
            ),
          );
          chapters.append(card);
        }
      }
      async function find(append = false) {
        const request = ++searchSerial;
        const query = new URLSearchParams({
          q: search.control.value,
          branch_id: context.active_branch_id,
          inspection_at: context.inspection_head_id || 'initial',
        });
        if (append && cursor !== null) query.set('offset', cursor);
        try {
          const data = await api(
            `/fiction/${story.id}/editorial/passages?${query}`,
          );
          if (!active() || request !== searchSerial) return;
          if (!append) choices.clear();
          for (const row of data.passages) {
            known.set(row.id, row);
            choices.add(row.id);
          }
          cursor = data.next_offset;
          more.hidden = cursor === null;
          searchNote.textContent = `${choices.size} passage choices loaded. Select boundaries by passage; original order stays fixed.`;
          render();
        } catch (caught) {
          if (active()) error.textContent = caught.message;
        }
      }
      const more = button('More passage choices', () => find(true));
      more.hidden = true;
      const add = (newVolume = false) => {
        if (
          layout.chapters.length >= 512 ||
          (newVolume && layout.volumes.length >= 64)
        ) {
          error.textContent = 'The layout reached its chapter or volume limit.';
          return;
        }
        let volume = layout.volumes.at(-1);
        if (newVolume) {
          volume = { id: crypto.randomUUID(), title: 'Another volume' };
          layout.volumes.push(volume);
        }
        const tail = layout.chapters.at(-1);
        tail.open_tail = false;
        tail.through_beat_id = context.latest_narrative_id;
        layout.chapters.push({
          id: crypto.randomUUID(),
          title: 'Another chapter',
          volume_id: volume.id,
          after_beat_id: context.latest_narrative_id,
          through_beat_id: null,
          open_tail: true,
        });
        persist();
        render();
      };
      function showPreview(data) {
        preview.replaceChildren(
          el('h3', 'Layout preview'),
          el(
            'p',
            'Empty planned groups are omitted from books. Every narrative passage remains available.',
          ),
        );
        for (const volume of data.layout.volumes) {
          preview.append(el('h4', volume.title));
          for (const group of data.groups.filter(
            (group) => group.volume_id === volume.id,
          ))
            preview.append(
              el(
                'p',
                `${group.title} · ${group.count ? `passages ${group.start + 1}–${group.end + 1}` : 'empty plan'}${group.open_tail ? ' · open tail' : ''}${group.automatic ? ' · automatic fallback' : ''}`,
              ),
            );
        }
      }
      async function reviewPrevious() {
        const submitted = draft.state?.row?.submitted;
        if (!submitted) return;
        const data = await api(
          `/fiction/${story.id}/commands/${submitted.action_key}`,
        );
        if (!active()) return;
        status.textContent = `Previous layout change: ${data.status}. Checking never repeats it.`;
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
      const frozen = {
        expected_revision: context.revision,
        target_branch_id: context.active_branch_id,
        expected_head_beat_id: context.branch_head_id,
      };
      const previewButton = button('Preview chapter layout', async () => {
        const before = version;
        try {
          const data = await api(
            `/fiction/${story.id}/editorial/preview`,
            'POST',
            { ...frozen, layout: copy(layout) },
          );
          if (active() && before === version) showPreview(data);
        } catch (caught) {
          if (active()) error.textContent = caught.message;
        }
      });
      draft = createPrivateDraft({
        api,
        onChange: (state) => {
          if (!active() || !state) return;
          recovery.replaceChildren(
            el('p', state.message),
            button('Save private layout draft now', () =>
              draft.flush().catch((caught) => {
                error.textContent = caught.message;
              }),
            ),
            button('Copy layout draft', async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(state.local.form, null, 2),
                );
              } catch {
                recovery.append(
                  field(
                    'Select and copy layout draft',
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
              button('Review previous layout change', () =>
                reviewPrevious().catch((caught) => {
                  error.textContent = caught.message;
                }),
              ),
            );
          if (state.conflict) {
            recovery.append(
              field(
                'Local layout proposal',
                'textarea',
                JSON.stringify(state.local.form, null, 2),
                { readOnly: true },
              ).wrapper,
              field(
                'Saved layout proposal',
                'textarea',
                JSON.stringify(state.conflict.content.form, null, 2),
                { readOnly: true },
              ).wrapper,
            );
            for (const [label, server] of [
              ['Use saved layout proposal', true],
              ['Keep compared local layout', false],
            ])
              recovery.append(
                button(label, () => {
                  const result = draft.resolve(server);
                  if (result) {
                    layout = copy(result.form);
                    version++;
                    render();
                  }
                }),
              );
          }
        },
      });
      drafts.add(draft);
      const recover = button('Recover an earlier layout proposal…', () =>
        recoverLocalDrafts({
          api,
          gameId: story.id,
          kind: 'editorial',
          root: older,
          active,
          onCopy: (content) => {
            layout = copy(content.form);
            persist();
            render();
          },
        }),
      );
      render();
      dialogs.openDialog({
        title: 'Chapters & volumes',
        variant: 'studio',
        onFreeClose: () => {
          serial++;
          draft.close();
          drafts.delete(draft);
        },
        body: [
          notice,
          target,
          search.wrapper,
          button('Load passage choices', () => find()),
          searchNote,
          more,
          volumes,
          chapters,
          button('Start a new tail chapter', () => add()),
          button('Start a new volume', () => add(true)),
          previewButton,
          preview,
          recovery,
          recover,
          older,
          status,
          error,
        ],
        dirty: () => Boolean(draft.state?.dirty),
        actions: [
          {
            label: 'Close',
            className: 'btn-secondary',
            onClick: (close) => close(),
          },
          {
            label: 'Save layout',
            className: 'btn-primary',
            pendingLabel: 'Saving layout…',
            onClick: async (close) => {
              if (busy) return;
              busy = true;
              const before = version;
              try {
                if (getCurrent().revision !== context.revision)
                  throw Error(
                    'The destination changed. Keep the proposal and reopen at latest; recover and compare it before applying.',
                  );
                await api(`/fiction/${story.id}/editorial/preview`, 'POST', {
                  ...frozen,
                  layout: copy(layout),
                });
                if (!active()) return;
                if (version !== before)
                  throw Error(
                    'Your layout changed during validation. Review it again.',
                  );
                persist();
                const row = await draft.flush();
                if (!active()) return;
                if (version !== before + 1)
                  throw Error(
                    'Your layout changed while saving. Review it again.',
                  );
                const submitted = await draft.submit({
                  game_id: story.id,
                  branch_id: context.active_branch_id,
                  head_beat_id: context.branch_head_id,
                  revision: context.revision,
                  purpose: 'story-local-command',
                });
                if (!active()) return;
                if (version !== before + 1)
                  throw Error(
                    'Review the prepared layout change before trying again.',
                  );
                const result = await runAction(() =>
                  api(`/fiction/${story.id}/commands/editorial`, 'POST', {
                    ...frozen,
                    action_key: submitted.actionKey,
                    expected_editorial_id: context.revision_id,
                    layout: row.content.form,
                  }),
                );
                if (!active()) return;
                if (!result?.ok) {
                  error.textContent =
                    result?.error ||
                    'Layout not applied. Your draft remains available.';
                  return;
                }
                if (version === before + 1 && !draft.state.dirty) {
                  await draft.discard();
                  draft.close();
                  drafts.delete(draft);
                  close(true);
                } else
                  status.textContent =
                    'The reviewed layout was saved. Newer edits remain private; compare at the latest destination.';
              } catch (caught) {
                if (active()) error.textContent = caught.message;
              } finally {
                busy = false;
              }
            },
          },
        ],
      });
      const initial = version;
      const restored = await draft.open(
        {
          type: 'local-reference',
          kind: 'editorial',
          subject_id: null,
          base_revision: context.revision_id,
          game_id: story.id,
          branch_id: context.active_branch_id,
          head_id: context.branch_head_id,
        },
        { form: copy(layout), base_revision: context.revision_id },
      );
      if (active() && restored && initial === version) {
        layout = copy(restored.form);
        render();
      }
      await find();
    } catch (caught) {
      if (active()) loading.textContent = caught.message;
    }
  }
  return { open, clear };
}
