// A small hash router: parse/format routes, dispatch enter/leave lifecycle,
// and drive history. The Express server never sees these - everything after
// # stays in the browser.
//
// Routes:
//   #/home
//   #/write
//   #/write/:storyId
//   #/write/:storyId/page/:pageNumber
//   #/library/stories
//   #/library/bookshelf
//   #/worlds
//   #/characters
//   #/settings
//
// An unknown hash recovers to #/home with a message.

const ROUTES = [
  { name: 'home', pattern: /^\/home$/ },
  { name: 'write', pattern: /^\/write$/ },
  { name: 'write-story', pattern: /^\/write\/([^/]+)$/ },
  { name: 'write-page', pattern: /^\/write\/([^/]+)\/page\/(\d+)$/ },
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
      if (route.name === 'write-story') return { name: 'write', params: { storyId: match[1] } };
      if (route.name === 'write-page') return { name: 'write', params: { storyId: match[1], pageNumber: Number(match[2]) } };
      return { name: route.name, params: {} };
    }
  }
  return { name: 'unknown', params: { path } };
}

export function formatHash(name, params = {}) {
  switch (name) {
    case 'home': return '#/home';
    case 'write':
      if (params.storyId && params.pageNumber) return `#/write/${params.storyId}/page/${params.pageNumber}`;
      if (params.storyId) return `#/write/${params.storyId}`;
      return '#/write';
    case 'library-stories': return '#/library/stories';
    case 'library-bookshelf': return '#/library/bookshelf';
    case 'worlds': return '#/worlds';
    case 'characters': return '#/characters';
    case 'settings': return '#/settings';
    default: return '#/home';
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
    if (!window.location.hash) window.location.hash = '#/home';
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
