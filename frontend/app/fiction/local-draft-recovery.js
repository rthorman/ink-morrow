import { el, field, button } from './dom.js';
// Recovery copies compared fields into a fresh current-target proposal. It never
// replays an earlier mutation or silently rebases its acknowledged action key.
export async function recoverLocalDrafts({
  api,
  gameId,
  kind,
  subject = null,
  root,
  active,
  onCopy,
}) {
  root.replaceChildren(el('p', 'Opening earlier private proposals…'));
  try {
    const { drafts } = await api(
      `/fiction/drafts?type=local-reference&game_id=${gameId}`,
    );
    if (!active()) return;
    root.replaceChildren(
      el(
        'p',
        'Compare the original proposal and its previous action before copying fields to the current destination. Nothing is applied by recovery.',
      ),
    );
    const matches = drafts.filter(
      (row) => row.scope.kind === kind && row.scope.subject_id === subject,
    );
    if (!matches.length)
      root.append(el('p', 'No matching private proposals remain.'));
    for (const row of matches)
      root.append(
        button(
          `Review ${kind === 'configuration' ? 'creative settings' : kind} proposal${row.submitted ? ' · previous action recorded' : ''}`,
          async () => {
            try {
              const { draft } = await api(`/fiction/drafts/${row.id}`);
              if (!active()) return;
              const comparison = el('section');
              comparison.append(
                field(
                  'Earlier private proposal',
                  'textarea',
                  JSON.stringify(draft.content.form, null, 2),
                  { readOnly: true },
                ).wrapper,
              );
              root.append(comparison);
              const allow = () =>
                comparison.append(
                  button(
                    'Copy compared fields into this current proposal',
                    () => {
                      onCopy(draft.content);
                      comparison.append(
                        el(
                          'p',
                          'Copied as a private proposal. Review the current destination and apply separately.',
                        ),
                      );
                    },
                  ),
                );
              if (!draft.submitted) {
                allow();
                return;
              }
              const previous = await api(
                `/fiction/${gameId}/commands/${draft.submitted.action_key}`,
              );
              if (!active()) return;
              comparison.append(
                el(
                  'p',
                  `Previous local action: ${previous.status}. Checking never repeats it.`,
                ),
              );
              if (previous.can_start_new) allow();
              else
                comparison.append(
                  button('Cancel if not dispatched', async () => {
                    const cancelled = await api(
                      `/fiction/${gameId}/commands/${draft.submitted.action_key}/cancel`,
                      'POST',
                      {},
                    );
                    if (!active()) return;
                    comparison.append(
                      el('p', `Previous action: ${cancelled.status}.`),
                    );
                    if (cancelled.can_start_new) allow();
                  }),
                );
            } catch (error) {
              if (active()) root.append(el('p', error.message));
            }
          },
        ),
      );
  } catch (error) {
    if (active()) root.textContent = error.message;
  }
}
