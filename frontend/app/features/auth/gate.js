// The auth gate: asks the adapter whether the application route may render.
// In disabled mode it always may - the current app opens exactly as before.
// The future first-password / unlock surfaces exist only as dormant
// templates in this module; they are NEVER mounted while the adapter is
// disabled, so no active field can accept a credential.

export function createAuthGate({ auth }) {
  async function canRender() {
    try {
      const { state } = await auth.status();
      // 'disabled' and 'unlocked' render the app; only the future
      // setup-required / locked states would show a gate.
      return state === 'disabled' || state === 'unlocked';
    } catch {
      // An unreachable adapter must never lock the user out of a local app.
      return true;
    }
  }

  // Dormant templates for the future security phase (Vesper threshold art,
  // contrast-safe form panel, real labels). Not mounted in disabled mode.
  function buildFirstPasswordTemplate() {
    const panel = document.createElement('div');
    panel.className = 'auth-surface';
    panel.setAttribute('hidden', '');
    panel.innerHTML = `
      <div class="auth-surface__form">
        <h2>Seal your scriptorium</h2>
        <p>Set the password you will use to unlock ScribeTribe on this device.</p>
      </div>
      <img class="auth-surface__art" src="brand/vesper-threshold.webp" alt="" width="1122" height="1402" loading="lazy" decoding="async">`;
    // Deliberately no inputs: a dormant template must not accept a secret.
    return panel;
  }

  function buildUnlockTemplate() {
    const panel = document.createElement('div');
    panel.className = 'auth-surface';
    panel.setAttribute('hidden', '');
    panel.innerHTML = `
      <div class="auth-surface__form">
        <h2>Unlock ScribeTribe</h2>
        <p>The manuscript remembers you.</p>
      </div>
      <img class="auth-surface__art" src="brand/vesper-threshold.webp" alt="" width="1122" height="1402" loading="lazy" decoding="async">`;
    return panel;
  }

  return { canRender, buildFirstPasswordTemplate, buildUnlockTemplate };
}
