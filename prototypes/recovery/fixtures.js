// Synthetic examples only. No production adapters, private data or credentials.
export const story = {
  title: 'The House of Small Hours',
  subtitle: 'A story about what we keep, and what we let back in.',
  world: 'Greyhaven', scribe: 'The attentive observer', episode: 'A light in the kitchen',
  passages: [
    { title: 'The key beneath the pot', scene: 'At the threshold', paragraphs: [
      'The spare key was exactly where her mother had said it would be, beneath the pot that had never successfully grown anything. Mara turned it over in her palm. Someone had tied a little blue thread through its bow.',
      'Behind her, the last bus exhaled and went on towards the coast. She had brought one bag. It seemed an insufficient quantity of luggage for returning after twelve years.',
      'Inside the house, a chair moved across the kitchen floor. Then her brother called, “You can come in, you know.”',
      '“I can stay until Sunday,” she called back. “Sunday, then,” he said. Mara put the empty pot back carefully. It was a small delay, and she allowed herself the whole of it.',
    ] },
    { title: 'Two cups, no questions', scene: 'In the kitchen', paragraphs: [
      'Elias had set out two cups. Not the good ones, which would have made this an occasion, but the heavy brown mugs they had used as children. A crack ran through the handle of hers. He had turned it towards the wall.',
      '“I thought you took sugar,” he said.',
      '“I did.” She sat down. “I don’t now.”',
      'He moved the bowl away without comment. Outside, rain began to stipple the back step. Neither of them mentioned the unlit room upstairs.',
      'For a while they listened to the kettle cooling. Mara had rehearsed an apology on the bus, but here, with the ordinary cups between them, every version sounded like a speech. She let her hands warm instead.',
    ] },
    { title: 'The kindness of a small task', scene: 'In the kitchen', paragraphs: [
      'The kitchen clock had stopped at twenty past four. Elias stood beneath it with a battery in one hand and the expression of someone who had forgotten why he had crossed a room.',
      '“You’ll need the chair,” Mara said.',
      '“The chair wobbles.”',
      'She got up and held its back. He glanced at her, then climbed. For a moment they were simply two people fixing a clock; she found she could bear that much of being home.',
      'When the second hand began to move, neither spoke. Elias climbed down and left his hand on the chair beside hers, close enough that she could choose what happened next.',
    ] },
  ],
};

export const facts = [
  { id: 'promise', category: 'Commitments', title: 'Mara will stay until Sunday', detail: 'An agreed departure date, not a promise to stay permanently.', quote: 'I can stay until Sunday.', source: 'Arrival conversation', at: 0, private: false },
  { id: 'relationship', category: 'People', title: 'Elias makes space without asking', detail: 'Practical cooperation is possible. Reconciliation has not been established.', quote: 'He moved the bowl away without comment.', source: 'Two cups, no questions', at: 1, private: false },
  { id: 'clock', category: 'World', title: 'The kitchen clock is running', detail: 'Mara held the chair while Elias replaced the battery.', quote: 'When the second hand began to move, neither spoke.', source: 'The kindness of a small task', at: 2, private: false },
  { id: 'secret', category: 'Private planning', title: 'The letter in the upstairs room', detail: 'Owner planning only. Neither sibling has read it. It must not appear in Ask, public recall or a book.', quote: '', source: 'Private world reference', at: 0, private: true },
];

export const assets = [
  { id: 'cover', title: 'A house with a light still on', kind: 'Cover concept', file: 'hero-scriptorium-tablet-portrait.webp', placement: 'Cover', note: 'Existing brand artwork used as a composition placeholder.' },
  { id: 'window', title: 'Rain beyond the kitchen', kind: 'Passage art concept', file: 'moth-archive.webp', placement: 'Passage 2', note: 'Concept placeholder, not a generated story illustration.' },
  { id: 'portrait', title: 'A study for Mara', kind: 'Private reference concept', file: 'cinder-cast.webp', placement: 'Unplaced', note: 'Private reference; excluded from books.' },
];

export const capabilities = [
  ['Five story rooms and branded Library', 'Restored in batch', 'B1', 'B0 interactive composition; runtime adapters still required.'],
  ['Current catalogue studios and unsaved AI development', 'Current V5', 'B3 deepens', 'Keep world/character/Scribe selection, uploads and reviewed development.'],
  ['Reader pagination and recoverable Continue errors', 'Current V5', 'B1 deepens', 'No purchase on page turns; stable reading position.'],
  ['All-path fiction graph, evidence and corrections', 'Current V5', 'B2 deepens', 'Current-ancestry inspection and exact source evidence.'],
  ['First-class Scribe craft and full story-local references', 'Restored in batch', 'B3', 'Explicit field inventory and future-only adoption.'],
  ['Optional scenes, viewpoint and chapter/volume grouping', 'Restored in batch', 'B3/B4', 'Plans are not events; grouping changes no prose.'],
  ['Ownership / Act / Say / Ask / Direct boundaries', 'Current V5', 'B3 deepens', 'No compulsory avatar or Session Zero; performed speech remains conditional.'],
  ['Alternate paths and exact fork points', 'Current V5', 'B2 deepens', 'One fiction graph; do not restore separate Play transcripts.'],
  ...['Relationships', 'Promises', 'Debts', 'Knowledge boundaries', 'Secrets', 'NPC goals', 'Factions', 'Quests', 'Conditions', 'Inventory', 'Resources', 'World time', 'Deadlines', 'Progress clocks'].map(kind => [
    `Campaign: ${kind}`, 'Restored in batch', 'B2/B3', 'Map to existing V5 facts or a typed revision; visibility/evidence/save contract required. Not a claim of a new implemented ledger.',
  ]),
  ['Art upload, explicit painting, cover and passage placement', 'Current V5', 'B5 deepens', 'Add complete unplaced inventory; no automatic placement or purchase.'],
  ['Read-aloud, cached playback and audiobooks', 'Restored in batch', 'B6', 'Immutable source and reviewed explicit synthesis.'],
  ['Nine book formats and private complete playable saves', 'Current V5', 'B7 deepens', 'Source preview, editions and all-path closure.'],
  ['Public immutable snapshot sharing', 'Restored in batch', 'B7', 'Hide until functional; private export independent.'],
  ...['Dice', 'Likelihood oracle', 'Weighted table', 'Deck', 'User-defined fields', 'Progress clock'].map(kind => [`Solo tool: ${kind}`, 'Deliberately deferred', 'B9', 'Local, replay-safe results on the same ancestry/save graph.']),
  ['Manual prose / bounded copyediting', 'Policy gated', 'D1', 'No prose editor in this prototype.'],
  ['V4.1 archive/database conversion', 'Policy gated', 'D2', 'Separate previewed copy importer, never in-place adoption.'],
  ['Reference-image conditioning', 'Policy gated', 'D3', 'Separate per-asset exposure review.'],
  ['New public release number', 'Policy gated', 'D4', 'Archive tag does not declare a recovery release.'],
  ['Authentication, provider accounting and private projection', 'Current V5', 'Every batch', 'Prototype Lock is a demonstration, not authentication.'],
  ['Async progress, recoverable drafts and error lifecycle', 'Restored in batch', 'B1/B2', 'Prototype stores only synthetic drafts in tab session storage; production needs server acknowledgements.'],
];
