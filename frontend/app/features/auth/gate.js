// Branded first-run and unlock gate. It fails closed: no application route or
// catalogue load is allowed until the backend confirms a live session.

function inputRow(labelText, input, control = input) {
  const row = document.createElement('div');
  row.className = 'auth-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = input.id;
  row.append(label, control);
  return row;
}

function wirePasswordToggle(input, toggle) {
  if (!input || !toggle || toggle.dataset.wired === 'true') return;
  toggle.dataset.wired = 'true';
  toggle.addEventListener('click', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? 'Show' : 'Hide';
    toggle.setAttribute('aria-pressed', String(!visible));
    input.focus();
  });
}

function passwordRow(labelText, input) {
  const control = document.createElement('div');
  control.className = 'auth-password';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'auth-password__toggle';
  toggle.textContent = 'Show';
  toggle.setAttribute('aria-controls', input.id);
  toggle.setAttribute('aria-pressed', 'false');
  wirePasswordToggle(input, toggle);
  control.append(input, toggle);
  return inputRow(labelText, input, control);
}

function passwordInput(id, autocomplete) {
  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  input.type = 'password';
  input.autocomplete = autocomplete;
  input.required = true;
  input.minLength = 15;
  input.maxLength = 128;
  return input;
}

export function createAuthGate({ auth }) {
  const root = document.getElementById('authRoot') || (() => {
    const el = document.createElement('div');
    el.id = 'authRoot';
    document.body.prepend(el);
    return el;
  })();
  let onUnlock = () => {};
  let onLock = () => {};
  let lastState = null;
  let busy = false;

  function setGated(gated) {
    document.body.classList.toggle('im-gated', gated);
    root.hidden = !gated;
    if (gated) {
      for (const section of document.querySelectorAll('.content-section')) section.classList.remove('active');
    }
  }

  function panelBase(title, copy) {
    const surface = document.createElement('section');
    surface.className = 'auth-surface';
    surface.setAttribute('aria-labelledby', 'authTitle');
    const formSide = document.createElement('div');
    formSide.className = 'auth-surface__form';
    const lockup = document.createElement('img');
    lockup.className = 'auth-surface__lockup';
    lockup.src = 'brand/ink-morrow-lockup.svg';
    lockup.alt = 'Ink Morrow — Where stories grow claws';
    lockup.width = 900;
    lockup.height = 240;
    const kicker = document.createElement('p');
    kicker.className = 'auth-surface__kicker';
    kicker.textContent = 'The sealed scriptorium';
    const heading = document.createElement('h1');
    heading.id = 'authTitle';
    heading.textContent = title;
    const intro = document.createElement('p');
    intro.textContent = copy;
    formSide.append(lockup, kicker, heading, intro);
    const art = document.createElement('img');
    art.className = 'auth-surface__art';
    art.src = 'brand/vesper-threshold.webp';
    art.alt = '';
    art.width = 1672;
    art.height = 941;
    art.decoding = 'async';
    surface.append(formSide, art);
    return { surface, formSide };
  }

  function rememberRow() {
    const label = document.createElement('label');
    label.className = 'auth-remember';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'remember';
    input.checked = true;
    const copy = document.createElement('span');
    copy.textContent = 'Keep this scriptorium unlocked on this device';
    label.append(input, copy);
    return label;
  }

  function errorLine() {
    const error = document.createElement('p');
    error.className = 'auth-error';
    error.setAttribute('role', 'alert');
    error.setAttribute('aria-live', 'polite');
    return error;
  }

  function submitButton(label) {
    const button = document.createElement('button');
    button.type = 'submit';
    button.className = 'btn btn-primary auth-submit';
    button.textContent = label;
    return button;
  }

  function renderSetup() {
    const { surface, formSide } = panelBase(
      'Seal your scriptorium',
      'Choose the password that will guard the manuscripts on this installation.'
    );
    const hint = document.createElement('p');
    hint.className = 'auth-hint';
    hint.textContent = 'The one-time setup code is printed in the terminal where Ink Morrow started.';
    const form = document.createElement('form');
    form.className = 'auth-form';
    form.id = 'authSetupForm';
    const code = document.createElement('input');
    code.id = 'authSetupCode';
    code.name = 'setup-code';
    code.type = 'text';
    code.autocomplete = 'one-time-code';
    code.spellcheck = false;
    code.required = true;
    const password = passwordInput('authNewPassword', 'new-password');
    const confirm = passwordInput('authConfirmPassword', 'new-password');
    const remember = rememberRow();
    const error = errorLine();
    const submit = submitButton('Set password and enter');
    form.append(
      inputRow('One-time setup code', code),
      passwordRow('Password or passphrase', password),
      passwordRow('Repeat password', confirm),
      remember,
      error,
      submit
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      error.textContent = '';
      if (password.value.normalize('NFC') !== confirm.value.normalize('NFC')) {
        error.textContent = 'The two passwords do not match.';
        confirm.focus();
        return;
      }
      busy = true;
      submit.disabled = true;
      submit.textContent = 'Sealing…';
      try {
        await auth.setup({
          setupCode: code.value,
          password: password.value,
          remember: remember.querySelector('input').checked,
        });
        password.value = '';
        confirm.value = '';
      } catch (authError) {
        error.textContent = authError.message;
      } finally {
        busy = false;
        submit.disabled = false;
        submit.textContent = 'Set password and enter';
      }
    });
    formSide.append(hint, form);
    root.replaceChildren(surface);
    queueMicrotask(() => code.focus());
  }

  function renderLocked() {
    const { surface, formSide } = panelBase(
      'Unlock Ink Morrow',
      'The manuscript remembers you. Speak the phrase that opens the desk.'
    );
    const form = document.createElement('form');
    form.className = 'auth-form';
    form.id = 'authLoginForm';
    const password = passwordInput('authPassword', 'current-password');
    const remember = rememberRow();
    const error = errorLine();
    const submit = submitButton('Unlock');
    form.append(passwordRow('Password', password), remember, error, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Unlocking…';
      try {
        await auth.login({ password: password.value, remember: remember.querySelector('input').checked });
        password.value = '';
      } catch (authError) {
        error.textContent = authError.message;
        password.select();
      } finally {
        busy = false;
        submit.disabled = false;
        submit.textContent = 'Unlock';
      }
    });
    formSide.append(form);
    root.replaceChildren(surface);
    queueMicrotask(() => password.focus());
  }

  function renderUnavailable(message) {
    const { surface, formSide } = panelBase(
      'The door will not answer',
      message || 'Ink Morrow could not confirm whether the desk is locked.'
    );
    const retry = submitButton('Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => refresh());
    formSide.append(retry);
    root.replaceChildren(surface);
  }

  function render(status) {
    const state = status?.state || 'error';
    if (state === 'unlocked' || state === 'disabled') {
      setGated(false);
      root.replaceChildren();
    } else {
      setGated(true);
      if (state === 'setup-required') renderSetup();
      else if (state === 'locked') renderLocked();
      else renderUnavailable(status?.message);
    }
    if (state !== lastState) {
      const previouslyUnlocked = lastState === 'unlocked' || lastState === 'disabled';
      const nowUnlocked = state === 'unlocked' || state === 'disabled';
      lastState = state;
      if (nowUnlocked) onUnlock();
      else if (previouslyUnlocked) onLock();
    }
  }

  async function refresh() {
    document.body.classList.add('im-auth-checking');
    try {
      const current = await auth.status({ refresh: true });
      render(current);
      return current;
    } catch (error) {
      render({ state: 'error', message: error.message });
      return { state: 'error' };
    } finally {
      document.body.classList.remove('im-auth-checking');
    }
  }

  async function canRender() {
    try {
      const current = await auth.status();
      render(current);
      return current.state === 'unlocked' || current.state === 'disabled';
    } catch (error) {
      render({ state: 'error', message: error.message });
      return false;
    }
  }

  function init(callbacks = {}) {
    onUnlock = callbacks.onUnlock || onUnlock;
    onLock = callbacks.onLock || onLock;
    auth.subscribe(render);
    window.addEventListener('pageshow', () => refresh());
    return canRender();
  }

  function wireAccountControls() {
    for (const toggle of document.querySelectorAll('.auth-password__toggle')) {
      wirePasswordToggle(document.getElementById(toggle.getAttribute('aria-controls')), toggle);
    }
    const lock = document.getElementById('lockBtn');
    if (lock) {
      lock.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        lock.disabled = true;
        try {
          await auth.logout();
        } catch (error) {
          render({ state: 'error', message: error.message });
        } finally {
          busy = false;
          lock.disabled = false;
        }
      });
    }

    const form = document.getElementById('passwordChangeForm');
    if (!form) return;
    const current = document.getElementById('passwordCurrent');
    const password = document.getElementById('passwordNew');
    const confirm = document.getElementById('passwordConfirm');
    const status = document.getElementById('passwordChangeStatus');
    const button = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      status.textContent = '';
      if (password.value.normalize('NFC') !== confirm.value.normalize('NFC')) {
        status.textContent = 'The two new passwords do not match.';
        return;
      }
      busy = true;
      button.disabled = true;
      try {
        await auth.changePassword({ currentPassword: current.value, newPassword: password.value });
        form.reset();
        status.textContent = 'Password changed. Other browser sessions have been locked.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
  }

  return { canRender, refresh, init, render, wireAccountControls };
}
