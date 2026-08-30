'use strict';

// Story-storage aggregation and EPUB export. Large media stays on disk; this
// route reports its real footprint so the Stories surface can manage it.

const express = require('express');
const { notFound } = require('../../core/http');
const { buildEpub } = require('../../epub');

function createLibraryRouter({ db, catalog, stories, continuity, imageStore, audiobooks }) {
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
      stories: storyRows.map((story) => {
        let coverImage;
        try { coverImage = imageStore.readImage('story', story.id); } catch { coverImage = null; }
        const audiobook = (() => {
          const row = audiobooks.getAudiobook(story.id);
          return row ? audiobooks.audiobookWithMeta(row, story) : null;
        })();
        const plates = platesByStory.get(story.id) || [];
        const firstPage = db.prepare(
          "SELECT SUBSTR(content, 1, 1200) AS content FROM story_pages WHERE story_id = ? AND image_media_type IS NULL AND TRIM(content) <> '' ORDER BY page_number LIMIT 1"
        ).get(story.id);
        const diskBytes =
          (coverImage ? coverImage.buffer.length : 0) +
          plates.reduce((sum, plate) => sum + (plate.size_bytes || 0), 0) +
          (audiobook && audiobook.status === 'ready' && !audiobook.file_missing ? audiobook.size_bytes || 0 : 0);
        return {
          id: story.id,
          title: story.title,
          updated_at: story.updated_at,
          excerpt: firstPage?.content || null,
          disk_bytes: diskBytes,
          asset_count:
            (coverImage ? 1 : 0) +
            plates.filter((plate) => plate.size_bytes !== null).length +
            (audiobook && audiobook.status === 'ready' && !audiobook.file_missing ? 1 : 0),
          cover: {
            status: story.image_status || 'none',
            size_bytes: coverImage ? coverImage.buffer.length : null,
            cost_usd: story.image_cost_usd,
            file_missing: story.image_status === 'ready' && !coverImage,
          },
          audiobook,
          plates,
        };
      }),
    });
  });

  router.get('/api/stories/:id/export', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const world = story.world_id ? catalog.getWorld(story.world_id) : null;
    const characters = continuity.contextForPrompt(story).characters
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
