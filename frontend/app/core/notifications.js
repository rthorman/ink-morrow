// Toast/inline message region: XSS-safe (textContent only, never innerHTML
// with user data). A modal buries the section-level message area; anything
// said while a modal is open surfaces ON TOP of it, or the user never reads it.

function createNotifications() {
  function showMessage(message, kind = 'error') {
    const div = document.createElement('div');
    div.className = kind === 'error' ? 'error-message' : 'success-message';
    div.textContent = message;
    const modalOpen = document.querySelector('.burn-modal:not([hidden]), .scene-viewer:not([hidden])');
    if (modalOpen) {
      div.classList.add('message--floating');
      document.body.appendChild(div);
    } else {
      const active = document.querySelector('.content-section.active') || document.querySelector('main');
      active.insertBefore(div, active.firstChild);
    }
    // Errors carry recovery information: keep them up longer.
    setTimeout(() => div.remove(), kind === 'error' ? 8000 : 5000);
  }

  // Wrap raw failures in the scribe's voice without ever hiding the reason.
  function scribeErrorMessage(raw) {
    const msg = String(raw || 'something went wrong');
    if (msg.includes('Cannot reach the server')) {
      return 'The scriptorium has gone dark — the server cannot be reached. Is it still running?';
    }
    if (msg.includes('API key not configured')) {
      return 'The scribe has no key to the library. Set OPENROUTER_API_KEY in backend/.env, then restart the server.';
    }
    if (msg.includes('illegible')) {
      return 'The ink has gone feral — the scribe produced something illegible. Ask again; she will be clearer.';
    }
    if (msg.includes('referenced by')) {
      return `The scribe refuses to cut a thread that still holds weight — ${msg}`;
    }
    if (msg.includes('world_id') || msg.includes('unknown id')) {
      return `The scribe cannot find that in the archives — ${msg}`;
    }
    if (msg.includes('Request failed')) {
      return `The scribe frowns at a sealed envelope — ${msg}. The how of it is unclear; try again.`;
    }
    return `The scribe looks up, troubled — ${msg}`;
  }

  return {
    showMessage,
    scribeErrorMessage,
    showError: (message) => showMessage(scribeErrorMessage(message), 'error'),
    showErrorRaw: (message) => showMessage(message, 'error'),
    showSuccess: (message) => showMessage(message, 'success'),
  };
}

export { createNotifications };
