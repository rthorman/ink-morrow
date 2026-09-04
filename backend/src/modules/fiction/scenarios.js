'use strict';

const { fail } = require('./model');

// Openings are authored world state, not prompts asking a model to invent a
// culprit retroactively. Only the spoiler-free catalogue reaches the reader.
const SCENARIOS = [
  {
    id: 'drowned-bell', title: 'The Drowned Bell', genre: 'mystery',
    tagline: 'A missing map, two sisters, and a promise that may outlive the tide.',
    premise: 'In a harbour town, Mara and her sister Iona meet after the sale of a chart to a submerged bell tower. Let family loyalty matter as much as solving the mystery.',
    opening: 'The bell had been underwater for twenty years. Tonight, someone heard it ring.\n\nMara waited on the quay with two cups of tea. When Iona arrived, she did not take hers. “Tell me the chart is still in your room.”\n\nBehind them, the harbour lights came on one by one.',
    cast: [
      { id: 'mara', name: 'Mara', description: 'A chart-maker who has stayed in the harbour town.', motive: 'Protect Iona without losing her trust.' },
      { id: 'iona', name: 'Iona', description: 'Mara’s sister, a diver newly returned home.', motive: 'Understand what happened to their family’s chart and choose her own future.' },
      { id: 'vale', name: 'Mayor Vale', description: 'The harbour’s quietly influential mayor.', motive: 'Recover the old town records before an expensive dredging project exposes them.' },
    ],
    facts: [
      { id: 'chart-sale', text: 'Mara sold the chart to Mayor Vale to pay for Iona’s diving equipment. Vale is the buyer; this must not change to defeat a deduction.', visibility: 'secret', known_by: ['mara', 'vale'] },
      { id: 'bell-cause', text: 'Vale’s survey crew disturbed the submerged bell while searching for old town records. The bell was not rung by a ghost.', visibility: 'secret', known_by: ['vale'] },
      { id: 'sisters-trust', kind: 'relationship', text: 'The sisters care for each other, but Iona distrusts decisions made on her behalf.', known_by: ['mara', 'iona'] },
      { id: 'iona-chart', kind: 'goal', actor_id: 'iona', text: 'Iona wants to find out what happened to the chart.', known_by: ['iona', 'mara'] },
    ],
    boundaries: 'No graphic violence. No forced betrayal by the reader. Leave room for ordinary care and conversation.',
  },
  {
    id: 'garden-after-rain', title: 'The Garden After Rain', genre: 'cozy',
    tagline: 'Three neighbours reopen a garden. Small acts of care can change what becomes possible.',
    premise: 'A long-closed communal garden reopens after rain. Three neighbours with different hopes decide what to make of it. Treat quiet cooperation as meaningful play, with no hidden catastrophe.',
    opening: 'The gate opened with a sound like a chair being moved across a kitchen floor.\n\nNell brought seedlings. Samir brought a kettle, though there was nowhere to plug it in. Jo brought nothing at all and stood looking at the weeds.\n\n“Well,” Nell said, setting down her tray. “There’s room.”',
    cast: [
      { id: 'nell', name: 'Nell', description: 'An enthusiastic gardener with more seedlings than windowsills.', motive: 'Make something welcoming without taking charge of everyone.' },
      { id: 'samir', name: 'Samir', description: 'A neighbour who likes practical problems and good tea.', motive: 'Feel useful and build a place where people will stay a while.' },
      { id: 'jo', name: 'Jo', description: 'A quiet newcomer who notices the small things.', motive: 'Find a way to belong without being put on the spot.' },
    ],
    facts: [
      { id: 'open-garden', kind: 'goal', text: 'The neighbours want to make the garden welcoming, but have not agreed what it should become.', known_by: ['nell', 'samir', 'jo'] },
      { id: 'water-tap', text: 'There is a working water tap beside the gate.', known_by: ['nell', 'samir', 'jo'] },
    ],
    boundaries: 'No sudden catastrophe, compulsory romance, combat, or punishment for resting. Gentle disagreements and unfinished conversations are welcome.',
  },
];

function catalogue() {
  return SCENARIOS.map(({ id, title, genre, tagline, premise, boundaries }) => ({ id, title, genre, tagline, premise, boundaries }));
}

function scenarioInput(input) {
  if (input.scenario_id === undefined || input.scenario_id === null) return input;
  const preset = SCENARIOS.find((entry) => entry.id === input.scenario_id);
  if (!preset) fail('Choose a known opening.', 'SCENARIO_NOT_FOUND', 404);
  if (input.cast !== undefined && !Array.isArray(input.cast)) fail('Cast must be an array.');
  if (input.facts !== undefined && !Array.isArray(input.facts)) fail('Facts must be an array.');
  const base = structuredClone(preset); delete base.id; delete base.tagline;
  const overrides = { ...input }; delete overrides.scenario_id;
  return { ...structuredClone(base), ...overrides, opening: overrides.opening || base.opening,
    cast: [...structuredClone(base.cast), ...(overrides.cast || [])], facts: [...structuredClone(base.facts), ...(overrides.facts || [])] };
}

module.exports = { catalogue, scenarioInput };
