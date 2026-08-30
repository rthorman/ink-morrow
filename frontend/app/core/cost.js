// Shared cost-review helpers: every paid flow describes itself with the same
// data shape (what, to what, with which model, how much, what is sent, what
// else gets billed), so the review dialog grammar stays uniform across
// features. Unknown pricing is spelled out honestly - never as $0.00.

import { formatUsd } from './dom.js';

// Number → "≈$0.0312"; 0 → "free"; null/undefined/NaN → "price unavailable".
export function approxCostText(estimate) {
  if (estimate === null || estimate === undefined || !Number.isFinite(estimate)) return 'price unavailable';
  if (estimate === 0) return 'free';
  return `≈${formatUsd(estimate)}`;
}

// Rough per-page text-generation estimate. The provider charges prompt tokens
// for the context (world + cast + the last ~5 pages + instructions) and
// completion tokens for the new prose. Completion dominates and is fairly
// predictable (words × ≈1.5 tokens); the prompt side is estimated from the
// pages the client actually holds. Returns null when the chosen model (or its
// pricing) is unknown - honest "price unavailable", never a fake zero.
export function estimatePageCost({ models, model, wordsPerPage, pageChars }) {
  if (!model) return null; // server default model: pricing unknown to the client
  const entry = (models || []).find((m) => m.id === model);
  if (!entry) return null;
  const p = entry.pricing || {};
  if (!Number.isFinite(p.prompt_per_mtok) && !Number.isFinite(p.completion_per_mtok)) return null;
  const words = Number.isFinite(wordsPerPage) ? wordsPerPage : 400;
  const completionTokens = words * 1.5;
  const promptTokens = (Number.isFinite(pageChars) ? pageChars : 0) / 4 + 1200;
  const cost =
    (promptTokens * (p.prompt_per_mtok || 0) + completionTokens * (p.completion_per_mtok || 0)) / 1e6;
  return Number.isFinite(cost) ? cost : null;
}

// Render the shared review body for a paid dialog. Rows with falsy values are
// omitted; the estimate row is always present (unknown costs say so).
export function reviewBody(review) {
  const lead = document.createElement('p');
  lead.className = 'review-lead';
  lead.textContent = review.action || 'This sends paid work to the provider.';

  const dl = document.createElement('dl');
  dl.className = 'review-list';
  const rows = [
    ['For', review.object],
    ['With', review.model],
    ['About', review.quantity],
    ['Sent to the provider', review.sends],
    ['Also bills', review.also],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  const dt = document.createElement('dt');
  dt.textContent = 'Est. cost';
  const dd = document.createElement('dd');
  dd.className = 'review-cost';
  dd.textContent = approxCostText(review.estimate);
  dl.append(dt, dd);

  if (review.note) {
    const p = document.createElement('p');
    p.className = 'review-note';
    p.textContent = review.note;
    return [lead, dl, p];
  }
  return [lead, dl];
}
