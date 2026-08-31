'use strict';

// Worlds and characters CRUD + entity reference-image endpoints. Paths and
// response shapes are unchanged from the monolith.
//
// The additive `generate_image` boolean (default true, preserving old-client
// behavior) lets the client offer "Create without image".

const express = require('express');
const { badRequest, notFound } = require('../../core/http');

function createCatalogRouter({ store, imageQueue, imageStore, stories }) {
  const router = express.Router();

  function serveEntityImage(kind, req, res) {
    const row = kind === 'world' ? store.getWorld(req.params.id) : store.getCharacter(req.params.id);
    if (!row) return notFound(res, 'Not found');
    if (row.image_status !== 'ready') {
      return res.status(404).json({ error: kind === 'world' ? 'World has no image yet.' : 'Character has no image yet.' });
    }
    const image = imageStore.readImage(kind, row.id);
    if (!image) return notFound(res, 'Image file is missing');
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(image.buffer);
  }

  // -- entity reference images -------------------------------------------------

  router.get('/api/worlds/:id/image', (req, res) => serveEntityImage('world', req, res));
  router.post('/api/worlds/:id/image', (req, res) => {
    const world = store.getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    imageQueue.enqueue('world', world.id);
    return res.json({ image_status: 'pending' });
  });

  router.get('/api/characters/:id/image', (req, res) => serveEntityImage('character', req, res));
  router.post('/api/characters/:id/image', (req, res) => {
    const character = store.getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    imageQueue.enqueue('character', character.id);
    return res.json({ image_status: 'pending' });
  });

  // -- worlds --------------------------------------------------------------------

  router.get('/api/worlds', (req, res) => {
    res.json({ worlds: store.listWorlds() });
  });

  router.get('/api/worlds/:id', (req, res) => {
    const world = store.getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    res.json({ world });
  });

  router.post('/api/worlds', (req, res) => {
    const payload = store.validateWorldCreatePayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    const { id } = store.createWorld(payload);
    if (wantsImage(req.body)) imageQueue.enqueue('world', id, { auto: true }); // reference image in the background
    res.status(201).json({ world: store.getWorld(id) });
  });

  router.put('/api/worlds/:id', (req, res) => {
    const world = store.getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    const payload = store.validateWorldUpdatePayload(req.body, world);
    if (payload.error) return badRequest(res, payload.error);
    const updated = store.updateWorld(world, payload);
    // Worlds are live canonical prompt context. Existing and in-flight
    // prepared prose must not survive a lore/world edit.
    stories.invalidatePreviewsForWorld(world.id);
    res.json({ world: updated });
  });

  router.delete('/api/worlds/:id', (req, res) => {
    const world = store.getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    const { characters, stories: storyCount } = store.worldReferenceCounts(world.id);
    if (characters > 0 || storyCount > 0) {
      return res.status(409).json({
        error: `World is referenced by ${characters} character(s) and ${storyCount} story(ies). Delete or reassign them first.`,
      });
    }
    store.deleteWorld(world.id);
    imageStore.deleteImage('world', world.id); // never leave orphans
    res.status(204).end();
  });

  // -- characters ------------------------------------------------------------------

  router.get('/api/characters', (req, res) => {
    const { world_id } = req.query;
    res.json({ characters: store.listCharacters(world_id) });
  });

  router.get('/api/characters/:id', (req, res) => {
    const character = store.getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    res.json({ character });
  });

  router.post('/api/characters', (req, res) => {
    const payload = store.validateCharacterPayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    const { id } = store.createCharacter(payload);
    if (wantsImage(req.body)) imageQueue.enqueue('character', id, { auto: true }); // reference portrait in the background
    res.status(201).json({ character: store.getCharacter(id) });
  });

  router.put('/api/characters/:id', (req, res) => {
    const character = store.getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    const payload = store.validateCharacterPayload(req.body, { partial: true, existing: character });
    if (payload.error) return badRequest(res, payload.error);
    res.json({ character: store.updateCharacter(character.id, payload) });
  });

  router.delete('/api/characters/:id', (req, res) => {
    const character = store.getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    // Remove the character from any story casts that reference it
    stories.removeCharacterFromCasts(character.id);
    store.deleteCharacter(character.id);
    imageStore.deleteImage('character', character.id); // never leave orphans
    res.status(204).end();
  });

  // `generate_image` is additive: omitted (or any non-false value) preserves
  // the old create-and-paint behavior; only an explicit false skips painting.
  function wantsImage(body) {
    return body.generate_image !== false;
  }

  return router;
}

module.exports = { createCatalogRouter };
