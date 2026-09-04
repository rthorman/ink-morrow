import { el, field, option } from './dom.js';

const labels = { off: 'Off — standard play', standard: 'Standard-model review', memory: 'Memory-support review', both: 'Both model roles' };
export function qualityField(value = 'off') {
  const input = field('Optional consistency quality', 'select');
  for (const mode of ['off', 'standard', 'memory', 'both']) input.control.append(option(mode, `${labels[mode]} (${mode === 'off' ? '1 call' : `up to ${mode === 'both' ? 6 : 4} calls`})`));
  input.control.value = value;
  const help = el('p', 'Extra checks cost more and take longer. At most one repair is allowed; the repaired draft must pass review. The standard model focuses on character behaviour; memory support focuses on continuity and knowledge. Neither is a guarantee. These choices are independent of play style and fourth-wall dialogue.');
  help.id = `${input.control.id}-help`; input.control.setAttribute('aria-describedby', help.id); input.wrapper.append(help); return input;
}

export function qualityPaidReview(story) {
  const plan = story.quality_generation;
  if (!plan || plan.mode === 'off') return null;
  return {
    title: 'Continue with consistency checks?', confirmLabel: 'Continue with quality checks',
    consentScope: `fiction-quality-${plan.review_id}`, disabled: !plan.available,
    review: { action: 'Continue with optional consistency review', object: story.title,
      model: plan.roles.map((role) => `${role.label} · ${role.provider?.display_name || 'Unconfigured provider'} · ${role.model_id || 'No model'} (up to ${role.operation_count} calls)`).join('; '),
      quantity: `Up to ${plan.max_calls} model calls total; ${plan.calls_without_repair} if the first draft passes`,
      sends: 'Bounded story context including hidden truth, motives and frozen catalogue references, your direction, candidate prose and proposed changes to each selected role',
      estimate: 0.02 * plan.max_calls,
      note: 'A rough estimate, not a spending cap. More latency and cost; at most one repair followed by review. No transport retry or background continuation. Rejection can still be charged. The same model in two roles is not independent verification.',
    },
  };
}

export function renderQuality(story) {
  const state = document.getElementById('fictionQualityState');
  const mode = story.state.quality_mode || 'off'; state.hidden = mode === 'off';
  state.textContent = mode === 'off' ? '' : `Consistency quality: ${labels[mode]} · up to ${story.quality_generation?.max_calls || (mode === 'both' ? 6 : 4)} model calls.`;
  const rows = document.getElementById('fictionCalls'); rows.replaceChildren();
  const calls = story.recent_calls || []; document.getElementById('fictionCallHistory').hidden = !calls.length;
  if (calls.length) rows.append(el('p', 'The latest twelve calls across this story’s paths. Totals above include all known charges and attempts with unknown cost.'));
  for (const call of calls) rows.append(el('p', `${call.role === 'archivist' ? 'Memory support' : 'Standard model'} · ${call.purpose} · ${call.model || 'Model not reported'} · ${call.status} · ${typeof call.cost_usd === 'number' ? `$${call.cost_usd.toFixed(4)}` : 'cost not reported'}`));
}
