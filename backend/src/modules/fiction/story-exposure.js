'use strict';
const { qualityPlan } = require('./quality-plan');
function createStoryExposure(providers) {
  const expose = (story) => ({
    ...story,
    quality_generation: qualityPlan(story.state, providers),
    generation:
      providers?.exposure('scribe', {
        data_categories: [
          'story premise',
          'selected cast and frozen world/Scribe references',
          'boundaries',
          'relevant facts including hidden world truth',
          'bounded recent prose',
          'reader direction',
        ],
        operation_count: 1,
      }) || null,
    illustration_generation:
      providers?.exposure('illustrator', {
        data_categories: [
          'selected story passage or visible image-target description',
          'art direction',
        ],
        operation_count: 1,
      }) || null,
  });
  return expose;
}
module.exports = { createStoryExposure };
