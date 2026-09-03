// Adaptive shell: global Library/utilities, the five stable manuscript
// destinations, manuscript switching, truthful status, and low-storage state.

export const SCRIBE_FLAVOR = [
  'The quill dips into shadow-ink…',
  'Ink remembers. Give it a moment.',
  'Candlelight steadies over the half-written line…',
  'The scribe murmurs the tale back to herself…',
  'Somewhere in the manuscript, a claw sharpens…',
  'Her tail flicks — the story is close now.',
];
export const SCRIBE_DONE = 'The page is complete.';
export const SCRIBE_ERROR = 'The scribe looks up, troubled — the ink has gone feral.';

const DISK_LOW_BYTES = 1024 * 1024 * 1024; // under 1 GB free…
const DISK_LOW_RATIO = 0.05; // …or under 5% of the volume
const DISK_CRITICAL_BYTES = 250 * 1024 * 1024; // almost full: escalate the wording

function formatDiskBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export function updateDiskBanner(data) {
  const banner = document.getElementById('diskBanner');
  const text = document.getElementById('diskBannerText');
  if (!banner || !text) return;
  const free = typeof data?.free_bytes === 'number' && data.free_bytes >= 0 ? data.free_bytes : null;
  const total = typeof data?.total_bytes === 'number' && data.total_bytes > 0 ? data.total_bytes : null;
  const low = free !== null && (free < DISK_LOW_BYTES || (total !== null && free / total < DISK_LOW_RATIO));
  banner.hidden = !low;
  if (!low) return;
  const freeLabel = formatDiskBytes(free);
  text.textContent =
    free < DISK_CRITICAL_BYTES
      ? `Storage is almost full — ${freeLabel} free on this device. The scribe cannot save new pages or paintings until room is made.`
      : `Storage is running low — ${freeLabel} free on this device. Painted plates and new pages still need room to breathe.`;
}

export function createShell({ api, notify }) {
  let diskTimer = null;
  const WORKSPACE_BUTTON = {
    desk: 'writeBtn',
    chronicle: 'chronicleBtn',
    play: 'chronicleBtn',
    codex: 'codexBtn',
    gallery: 'galleryBtn',
    gate: 'gateBtn',
  };

  function showSection(section, { destination = null } = {}) {
    document.querySelectorAll('.content-section').forEach((sec) => sec.classList.remove('active'));
    const target = document.getElementById(`${section}Section`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active');
      btn.removeAttribute('aria-current');
    });
    const globalButtonId = {
      home: 'homeBtn',
      library: 'libraryBtn',
      worlds: 'worldsBtn',
      characters: 'charactersBtn',
      tribe: 'tribeBtn',
      settings: 'settingsBtn',
    }[section] || null;
    const activeBtn = globalButtonId ? document.getElementById(globalButtonId) : null;
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-current', 'page');
    }
    document.querySelectorAll('.workspace-nav__btn').forEach((button) => {
      button.classList.remove('active');
      button.removeAttribute('aria-current');
    });
    const workspaceButton = document.getElementById(WORKSPACE_BUTTON[destination]);
    if (workspaceButton) {
      workspaceButton.classList.add('active');
      workspaceButton.setAttribute('aria-current', 'page');
    }
    document.body.classList.toggle('im-workspace', Boolean(workspaceButton));
  }

  function syncManuscriptShell(stories = [], story = null) {
    const select = document.getElementById('shellManuscriptSelect');
    if (select) {
      const wanted = story?.id || '';
      select.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = stories.length ? 'Choose a manuscript' : 'No manuscripts yet';
      select.appendChild(placeholder);
      for (const item of stories) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.title;
        select.appendChild(option);
      }
      select.value = [...select.options].some((option) => option.value === wanted) ? wanted : '';
      select.disabled = stories.length === 0;
      select.setAttribute('aria-label', story ? `Current manuscript: ${story.title}` : 'Choose a manuscript');
    }
    for (const name of ['chronicle', 'codex', 'gallery', 'gate']) {
      const button = document.getElementById(WORKSPACE_BUTTON[name]);
      if (button) button.disabled = !story;
    }
    for (const label of document.querySelectorAll('[data-workspace-story]')) {
      label.textContent = story?.title || 'No manuscript selected';
    }
  }

  async function checkDiskSpace() {
    try {
      updateDiskBanner(await api.apiCall('/disk'));
    } catch {
      // Server unreachable is reported elsewhere; the banner keeps its last state.
    }
  }

  function initDiskBanner() {
    checkDiskSpace();
    // Jest drives checks manually; only a live page keeps watching the disk.
    if (typeof process === 'undefined' || !process.env.JEST_WORKER_ID) {
      if (!diskTimer) diskTimer = setInterval(checkDiskSpace, 30000);
    }
  }

  function stopDiskBanner() {
    if (diskTimer) clearInterval(diskTimer);
    diskTimer = null;
    const banner = document.getElementById('diskBanner');
    if (banner) banner.hidden = true;
  }

  return { showSection, syncManuscriptShell, checkDiskSpace, initDiskBanner, stopDiskBanner };
}
