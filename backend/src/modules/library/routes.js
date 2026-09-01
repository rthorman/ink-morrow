'use strict';

// Story-storage aggregation and EPUB export. Large media stays on disk; this
// route reports its real footprint so the Stories surface can manage it.

const express = require('express');
const { notFound } = require('../../core/http');
const { buildEpub } = require('../../epub');

function createLibraryRouter({ db, catalog, stories, continuity, imageStore, artStore, audiobooks }) {
  const router = express.Router();

  router.get('/api/storage', (req, res) => {
    const storyRows = stories.listStories();
    const platesByStory = new Map();
    for (const story of storyRows) {
      const pageNumberById = new Map(stories.storyPages(story.id).map((page) => [page.id, page.page_number]));
      const art = artStore.list(story.id);
      const placementsByAsset = new Map();
      for (const placement of art.placements) {
        if (!placementsByAsset.has(placement.asset_id)) placementsByAsset.set(placement.asset_id, []);
        placementsByAsset.get(placement.asset_id).push({
          id: placement.id,
          after_page_id: placement.after_page_id,
          after_page_number: placement.after_page_id ? pageNumberById.get(placement.after_page_id) || null : null,
          ordinal: placement.ordinal,
        });
      }
      platesByStory.set(story.id, art.assets.map((asset) => ({
        asset_id: asset.id,
        source: asset.source,
        title: asset.title,
        alt_text: asset.alt_text,
        size_bytes: asset.size_bytes,
        content_url: asset.content_url,
        placements: placementsByAsset.get(asset.id) || [],
      })));
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
          "SELECT SUBSTR(content, 1, 1200) AS content FROM story_pages WHERE story_id = ? AND TRIM(content) <> '' ORDER BY page_number LIMIT 1"
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

    const pages = stories.storyPages(story.id).map((page) => ({ ...page, art: [] }));
    const pageById = new Map(pages.map((page) => [page.id, page]));
    const art = artStore.list(story.id);
    const assetById = new Map(art.assets.map((asset) => [asset.id, asset]));
    for (const placement of art.placements) {
      const asset = assetById.get(placement.asset_id);
      const target = placement.after_page_id ? pageById.get(placement.after_page_id) : pages[0];
      if (!asset || !target) continue;
      const image = artStore.readAsset(story.id, asset.id);
      if (!image) continue;
      target.art.push({
        id: asset.id,
        data: image.buffer,
        mediaType: image.mediaType,
        alt: asset.alt_text || asset.title || 'Story illustration',
        before: placement.after_page_id === null,
        ordinal: placement.ordinal,
      });
    }
    for (const page of pages) page.art.sort((left, right) => Number(right.before) - Number(left.before) || left.ordinal - right.ordinal);

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
