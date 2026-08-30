'use strict';

import {
  approxCostText,
  estimatePageCost,
  ROUGH_TEXT_CALL_ESTIMATE,
} from '../app/core/cost.js';

describe('Cost ballparks', () => {
  it('uses a conservative numeric text-call estimate before catalogue pricing arrives', () => {
    expect(estimatePageCost({ models: [], model: null, wordsPerPage: 400, pageChars: 0 }))
      .toBe(ROUGH_TEXT_CALL_ESTIMATE);
    expect(estimatePageCost({ models: [], model: 'not-loaded-yet', wordsPerPage: 400, pageChars: 5000 }))
      .toBe(ROUGH_TEXT_CALL_ESTIMATE);
  });

  it('uses catalogue pricing when it is available', () => {
    const estimate = estimatePageCost({
      models: [{ id: 'priced', pricing: { prompt_per_mtok: 2, completion_per_mtok: 8 } }],
      model: 'priced',
      wordsPerPage: 400,
      pageChars: 4000,
    });
    expect(estimate).toBeCloseTo(0.0092, 8);
  });

  it('never renders missing pricing as unknown or unavailable', () => {
    const label = approxCostText(null);
    expect(label).toContain('rough ballpark');
    expect(label).not.toMatch(/unknown|unavailable/i);
  });
});
