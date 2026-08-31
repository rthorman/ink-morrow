'use strict';

// Output-quality heuristics for LLM replies. Providers happily deliver empty
// or clearly truncated text as a "success", and occasionally answer in a
// language the user never asked for. These checks are deliberately cheap and
// conservative: no linguistic framework, only punctuation shape, word counts
// and a small English stopword list. A check that cannot judge stays silent.

const { STATE_MARKER_TEXT } = require('./prompt');

// Page replies may carry the <<<CHARACTER_STATE>>> block after the prose;
// quality is judged on the prose alone.
function stripStateBlock(text) {
  const raw = String(text || '');
  const i = raw.indexOf(STATE_MARKER_TEXT);
  return (i >= 0 ? raw.slice(0, i) : raw).trim();
}

// A finished page ends with terminal punctuation, possibly inside a closing
// quote or bracket. Anything else - dangling commas, hyphens, cut-off words -
// reads as a truncated stream.
function isClearlyTruncated(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  return !/[.!?…"'”’)]/.test(s.slice(-1));
}

function wordCount(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean).length;
}

// A tiny window into "is this English?": common function words. Real English
// prose runs 30-50% stopwords; other languages land near zero. Too few words
// to judge returns null (the caller stays silent rather than guessing).
const ENGLISH_STOPWORDS = new Set(
  ('the and of to a in was he she it that her his with as at by on for but not from ' +
    'they their had have when were this which would there all been up out who into its ' +
    'him them then could over after back other very made just know take than more only ' +
    'some like one never still even around while because before again between')
    .split(' ')
);

function englishStopwordRatio(text) {
  // Unicode-aware tokens: accented words (forêt) must stay whole, or they
  // splinter into English-looking shards (for) and poison the ratio.
  const words = String(text || '')
    .toLowerCase()
    .match(/[\p{L}']+/gu) || [];
  if (words.length < 8) return null;
  let hits = 0;
  for (const word of words) if (ENGLISH_STOPWORDS.has(word)) hits++;
  return hits / words.length;
}

// Share of letters written in non-Latin scripts (Cyrillic, Greek, CJK,
// Hangul, Arabic, Hebrew, Thai). Cheap extra confidence for "not English".
function foreignScriptShare(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (letters.length === 0) return 0;
  const foreign = letters.filter((ch) =>
    /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(ch)
  );
  return foreign.length / letters.length;
}

// Confident mismatch only: the reference (the user's own prompt material) is
// clearly English while the reply is clearly not. If the user writes their
// tale in another language, the reference is unjudgeable and we never flag.
function languageMismatch(reference, output) {
  const refRatio = englishStopwordRatio(reference);
  if (refRatio === null || refRatio < 0.15) return false;
  const outRatio = englishStopwordRatio(output);
  if (outRatio === null) return false; // too short to judge - truncation check owns that
  const foreign = foreignScriptShare(output);
  if (foreign >= 0.5) return true;
  return outRatio < 0.02 || (outRatio < 0.05 && foreign >= 0.3);
}

/**
 * Judge one LLM reply against the caller's expectations.
 * Returns 'empty' | 'truncated' | 'language' | null.
 * @param {string} content the raw model reply
 * @param {{minWords?: number}} quality expectations
 * @param {string} reference text the user's own material (language anchor)
 */
function checkReply(content, { minWords = 0 } = {}, reference = '') {
  const prose = stripStateBlock(content).trim();
  // Whitespace (or a reply that is nothing but a character-state block) is
  // empty. Merely terse-but-finished replies are the minWords floor's call.
  if (!prose) return 'empty';
  if (isClearlyTruncated(prose)) return 'truncated';
  if (minWords && wordCount(prose) < minWords) return 'truncated';
  if (languageMismatch(reference, prose)) return 'language';
  return null;
}

module.exports = {
  ENGLISH_STOPWORDS,
  stripStateBlock,
  isClearlyTruncated,
  englishStopwordRatio,
  foreignScriptShare,
  languageMismatch,
  checkReply,
};
