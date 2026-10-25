'use strict';
const CATGIRL_CANON = Object.freeze({
  entity_kind: 'catgirl',
  definition: 'An unmistakably adult human woman with exactly one natural feline tail and one pair of natural feline ears.',
});

const ENUMS = Object.freeze({
  diction: ['plain', 'balanced', 'ornate'],
  sentence_rhythm: ['clipped', 'varied', 'flowing'],
  narrative_distance: ['intimate', 'flexible', 'observational'],
  figurative_language: ['restrained', 'balanced', 'abundant'],
  description_density: ['lean', 'balanced', 'immersive'],
  dialogue_tendency: ['sparse', 'balanced', 'dialogue-led'],
  exposition_style: ['explicit', 'balanced', 'implicit'],
  humor: ['none', 'restrained', 'dry', 'warm', 'dark', 'playful'],
  scene_tempo: ['contemplative', 'measured', 'brisk'],
  progress_appetite: ['linger', 'develop', 'advance'],
  tension_tolerance: ['low', 'medium', 'high'],
  aftermath_dwell: ['brief', 'balanced', 'patient'],
});

const DEFAULTS = Object.freeze({
  diction: 'balanced', sentence_rhythm: 'varied', narrative_distance: 'flexible',
  figurative_language: 'balanced', description_density: 'balanced', dialogue_tendency: 'balanced',
  exposition_style: 'balanced', humor: 'restrained', scene_tempo: 'measured',
  progress_appetite: 'develop', tension_tolerance: 'medium', aftermath_dwell: 'balanced',
});

const FOCUS_AREAS = Object.freeze([
  'interiority', 'relationships', 'dialogue', 'action', 'sensory-detail', 'setting',
  'world-systems', 'mystery', 'theme', 'humor', 'consequences',
]);

module.exports={CATGIRL_CANON,ENUMS,DEFAULTS,FOCUS_AREAS};
