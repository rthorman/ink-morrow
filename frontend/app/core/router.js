// A small hash router: parse/format routes, dispatch enter/leave lifecycle,
// and drive history. The Express server never sees these - everything after
// # stays in the browser.
//
// Canonical routes:
//   #/library
//   #/desk[/<storyId>[/page/<pageNumber>]]
//   #/(chronicle|codex|gallery|gate)/<storyId>
//   #/library/stories
//   #/library/bookshelf
//   #/worlds
//   #/characters
//   #/settings
//
// #/home and #/write remain resolving aliases during the 4.0 transition; they
// do not create duplicate destinations. Unknown hashes recover to Library.

const ROUTES = [
  { name: 'home', pattern: /^\/(?:library|home)$/ },
  { name: 'desk', pattern: /^\/(?:desk|write)$/ },
  { name: 'desk-story', pattern: /^\/(?:desk|write)\/([^/]+)$/ },
  { name: 'desk-page', pattern: /^\/(?:desk|write)\/([^/]+)\/page\/(\d+)$/ },
  { name: 'chronicle-story', pattern: /^\/chronicle\/([^/]+)$/ },
  { name: 'codex-story', pattern: /^\/codex\/([^/]+)$/ },
  { name: 'gallery-story', pattern: /^\/gallery\/([^/]+)$/ },
  { name: 'gate-story', pattern: /^\/gate\/([^/]+)$/ },
  { name: 'library-stories', pattern: /^\/library\/stories$/ },
  { name: 'library-bookshelf', pattern: /^\/library\/bookshelf$/ },
  { name: 'worlds', pattern: /^\/worlds$/ },
  { name: 'characters', pattern: /^\/characters$/ },
  { name: 'settings', pattern: /^\/settings$/ },
];

export function parseHash(hash) {
  const path = String(hash || '').replace(/^#/, '');
  if (!path) return { name: 'home', params: {} };
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (match) {
      if (route.name === 'desk-story') return { name: 'desk', params: { storyId: match[1] } };
      if (route.name === 'desk-page') return { name: 'desk', params: { storyId: match[1], pageNumber: Number(match[2]) } };
      if (route.name.endsWith('-story')) {
        return { name: route.name.slice(0, -6), params: { storyId: match[1] } };
      }
      return { name: route.name, params: {} };
    }
  }
  return { name: 'unknown', params: { path } };
}

export function formatHash(name, params = {}) {
  switch (name) {
    case 'home': return '#/library';
    case 'write': // compatibility for pre-PR09 callers
    case 'desk':
      if (params.storyId && params.pageNumber) return `#/desk/${params.storyId}/page/${params.pageNumber}`;
      if (params.storyId) return `#/desk/${params.storyId}`;
      return '#/desk';
    case 'chronicle':
    case 'codex':
    case 'gallery':
    case 'gate':
      return params.storyId ? `#/${name}/${params.storyId}` : '#/desk';
    case 'library-stories': return '#/library/stories';
    case 'library-bookshelf': return '#/library/bookshelf';
    case 'worlds': return '#/worlds';
    case 'characters': return '#/characters';
    case 'settings': return '#/settings';
    default: return '#/library';
  }
}

export function createRouter({ onRoute, onUnknown, isAlive }) {
  let current = null; // last dispatched route
  let suppressHashChange = false; // a same-route hash rewrite shouldn't re-enter

  const alive = () => (isAlive ? isAlive() : true);

  function dispatch() {
    if (!alive()) return; // a superseded boot must not touch the app again
    if (suppressHashChange) {
      suppressHashChange = false;
      return;
    }
    const route = parseHash(window.location.hash);
    if (route.name === 'unknown') {
      if (onUnknown) onUnknown(route.params.path);
      navigate('home');
      return;
    }
    // Same story, new page: still dispatch (the reader must turn), but a
    // byte-identical route is a no-op.
    if (current && current.name === route.name && JSON.stringify(current.params) === JSON.stringify(route.params)) return;
    current = route;
    onRoute(route, { previous: null });
  }

  function navigate(name, params = {}) {
    const target = formatHash(name, params);
    if (window.location.hash === target) {
      // Same route: re-dispatch only when explicitly asked (e.g. tab already active)
      return;
    }
    window.location.hash = target; // fires hashchange → dispatch
  }

  function replace(name, params = {}) {
    // Update the hash (page number inside the same story) without adding a
    // history entry storm; the hashchange handler still dispatches.
    if (!alive()) return;
    const target = formatHash(name, params);
    if (window.location.hash === target) return;
    suppressHashChange = true;
    const url = window.location.href.split('#')[0] + target;
    window.history.replaceState(null, '', url);
    // replaceState does not fire hashchange: dispatch manually.
    suppressHashChange = false;
    const route = parseHash(target);
    if (!(current && current.name === route.name && JSON.stringify(current.params) === JSON.stringify(route.params))) {
      current = route;
      onRoute(route, { previous: null });
    }
  }

  function start() {
    window.addEventListener('hashchange', dispatch);
    if (!window.location.hash) window.location.hash = '#/library';
    dispatch();
  }

  function currentRoute() {
    return current;
  }

  function refresh() {
    current = null;
    dispatch();
  }

  return { start, navigate, replace, currentRoute, dispatch, refresh };
}
