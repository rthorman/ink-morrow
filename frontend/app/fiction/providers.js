import { el, field, button, option } from './dom.js';

export function createProviderPanel({ api }) {
  let epoch = 0;
  let active = () => true;
  const root = () => document.getElementById('fictionProviderPanel');
  async function render(isCurrent = () => true) {
    const token = ++epoch; active = isCurrent;
    const live = () => epoch === token && isCurrent();
    root().textContent = 'Loading provider settings…';
    try {
      const data = await api('/providers');
      if (!live()) return;
      root().replaceChildren();
      const status = el('p', '', 'fiction-muted'); status.setAttribute('role', 'status');
      const assignment = data.roles.find((role) => role.role === 'scribe');
      root().append(el('p', assignment ? `Storyteller: ${assignment.model_id} · ${assignment.status}` : 'No storyteller is configured. Reading and local story management remain available.'));
      const profile = field('Text provider', 'select');
      const candidates = data.profiles.filter((entry) => entry.capabilities.includes('chat'));
      profile.control.append(...candidates.map((entry) => option(entry.id, `${entry.display_name} · ${entry.credential.state}`)));
      if (assignment) profile.control.value = assignment.profile_id;
      const model = field('Model identifier', 'input', assignment?.model_id || '', { maxLength: 300, placeholder: 'provider/model-name' });
      const save = button('Use this storyteller', async () => {
        if (save.disabled) return;
        save.disabled = true; save.textContent = 'Saving storyteller…'; status.textContent = '';
        try {
          await api('/providers/roles/scribe', 'PUT', { profile_id: profile.control.value, model_id: model.control.value.trim() });
          if (live()) await render(isCurrent);
        } catch (error) { if (live()) status.textContent = error.message; }
        finally { if (live()) { save.disabled = false; save.textContent = 'Use this storyteller'; } }
      }, 'btn btn-primary');
      const catalogue = el('div');
      const load = button('Browse this provider’s models', async () => {
        if (load.disabled) return;
        const selected = profile.control.value;
        load.disabled = true; load.textContent = 'Loading models…';
        try {
          const response = await api(`/providers/${selected}/models`);
          if (!live() || profile.control.value !== selected) return;
          const picker = field('Available model', 'select');
          picker.control.append(option('', 'Choose a model'), ...response.models.map((entry) => option(entry.id, entry.name || entry.id)));
          picker.control.addEventListener('change', () => { if (picker.control.value) model.control.value = picker.control.value; });
          catalogue.replaceChildren(picker.wrapper);
        } catch (error) { if (live()) status.textContent = error.message; }
        finally { if (live()) { load.disabled = false; load.textContent = 'Browse this provider’s models'; } }
      });
      root().append(profile.wrapper, model.wrapper, save, load, catalogue, status);

      const credentials = el('details'); credentials.append(el('summary', 'Credentials and providers'));
      const credentialNote = el('p');
      const secret = field('API key', 'input', '', { type: 'password', autocomplete: 'off', maxLength: 12000 });
      const source = field('Keep this credential', 'select'); source.control.append(option('session', 'Until the server restarts'), option('vault', 'Encrypted in the local vault'));
      const password = field('Owner password (only for encrypted storage)', 'input', '', { type: 'password', autocomplete: 'current-password', maxLength: 128 });
      const credentialSave = button('Save credential', async () => {
        if (credentialSave.disabled) return;
        const selected = profile.control.value;
        credentialSave.disabled = true; credentialSave.textContent = 'Saving credential…'; status.textContent = '';
        try {
          await api(`/providers/${selected}/credential`, 'PUT', { source: source.control.value, credential: secret.control.value, password: password.control.value || undefined });
          secret.control.value = ''; password.control.value = '';
          if (live()) await render(isCurrent);
        } catch (error) { if (live()) status.textContent = error.message; }
        finally { if (live()) { credentialSave.disabled = false; credentialSave.textContent = 'Save credential'; } }
      });
      const updateCredential = () => {
        const selected = candidates.find((entry) => entry.id === profile.control.value);
        const readOnly = selected?.credential.read_only;
        credentialNote.textContent = readOnly ? 'This provider uses a read-only environment credential. Add a separate profile below to use a key entered here.' : 'The key is sent only to your own server for provider use. It is never saved in browser storage.';
        secret.control.disabled = Boolean(readOnly); source.control.disabled = Boolean(readOnly); password.control.disabled = Boolean(readOnly); credentialSave.disabled = Boolean(readOnly);
        secret.control.value = ''; password.control.value = ''; catalogue.replaceChildren();
      };
      profile.control.addEventListener('change', updateCredential); updateCredential();
      credentials.append(credentialNote, secret.wrapper, source.wrapper, password.wrapper, credentialSave);
      const name = field('New provider name', 'input', 'My OpenRouter', { maxLength: 200 });
      const endpoint = field('OpenAI-compatible endpoint', 'input', 'https://openrouter.ai/api/v1', { maxLength: 1000 });
      const create = button('Add provider profile', async () => {
        if (create.disabled) return;
        create.disabled = true; create.textContent = 'Adding provider…'; status.textContent = '';
        try {
          await api('/providers', 'POST', { display_name: name.control.value, base_url: endpoint.control.value, capabilities: ['chat', 'catalog'], enabled: true });
          if (live()) await render(isCurrent);
        } catch (error) { if (live()) status.textContent = error.message; }
        finally { if (live()) { create.disabled = false; create.textContent = 'Add provider profile'; } }
      });
      credentials.append(el('h3', 'Add a provider'), name.wrapper, endpoint.wrapper, create);
      root().append(credentials);
      if (data.vault.state === 'locked') {
        const unlock = field('Unlock saved credentials with your owner password', 'input', '', { type: 'password', autocomplete: 'current-password', maxLength: 128 });
        const unlockButton = button('Unlock credentials', async () => {
          if (unlockButton.disabled) return;
          unlockButton.disabled = true;
          try { await api('/providers/vault/unlock', 'POST', { password: unlock.control.value }); unlock.control.value = ''; if (live()) await render(isCurrent); }
          catch (error) { if (live()) status.textContent = error.message; }
          finally { if (live()) unlockButton.disabled = false; }
        });
        root().append(unlock.wrapper, unlockButton);
      }
    } catch (error) { if (live()) root().textContent = error.message; }
  }
  return { render, clear: () => {
    epoch++; active = () => false;
    root()?.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
    root()?.replaceChildren();
  }, isActive: () => active() };
}
