// Global shell: section switching (Phase 4 grows this into the hash router),
// the scribe status line, and the low-storage banner.

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
  function showSection(section) {
    document.querySelectorAll('.content-section').forEach((sec) => sec.classList.remove('active'));
    document.getElementById(`${section}Section`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active');
      btn.removeAttribute('aria-current');
    });
    const activeBtn = document.getElementById(`${section}Btn`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-current', 'page');
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
      setInterval(checkDiskSpace, 30000);
    }
  }

  return { showSection, checkDiskSpace, initDiskBanner };
}
