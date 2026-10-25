export const ROOMS = ['desk', 'chronicle', 'codex', 'gallery', 'gate'];
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const BOOKMARKS = 'im-fiction-bookmarks-v1';
const PREFERENCES = 'im-fiction-reading-v1';

export function parseWorkspace(hash = '') {
  const [route, query = ''] = hash.split('?');
  const match = /^#\/story\/([A-Za-z0-9_-]{1,80})(?:\/(desk|chronicle|codex|gallery|gate))?$/.exec(route);
  if (!match) return null;
  const task = new URLSearchParams(query).get('task');
  return { storyId: match[1], room: match[2] || 'desk', task: ['steer', 'ask', 'act', 'say'].includes(task) ? task : null };
}
export const workspaceUrl = (storyId, room = 'desk') => `#/story/${encodeURIComponent(storyId)}/${ROOMS.includes(room) ? room : 'desk'}`;
function read(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
export function getBookmark(storyId, branchId) {
  const item = read(BOOKMARKS)?.[`${storyId}:${branchId}`];
  if (!item || item.branchId !== branchId || !id(item.beatId)) return null;
  return { beatId: item.beatId, branchId, top: item.top === true, paragraph: Number.isInteger(item.paragraph) ? Math.max(0, Math.min(2000, item.paragraph)) : 0, fraction: Number.isFinite(item.fraction) ? Math.max(0, Math.min(1, item.fraction)) : 0 };
}
export function putBookmark(storyId, item) {
  if (!id(storyId) || !id(item?.branchId) || !id(item?.beatId)) return false;
  const raw = read(BOOKMARKS);
  const entries = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw).filter(([key]) => key !== `${storyId}:${item.branchId}`).slice(-31) : [];
  return write(BOOKMARKS, Object.fromEntries([...entries, [`${storyId}:${item.branchId}`, { branchId: item.branchId, beatId: item.beatId, paragraph: item.paragraph || 0, fraction: item.fraction || 0, top: item.top === true }]]));
}
export const DEFAULT_READING = { font: 'literata', spacing: '1.85', width: 'normal', paper: 'vellum' };
export function readingPreferences() {
  const value = read(PREFERENCES);
  return Object.fromEntries(Object.entries(DEFAULT_READING).map(([key, fallback]) => [key, ({ font: ['literata', 'system'], spacing: ['1.65', '1.85', '2.1'], width: ['normal', 'narrow'], paper: ['vellum', 'dusk'] })[key].includes(value?.[key]) ? value[key] : fallback]));
}
export function saveReadingPreferences(value) { return write(PREFERENCES, value); }
