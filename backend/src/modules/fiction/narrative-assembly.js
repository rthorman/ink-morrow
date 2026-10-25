'use strict';
const { createHash } = require('node:crypto');
const { keys, text, fail } = require('./model');
const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const STATUSES = ['performed', 'attempted', 'interrupted', 'not-performed'];
function paragraphBoundary(prose, index) {
  const starts = [0];
  const pattern = /\n\s*\n/g;
  while (pattern.exec(prose)) starts.push(pattern.lastIndex);
  if (!Number.isInteger(index) || index < 0 || index >= starts.length)
    fail(
      'Choose an existing paragraph boundary for the authorized speech.',
      'INVALID_SPEECH_PERFORMANCE',
      502,
    );
  return starts[index];
}
function assemble({
  prose,
  intent,
  cast,
  performance = null,
  aside = null,
  protocol = 1,
  curated = false,
}) {
  let speech = null;
  let at = null;
  let utterance = '';
  if (performance !== null && intent.kind !== 'say')
    fail(
      'Only Say has a speech performance.',
      'INVALID_SPEECH_PERFORMANCE',
      502,
    );
  if (intent.kind === 'say' && performance) {
    keys(
      performance,
      ['status', 'evidence', 'paragraph_index'],
      'Speech performance',
    );
    if (!STATUSES.includes(performance.status))
      fail(
        'Unsupported speech performance status.',
        'INVALID_SPEECH_PERFORMANCE',
        502,
      );
    const evidence = text(
      performance.evidence,
      'Speech occurrence or prevention evidence',
      1000,
    );
    if (!prose.includes(evidence))
      fail(
        'Speech needs exact evidence in ordinary narration.',
        'INVALID_SPEECH_PERFORMANCE',
        502,
      );
    const speaker = cast.find((person) => person.id === intent.character_id);
    if (!speaker)
      fail(
        'The authorized speaker is not in the cast.',
        'INVALID_SPEECH_PERFORMANCE',
        502,
      );
    speech = {
      status: performance.status,
      evidence,
      speaker_id: speaker.id,
      input_sha256: sha(intent.text),
      paragraph_index:
        performance.status === 'performed' ? performance.paragraph_index : null,
    };
    if (performance.status === 'performed') {
      if (prose.includes(intent.text))
        fail(
          'The model repeated the authorized words. Return the reaction without duplicating them.',
          'DUPLICATE_OWNED_SPEECH',
          502,
        );
      at = paragraphBoundary(prose, performance.paragraph_index);
      utterance = `${speaker.name} says: “${intent.text}”\n\n`;
    } else if (prose.includes(intent.text))
      fail(
        'Unperformed authorized words cannot appear in narration.',
        'INVALID_SPEECH_PERFORMANCE',
        502,
      );
    else if (performance.paragraph_index !== undefined)
      fail(
        'An unperformed utterance has no insertion boundary.',
        'INVALID_SPEECH_PERFORMANCE',
        502,
      );
  }
  const segments = [];
  let result = '';
  const add = (kind, value) => {
    if (!value) return;
    const start = result.length;
    result += value;
    segments.push({ kind, start, end: result.length, sha256: sha(value) });
  };
  if (at !== null) {
    add('narration', prose.slice(0, at));
    add('owned-speech', utterance);
    add('narration', prose.slice(at));
  } else add('narration', prose);
  if (aside)
    add('aside', `\n\n${aside.character.name}, to you: “${aside.text}”`);
  return {
    prose: result,
    manifest: {
      version: 1,
      response_version: curated ? 0 : protocol,
      sha256: sha(result),
      narration_sha256: sha(prose),
      segments,
      speech,
    },
  };
}
function validateAssembly(manifest, beat) {
  keys(
    manifest,
    [
      'version',
      'response_version',
      'sha256',
      'narration_sha256',
      'segments',
      'speech',
    ],
    'Narrative assembly',
  );
  if (
    manifest.version !== 1 ||
    ![0, 1, 2].includes(manifest.response_version) ||
    !Array.isArray(manifest.segments) ||
    !manifest.segments.length ||
    manifest.segments.length > 5 ||
    manifest.sha256 !== sha(beat.prose)
  )
    fail('Invalid assembled narrative identity.', 'INVALID_SAVE');
  let end = 0;
  let narration = '';
  const owned = [];
  for (const segment of manifest.segments) {
    keys(
      segment,
      ['kind', 'start', 'end', 'sha256'],
      'Narrative source segment',
    );
    if (
      !['narration', 'owned-speech', 'aside'].includes(segment.kind) ||
      segment.start !== end ||
      !Number.isSafeInteger(segment.end) ||
      segment.end <= segment.start ||
      segment.end > beat.prose.length
    )
      fail('Invalid narrative source ranges.', 'INVALID_SAVE');
    const bytes = beat.prose.slice(segment.start, segment.end);
    if (segment.sha256 !== sha(bytes))
      fail('Narrative source bytes changed.', 'INVALID_SAVE');
    end = segment.end;
    if (segment.kind === 'narration') narration += bytes;
    if (segment.kind === 'owned-speech') owned.push(bytes);
  }
  const pattern = manifest.segments.map((segment) => segment.kind).join(',');
  if (
    !/^(narration|owned-speech,narration|narration,owned-speech,narration)(,aside)?$/.test(
      pattern,
    ) ||
    (manifest.response_version === 0 && beat.kind !== 'opening')
  )
    fail('Invalid narrative source ordering.', 'INVALID_SAVE');
  if (end !== beat.prose.length || sha(narration) !== manifest.narration_sha256)
    fail('Incomplete original narration source.', 'INVALID_SAVE');
  if (manifest.speech !== null) {
    const speech = manifest.speech;
    keys(
      speech,
      ['status', 'evidence', 'speaker_id', 'input_sha256', 'paragraph_index'],
      'Authorized speech source',
    );
    if (
      beat.input.kind !== 'say' ||
      !STATUSES.includes(speech.status) ||
      speech.speaker_id !== beat.input.character_id ||
      speech.input_sha256 !== sha(beat.input.text) ||
      typeof speech.evidence !== 'string' ||
      !speech.evidence.length ||
      speech.evidence.length > 1000 ||
      !narration.includes(speech.evidence)
    )
      fail('Invalid authorized speech source.', 'INVALID_SAVE');
    const speaker = beat.state.cast.find(
      (person) => person.id === speech.speaker_id,
    );
    if (!speaker)
      fail('The speech source names an unknown person.', 'INVALID_SAVE');
    if (speech.status === 'performed') {
      if (
        owned.length !== 1 ||
        owned[0] !== `${speaker.name} says: “${beat.input.text}”\n\n` ||
        narration.includes(beat.input.text)
      )
        fail(
          'The authorized utterance was changed or repeated.',
          'INVALID_SAVE',
        );
      let expectedAt;
      try {
        expectedAt = paragraphBoundary(narration, speech.paragraph_index);
      } catch {
        fail('Invalid authorized paragraph boundary.', 'INVALID_SAVE');
      }
      const actualAt = manifest.segments.find(
        (segment) => segment.kind === 'owned-speech',
      ).start;
      if (expectedAt !== actualAt)
        fail(
          'The authorized utterance moved outside its declared boundary.',
          'INVALID_SAVE',
        );
    } else if (
      owned.length ||
      speech.paragraph_index !== null ||
      narration.includes(beat.input.text)
    )
      fail(
        'An unperformed utterance cannot appear as performed.',
        'INVALID_SAVE',
      );
  } else if (
    owned.length ||
    (manifest.response_version === 2 && beat.input.kind === 'say')
  )
    fail('Speech was inserted without authorization.', 'INVALID_SAVE');
  return { narration };
}
function validateEffectSources(
  effects,
  { prose, intent, performance, protocol, modern, lookup },
) {
  return effects.map((effect) => {
    const quote = text(effect.evidence, 'Effect evidence', 1000);
    let source =
      effect.source_kind ||
      (prose.includes(quote) ? 'narration' : 'submitted_input');
    if (
      !['narration', 'submitted_input'].includes(source) ||
      (source === 'narration'
        ? !prose.includes(quote)
        : !intent.text.includes(quote))
    )
      fail(
        'An effect needs its declared exact ordinary source.',
        'INVALID_EFFECT_SOURCE',
        502,
      );
    const claim =
      effect.claim_kind || (protocol === 2 ? null : 'legacy-unspecified');
    if (
      ![
        'intention',
        'attempt',
        'reported-claim',
        'occurred-event',
        'legacy-unspecified',
      ].includes(claim) ||
      (protocol === 2 && claim === 'legacy-unspecified')
    )
      fail(
        'Declare intention, attempt, reported claim or occurred event.',
        'INVALID_EFFECT_SOURCE',
        502,
      );
    const fact = effect.op === 'remember' ? effect.fact : lookup(effect.id);
    if (modern && source === 'submitted_input') {
      if (
        intent.kind === 'steer' ||
        intent.kind === 'ask' ||
        intent.kind === 'follow'
      )
        fail(
          'Editorial wishes cannot establish a fictional event.',
          'INVALID_EFFECT_SOURCE',
          502,
        );
      if (['resolve', 'reveal', 'adjust', 'introduce'].includes(effect.op))
        fail(
          'An intended or spoken outcome is not occurrence evidence.',
          'INVALID_EFFECT_SOURCE',
          502,
        );
      if (intent.kind === 'say' && performance?.status !== 'performed')
        fail(
          'Unperformed speech cannot establish an uttered promise.',
          'INVALID_EFFECT_SOURCE',
          502,
        );
      if (intent.kind === 'act') {
        const ownedFeeling =
          fact?.kind === 'relationship' &&
          fact.actor_id === intent.character_id &&
          ['remember', 'develop'].includes(effect.op);
        if (ownedFeeling) {
          if (
            protocol === 2 &&
            !['intention', 'reported-claim'].includes(claim)
          )
            fail(
              'An explicitly owned feeling is a submitted personal claim, not proof of an external event.',
              'INVALID_EFFECT_SOURCE',
              502,
            );
        } else if (
          !['intention', 'attempt'].includes(claim) ||
          !['goal', 'fact'].includes(fact?.kind)
        )
          fail(
            'An Act input establishes an intention or attempt, not its outcome.',
            'INVALID_EFFECT_SOURCE',
            502,
          );
      }
    }
    if (
      protocol === 2 &&
      ['resolve', 'reveal', 'adjust', 'introduce'].includes(effect.op) &&
      (source !== 'narration' || claim !== 'occurred-event')
    )
      fail(
        'This operation requires a narrated occurred event.',
        'INVALID_EFFECT_SOURCE',
        502,
      );
    const disposition = effect.resolution_disposition;
    if (effect.op === 'resolve' && fact?.kind === 'goal') {
      if (
        protocol === 2 &&
        !['achieved', 'abandoned', 'failed', 'superseded'].includes(disposition)
      )
        fail(
          'A goal resolution needs its actual disposition.',
          'INVALID_GOAL_DISPOSITION',
          502,
        );
    } else if (disposition !== undefined)
      fail(
        'Only a resolved goal has a resolution disposition.',
        'INVALID_GOAL_DISPOSITION',
        502,
      );
    return {
      ...effect,
      claim_kind: claim,
      source_kind: source,
      ...(effect.op === 'resolve' && fact?.kind === 'goal'
        ? { resolution_disposition: disposition || 'legacy-unspecified' }
        : {}),
    };
  });
}
const ordinaryQuote = (manifest, prose, quote) =>
  manifest.segments.some(
    (segment) =>
      segment.kind === 'narration' &&
      prose.slice(segment.start, segment.end).includes(quote),
  );
module.exports = {
  ordinaryQuote,
  STATUSES,
  sha,
  assemble,
  validateAssembly,
  validateEffectSources,
};
