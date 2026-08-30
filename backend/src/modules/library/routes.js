'use strict';

// Library routes: read-only aggregation for kept media (Bookshelf) and the
// EPUB export. No creation queues or story editing live here.

const express = require('express');
const { notFound } = require('../../core/http');
const { buildEpub } = require('../../epub');
const { normalizeCast } = require('../stories/cast');

function createLibraryRouter({ db, catalog, stories, imageStore, audiobooks }) {
  const router = express.Router();

  router.get('/api/storage', (req, res) => {
    const storyRows = stories.listStories();
    const plateRows = db
      .prepare('SELECT id, story_id, page_number, image_prompt FROM story_pages WHERE image_media_type IS NOT NULL ORDER BY story_id, page_number')
      .all();
    const platesByStory = new Map();
    for (const plate of plateRows) {
      let buffer;
      try { buffer = imageStore.readImage('page', plate.id)?.buffer; } catch { buffer = null; }
      const entry = { page_number: plate.page_number, image_prompt: plate.image_prompt || null, size_bytes: buffer ? buffer.length : null };
      if (!platesByStory.has(plate.story_id)) platesByStory.set(plate.story_id, []);
      platesByStory.get(plate.story_id).push(entry);
    }
    res.json({
      stories: storyRows.map((story) => ({
        id: story.id,
        title: story.title,
        updated_at: story.updated_at,
        audiobook: (() => {
          const row = audiobooks.getAudiobook(story.id);
          return row ? audiobooks.audiobookWithMeta(row, story) : null;
        })(),
        plates: platesByStory.get(story.id) || [],
      })),
    });
  });

  router.get('/api/stories/:id/export', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const world = story.world_id ? catalog.getWorld(story.world_id) : null;
    const cast = normalizeCast(JSON.parse(story.characters || '[]'));
    const characters = cast
      .map(({ id, role }) => {
        const character = catalog.getCharacter(id);
        return character ? { ...character, role } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.role === 'mc' ? -1 : b.role === 'mc' ? 1 : 0));

    // Painted plates travel inside the book: each image page contributes its
    // bytes (a missing file degrades to a text-only page rather than a broken export).
    const pages = stories.storyPages(story.id).map((page) => {
      if (!page.image_media_type) return page;
      const image = imageStore.readImage('page', page.id);
      return image ? { ...page, image: { data: image.buffer, mediaType: image.mediaType } } : page;
    });

    const epub = buildEpub({
      title: story.title,
      world,
      characters,
      pages,
    });

    const filename = `${story.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story'}.epub`;
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(epub);
  });

  return router;
}

module.exports = { createLibraryRouter };
