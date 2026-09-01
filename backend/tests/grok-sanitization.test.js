'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const axios = require('axios');
const { createTestApp, createStory, addPage } = require('./helpers');
const { resetModelCache } = require('../src/ai');
const {
  adapterForImageModel,
  GROK_ADAPTER,
  GENERIC_ADAPTER,
} = require('../src/modules/imagery/provider-adapters');

jest.mock('axios');

async function raster() {
  return sharp({
    create: {
      width: 10,
      height: 8,
      channels: 4,
      background: { r: 51, g: 28, b: 79, alpha: 1 },
    },
  }).png().toBuffer();
}

function chatResponse(content) {
  return {
    data: {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 60 },
    },
  };
}

describe('PR 08 Grok sanitation adapter', () => {
  let fixture;
  let imageDir;
  let previousImageModel;

  beforeEach(() => {
    previousImageModel = process.env.IMAGE_MODEL;
    process.env.IMAGE_MODEL = 'x-ai/grok-imagine-image-2.0';
    axios.post.mockReset();
    axios.get.mockReset();
    resetModelCache();
    axios.get.mockResolvedValue({
      data: {
        data: [{
          id: 'z-ai/glm-5.1',
          name: 'Sanitation model',
          pricing: { prompt: '0.000001', completion: '0.000002' },
        }],
      },
    });
    imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-grok-adapter-'));
    fixture = createTestApp({
      imageDir,
      providerOptions: { env: { OPENROUTER_API_KEY: 'grok-adapter-test-key' } },
    });
  });

  afterEach(() => {
    fixture.close();
    fs.rmSync(imageDir, { recursive: true, force: true });
    if (previousImageModel === undefined) delete process.env.IMAGE_MODEL;
    else process.env.IMAGE_MODEL = previousImageModel;
  });

  it('selects Grok narrowly and keeps generic-provider wording isolated', () => {
    expect(adapterForImageModel('x-ai/grok-imagine-image-2.0')).toBe(GROK_ADAPTER);
    expect(adapterForImageModel('vendor/GROK-preview')).toBe(GROK_ADAPTER);
    expect(adapterForImageModel('vendor/painter-v1')).toBe(GENERIC_ADAPTER);
    expect(GROK_ADAPTER.renderablePromptInstruction).toContain('GROK RENDERABILITY');
    expect(GENERIC_ADAPTER.renderablePromptInstruction).toBeNull();
    expect(GENERIC_ADAPTER.displayName).not.toMatch(/grok/i);
  });

  it('announces one refusal, bills one sanitation call, waits, and never mutates a reference asset', async () => {
    const story = await createStory(fixture.app, null, [], { title: 'Adapter Tale' });
    const page = await addPage(fixture.app, story.id, 'A charged hall at midnight, rendered through shadow and distance.');
    await fixture.app.locals.artStore.ready;
    const created = await fixture.app.locals.artStore.createFromBuffer({
      storyId: story.id,
      source: 'uploaded',
      buffer: await raster(),
      declaredMediaType: 'image/png',
      title: 'Owner reference',
      altText: 'A private reference image.',
      providerReferenceAllowed: true,
    });
    const assetId = created.asset.id;
    const beforeRow = fixture.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
    const assetPath = path.join(imageDir, 'assets', beforeRow.storage_key);
    const beforeBytes = fs.readFileSync(assetPath);

    let imageCalls = 0;
    let sanitationCalls = 0;
    axios.post.mockImplementation((url, body) => {
      if (String(url).endsWith('/images')) {
        imageCalls += 1;
        if (imageCalls === 1) {
          return Promise.reject({
            response: { status: 400, data: { error: { message: 'reference composition rejected by moderation' } } },
          });
        }
        return Promise.resolve({
          data: {
            data: [{ b64_json: beforeBytes.toString('base64'), media_type: 'image/webp' }],
            usage: { cost: 0.04 },
          },
        });
      }
      if (String(url).endsWith('/chat/completions')) {
        sanitationCalls += 1;
        expect(body.messages[0].content).toContain('specifically for Grok');
        expect(body.messages[1].content).toContain('<provider-reason>reference composition rejected by moderation</provider-reason>');
        return Promise.resolve(chatResponse(
          'A moonlit stone hall in a restrained storybook composition, with every adult figure fully clothed, safely framed at a distance, recognizable by silhouette and color, and no text or graphic detail.'
        ));
      }
      throw new Error(`Unexpected provider call: ${url}`);
    });

    const first = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${page.page_number}/scene-image`)
      .send({ prompt: 'The refused draft.', reference_asset_ids: [assetId] })
      .expect(200);

    expect(first.body).toMatchObject({
      refused: true,
      adapter: 'grok',
      reason: 'reference composition rejected by moderation',
      sanitation_cost_usd: 0.00024,
      sanitation_billed_attempts: 1,
      references_sent: 1,
      can_drop_references: true,
    });
    expect(first.body.sanitized_prompt).toContain('fully clothed');
    expect(first.body).not.toHaveProperty('image');
    expect(imageCalls).toBe(1);
    expect(sanitationCalls).toBe(1);
    expect(fixture.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId)).toEqual(beforeRow);
    expect(fs.readFileSync(assetPath)).toEqual(beforeBytes);

    const second = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${page.page_number}/scene-image`)
      .send({ prompt: first.body.sanitized_prompt, reference_asset_ids: [assetId], drop_references: true })
      .expect(200);

    expect(second.body.refused).toBeUndefined();
    expect(second.body.references).toEqual([]);
    expect(second.body.asset_references).toEqual([]);
    expect(imageCalls).toBe(2);
    expect(sanitationCalls).toBe(1);
    const lastImageBody = axios.post.mock.calls.filter(([url]) => String(url).endsWith('/images')).at(-1)[1];
    expect(lastImageBody.input_references).toBeUndefined();
    expect(fixture.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId)).toEqual(beforeRow);
    expect(fs.readFileSync(assetPath)).toEqual(beforeBytes);
  });

  it('does not sanitize or use Grok wording for a non-Grok image provider rejection', async () => {
    process.env.IMAGE_MODEL = 'vendor/painter-v1';
    const story = await createStory(fixture.app, null, [], { title: 'Generic Provider Tale' });
    const page = await addPage(fixture.app, story.id, 'A quiet landscape.');
    axios.post.mockRejectedValue({
      response: { status: 400, data: { error: { message: 'invalid aspect ratio' } } },
    });

    const response = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${page.page_number}/scene-image`)
      .send({ prompt: 'A quiet landscape.' })
      .expect(400);

    expect(response.body.code).toBe('IMAGE_PROVIDER_REJECTED');
    expect(response.body.error).toContain('OpenRouter rejected the image request');
    expect(response.body.error).not.toMatch(/grok|saniti/i);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(String(axios.post.mock.calls[0][0])).toMatch(/\/images$/);

    axios.post.mockReset();
    axios.post.mockResolvedValue(chatResponse(
      'A quiet painted landscape opens beneath a pale sky, with layered hills, a narrow river, wind-shaped trees, and soft evening light establishing depth. The balanced composition uses restrained color and visible natural detail, with no lettering, caption, logo, watermark, people, or graphic imagery anywhere in the frame.'
    ));
    await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${page.page_number}/image-prompt`)
      .send({})
      .expect(200);
    const condensation = axios.post.mock.calls[0][1].messages[1].content;
    expect(condensation).not.toMatch(/grok/i);
  });

  it('adds the Grok renderability contract to the visible prompt condensation input', async () => {
    const story = await createStory(fixture.app, null, [], { title: 'Renderable Tale', tone: 'explicit' });
    const page = await addPage(fixture.app, story.id, 'The adult scene is conveyed through shadow, drapery, and charged stillness.');
    axios.post.mockResolvedValue(chatResponse(
      'A candlelit stone chamber framed in deep violet shadow, with fully draped adult figures shown at a respectful distance in recognizable silhouette. Soft window light traces their clothing and expressions while the quiet composition preserves charged atmosphere, architectural detail, and restrained storybook drama without text or graphic detail.'
    ));

    await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${page.page_number}/image-prompt`)
      .send({})
      .expect(200);

    const requestBody = axios.post.mock.calls[0][1];
    expect(requestBody.messages[1].content).toContain('GROK RENDERABILITY');
    expect(requestBody.messages[1].content).toContain('fully clothed or safely draped');
  });
});
