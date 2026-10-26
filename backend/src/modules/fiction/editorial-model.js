'use strict';
const { keys, text, fail } = require('./model');
const { identifier } = require('./creative-model');
const { canonical } = require('./drafts');
const FIELDS = [
  'id',
  'title',
  'volume_id',
  'after_beat_id',
  'through_beat_id',
  'open_tail',
];
function exact(value, fields, label) {
  keys(value, fields, label);
  if (fields.some((key) => !Object.hasOwn(value, key)))
    fail(`${label} is incomplete.`, 'INVALID_EDITORIAL');
}
function layout(value, position) {
  exact(value, ['version', 'volumes', 'chapters'], 'Editorial layout');
  if (
    value.version !== 1 ||
    !Array.isArray(value.volumes) ||
    !value.volumes.length ||
    value.volumes.length > 64 ||
    !Array.isArray(value.chapters) ||
    !value.chapters.length ||
    value.chapters.length > 512
  )
    fail('Use 1–64 volumes and 1–512 chapters.', 'INVALID_EDITORIAL');
  if (Buffer.byteLength(canonical(value)) > 65536)
    fail('The editorial layout exceeds 64 KiB.', 'EDITORIAL_TOO_LARGE', 413);
  const ids = new Set();
  const volumes = value.volumes.map((volume) => {
    exact(volume, ['id', 'title'], 'Volume');
    const id = identifier(volume.id);
    if (ids.has(id)) fail('Editorial identities must be unique.');
    ids.add(id);
    return { id, title: text(volume.title, 'Volume title', 200) };
  });
  const volumeOrder = new Map(
    volumes.map((volume, index) => [volume.id, index]),
  );
  let previousEnd = -1,
    previousVolume = -1;
  const at = (id) =>
    id === null ? -1 : position(identifier(id, 'Passage anchor'));
  const chapters = value.chapters.map((chapter, index) => {
    exact(chapter, FIELDS, 'Chapter');
    const id = identifier(chapter.id);
    if (ids.has(id)) fail('Editorial identities must be unique.');
    ids.add(id);
    const volume = volumeOrder.get(chapter.volume_id);
    if (volume === undefined || volume < previousVolume)
      fail('Chapters must follow their volume order.', 'INVALID_EDITORIAL');
    previousVolume = volume;
    if (
      typeof chapter.open_tail !== 'boolean' ||
      chapter.open_tail !== (index === value.chapters.length - 1) ||
      (chapter.open_tail && chapter.through_beat_id !== null)
    )
      fail('Only the last chapter is the open tail.', 'INVALID_EDITORIAL');
    const after = at(chapter.after_beat_id),
      through = chapter.open_tail ? Infinity : at(chapter.through_beat_id);
    if (after < previousEnd || through < after)
      fail(
        'Chapter ranges must be chronological and cannot overlap.',
        'INVALID_EDITORIAL',
      );
    previousEnd = through;
    return {
      id,
      title: text(chapter.title, 'Chapter title', 200),
      volume_id: chapter.volume_id,
      after_beat_id: chapter.after_beat_id,
      through_beat_id: chapter.through_beat_id,
      open_tail: chapter.open_tail,
    };
  });
  return { version: 1, volumes, chapters };
}
function defaultLayout(rows, title) {
  const chapters = [];
  for (const row of rows) {
    let chapter = chapters.at(-1);
    if (!chapter || chapter.episode_number !== row.episode_number) {
      if (chapter) {
        chapter.through_beat_id = chapter.last;
        chapter.open_tail = false;
      }
      chapter = {
        id: 'auto-chapter-' + row.id,
        title: row.episode_title || 'The beginning',
        volume_id: 'auto-volume',
        after_beat_id: chapters.at(-1)?.last || null,
        through_beat_id: null,
        open_tail: true,
        episode_number: row.episode_number,
        last: row.id,
      };
      chapters.push(chapter);
    }
    chapter.last = row.id;
  }
  if (!chapters.length)
    chapters.push({
      id: 'auto-chapter-empty',
      title: 'The beginning',
      volume_id: 'auto-volume',
      after_beat_id: null,
      through_beat_id: null,
      open_tail: true,
    });
  return {
    version: 1,
    volumes: [{ id: 'auto-volume', title }],
    chapters: chapters.map((chapter) =>
      Object.fromEntries(FIELDS.map((key) => [key, chapter[key]])),
    ),
  };
}
function resolve(value, rows, { virtual = false } = {}) {
  const positions = new Map(rows.map((row, index) => [row.id, index]));
  const normalized = virtual
    ? value
    : layout(value, (id) => {
        if (!positions.has(id))
          fail(
            'An editorial anchor is not a narrative passage on this path.',
            'EDITORIAL_ANCHOR_INVALID',
            409,
          );
        return positions.get(id);
      });
  const groups = [];
  let cursor = 0;
  for (const chapter of normalized.chapters) {
    const start =
      chapter.after_beat_id === null
        ? 0
        : positions.get(chapter.after_beat_id) + 1;
    const end = chapter.open_tail
      ? rows.length - 1
      : chapter.through_beat_id === null
        ? -1
        : positions.get(chapter.through_beat_id);
    if (start > cursor)
      groups.push({
        id: 'unassigned-' + rows[cursor].id,
        title: 'Unassigned passages',
        volume_id: chapter.volume_id,
        automatic: true,
        open_tail: false,
        first_beat_id: rows[cursor].id,
        last_beat_id: rows[start - 1].id,
        start: cursor,
        end: start - 1,
        count: start - cursor,
      });
    groups.push({
      ...chapter,
      automatic: false,
      first_beat_id: end >= start ? rows[start].id : null,
      last_beat_id: end >= start ? rows[end].id : null,
      start,
      end,
      count: Math.max(0, end - start + 1),
    });
    cursor = Math.max(cursor, end + 1);
  }
  return { layout: normalized, groups };
}
const remapLayout = (value, beatRef) => ({
  ...value,
  volumes: value.volumes.map((volume) => ({ ...volume })),
  chapters: value.chapters.map((chapter) => ({
    ...chapter,
    after_beat_id: beatRef(chapter.after_beat_id),
    through_beat_id: beatRef(chapter.through_beat_id),
  })),
});
function draftLayout(value) {
  exact(value, ['version', 'volumes', 'chapters'], 'Editorial proposal');
  if (
    value.version !== 1 ||
    !Array.isArray(value.volumes) ||
    !value.volumes.length ||
    value.volumes.length > 64 ||
    !Array.isArray(value.chapters) ||
    !value.chapters.length ||
    value.chapters.length > 512
  )
    fail('Invalid editorial proposal.');
  for (const volume of value.volumes) {
    exact(volume, ['id', 'title'], 'Volume proposal');
    identifier(volume.id);
    text(volume.title, 'Volume title', 200, { optional: true });
  }
  for (const chapter of value.chapters) {
    exact(chapter, FIELDS, 'Chapter proposal');
    identifier(chapter.id);
    identifier(chapter.volume_id);
    text(chapter.title, 'Chapter title', 200, { optional: true });
    for (const key of ['after_beat_id', 'through_beat_id'])
      if (chapter[key] !== null) identifier(chapter[key]);
    if (typeof chapter.open_tail !== 'boolean') fail('Invalid chapter tail.');
  }
  if (Buffer.byteLength(canonical(value)) > 65536)
    fail('The editorial proposal exceeds 64 KiB.');
  return value;
}
module.exports = { draftLayout, layout, defaultLayout, resolve, remapLayout };
