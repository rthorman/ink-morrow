# Project memory

Persistent notes for this project (ScribeTribe, ~/src/scribe-tribe).

## Project overview

- Gothic interactive-fiction writing tool: Express backend (node:sqlite, no native builds) serves the API and the static vanilla-JS frontend on :3000
- AI via OpenRouter (key in backend/.env, see backend/.env.example); branding per ScribeTribe-OpenCode-Branding/ in the repo root (frontend assets in frontend/brand/, WebP + SVG only — PNG masters stay in the package dir)
- Dev server control: `~/bin/st-server {start|stop|restart|status}` (PID-file based) — never `pkill -f` a pattern; a command line containing the plain string anywhere in its argv self-matches and kills the shell (hung the tool twice). Use the helper.

## Testing

- Backend: `cd backend && node node_modules/jest/bin/jest.js` (jest via direct node — npm .bin shebangs fail on Termux)
- Frontend: same pattern in frontend/
- E2E (Playwright): `cd e2e && node node_modules/@playwright/test/cli.js test --project=chromium` then `--project="Mobile Chrome"` — each project in its OWN invocation (one webServer spans a single invocation; sharing it leaks data between projects as duplicates)

### E2E on Termux quirks

- playwright-core must be patched for `process.platform === "android"`: three `Unsupported platform: android` throw sites in node_modules/playwright-core/lib/coreBundle.js → treat android like linux (re-patch after npm install)
- Use system chromium via executablePath /data/data/com.termux/files/usr/bin/chromium-browser (`pkg install x11-repo chromium`); never `npx playwright` (.bin shebangs)
- Isolation: e2e runs on port 3100, reuseExistingServer:false, env inlined in the webServer command (DB_PATH=":memory:" PORT="3100" …) — verified it creates nothing in database/scribe-tribe.db. Never point e2e at 3000; the dev server there uses the real DB. If a leak is ever suspected, fixture names to hunt: 'Context Realm', 'Sir Context', 'Generation/Retry/Error/Export/Burn Test'

## Architecture notes

- Stories carry a tiered cast as [{id, role, relation, state}] in stories.characters: role mc|supporting|background (one MC max, UI requires exactly one), relation = free-text tie to the MC at story start; state = per-story mutable instance (personality/appearance/relationship_to_mc) that the model updates via a <<<CHARACTER_STATE>>> JSON block appended after each generated page (split off before storing; malformed blocks degrade gracefully). Legacy plain-id casts are REJECTED (data was wiped 2026-08-29). Frontend cast builder: MC picker + one-at-a-time adds with relation textbox
- Per-page AI accounting: model, prompt/completion tokens, cost_usd on story_pages; stories expose total_cost_usd; frontend settings (localStorage st-settings): model picker (GET /api/models proxy), words per page (50–2000, scales max_tokens), story font, scriptorium writing background, cost ticker (default on)
- AI drafts: POST /api/ai/world + /api/ai/character (seeds → short/medium/long JSON drafts, variant counter for regenerate)
- Old pages are read-only; writing happens on the last page; "delete everything after this page" truncates via DELETE /api/stories/:id/pages?after=N with a slider-confirm modal
- Export is EPUB (dependency-free zip writer in backend/src/epub.js)