import { apiCall, configureApiSecurity } from '../core/api.js';
import { createDialogManager, forceCloseAllModals } from '../core/dialogs.js';
import { createAuthAdapter } from '../features/auth/adapter.js';
import { createAuthGate } from '../features/auth/gate.js';
import { createFictionApp } from './app.js';
import { createProviderPanel } from './providers.js';

const auth = createAuthAdapter();
const gate = createAuthGate({ auth });
const dialogs = createDialogManager();
configureApiSecurity({ getCsrfToken: () => auth.csrfToken, onUnauthorized: (state) => auth.handleUnauthorized(state) });
const providerPanel = createProviderPanel({ api: apiCall });
const app = createFictionApp({ api: apiCall, dialogs, providerPanel });
gate.wireAccountControls();
gate.init({ onUnlock: () => app.start(), onLock: () => { app.lock(); forceCloseAllModals(); } });
