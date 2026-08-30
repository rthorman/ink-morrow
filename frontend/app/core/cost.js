// Shared cost-review helpers: every paid flow describes itself with the same
// data shape (what, to what, with which model, how much, what is sent, what
// else gets billed), so the review dialog grammar stays uniform across
// features. When catalogue pricing has not arrived, the UI still gives a
// conservative order-of-magnitude ballpark instead of withholding a number.

import { formatUsd } from './dom.js';

export const ROUGH_TEXT_CALL_ESTIMATE = 0.02;
export const ROUGH_NARRATION_PAGE_ESTIMATE = 0.05;
export const ROUGH_GENERIC_ACTION_ESTIMATE = 0.05;

// Number → "≈$0.0312"; 0 → "free"; missing/non-finite → a clearly labelled
// generic ballpark. A paid action must never imply an unbounded mystery bill.
export function approxCostText(estimate) {
  if (estimate === null || estimate === undefined || !Number.isFinite(estimate)) {
    return `≈${formatUsd(ROUGH_GENERIC_ACTION_ESTIMATE)} (rough ballpark)`;
  }
  if (estimate === 0) return 'free';
  return `≈${formatUsd(estimate)}`;
}

// Rough per-page text-generation estimate. The provider charges prompt tokens
// for the context (world + cast + the last ~5 pages + instructions) and
// completion tokens for the new prose. Completion dominates and is fairly
// predictable (words × ≈1.5 tokens); the prompt side is estimated from the
// pages the client actually holds. If the chosen model or its catalogue price
// has not loaded, $0.02 per call is a deliberately conservative ballpark for
// this app's normal short-form requests—not a quote or spending guarantee.
export function estimatePageCost({ models, model, wordsPerPage, pageChars }) {
  if (!model) return ROUGH_TEXT_CALL_ESTIMATE;
  const entry = (models || []).find((m) => m.id === model);
  if (!entry) return ROUGH_TEXT_CALL_ESTIMATE;
  const p = entry.pricing || {};
  if (!Number.isFinite(p.prompt_per_mtok) && !Number.isFinite(p.completion_per_mtok)) {
    return ROUGH_TEXT_CALL_ESTIMATE;
  }
  const words = Number.isFinite(wordsPerPage) ? wordsPerPage : 400;
  const completionTokens = words * 1.5;
  const promptTokens = (Number.isFinite(pageChars) ? pageChars : 0) / 4 + 1200;
  const cost =
    (promptTokens * (p.prompt_per_mtok || 0) + completionTokens * (p.completion_per_mtok || 0)) / 1e6;
  return Number.isFinite(cost) ? cost : ROUGH_TEXT_CALL_ESTIMATE;
}

// Render the shared review body for a paid dialog. Rows with falsy values are
// omitted; the estimate row is always present (missing catalogue data falls
// back to a labelled rough ballpark).
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

  if (Object.prototype.hasOwnProperty.call(review, 'maximum')) {
    const maxDt = document.createElement('dt');
    maxDt.textContent = 'Retry ceiling';
    const maxDd = document.createElement('dd');
    maxDd.className = 'review-cost';
    maxDd.textContent = approxCostText(review.maximum);
    dl.append(maxDt, maxDd);
  }

  if (review.note) {
    const p = document.createElement('p');
    p.className = 'review-note';
    p.textContent = review.note;
    return [lead, dl, p];
  }
  return [lead, dl];
}
