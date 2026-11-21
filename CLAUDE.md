# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StrenGames Hub is a Google Apps Script web app, bound to the "StrenGames Hub" spreadsheet, that runs the six-week Strenuous Life team competition: enlisting, team changes, weekly reports (check-ins) and standings. The spreadsheet is the database. `README.md` has the organizer-facing docs: the Config keys, sheet tabs and scoring rules.

## Commands

```bash
npm install                 # dev tools + husky pre-commit hook (lint-staged runs Prettier on staged files)
npm test                    # logic, server (Apps Script mock) and scoring regression tests
npm run test:e2e            # Playwright browser tests (needs Chromium: npx playwright install chromium)
npm run lint                # ESLint on src/*.gs and test/*.js
npm run format              # Prettier write; format:check only checks
npm run demo -- "2025-11-10 19:30:00"   # build test/preview.html with fake data at that moment
```

Run a single file with `node --test test/logic.test.js`. Run a single test with `node --test --test-name-pattern="registration window" test/logic.test.js`.

PRs run `test.yml` (unit and e2e) and `lint.yml` (ESLint and `prettier --check`). Pushing to `main` runs `deploy.yml`: tests, then `clasp push --force` of `src/` and `clasp deploy` to the existing deployment ID, so the `/exec` URL stays the same. `pages.yml` publishes `docs/` and builds `docs/demo.html` with `build-preview.js`.

## Architecture

- **`src/Logic.gs`**: pure JS IIFE `Logic` covering deadline windows and time zones (`zonedToEpoch`, `buildSeason`), registration and team-join status, check-in validation, scoring and standings. It has no Apps Script calls. Its last line does `module.exports` so Node can `require` it. Put rules here and unit-test them in `test/logic.test.js`.
- **`src/Code.gs`**: the server. Apps Script loads every `.gs` file into one global scope, so `Code.gs` calls `Logic.*` directly. Top-level functions without a trailing `_` are public entry points: `doGet`, menu actions (`onOpen`, `setup`, `importRoster`, …) and the RPCs the page calls (`getBootstrap`, `signup`, `joinTeams`, `leaveTeam`, `renameParticipant`, `getMyRecord`, `submitCheckin`, `getStandings`). Functions ending in `_` are private helpers by Apps Script convention. `SCHEMA` defines each sheet tab's columns. `table_`, `readTable_`, `appendRow_` and `writeRow_` treat tabs as header-keyed tables. Writes go through `withLock_` (the script lock). Standings are cached in `CacheService` for 60 seconds under `CACHE_KEY`, and `clearStandingsCache` clears them. Deadlines are enforced on the server, never trusted from the client.
- **Page**: `Index.html` is an HtmlService template that pulls in `Styles.html`, `Client.html` and the hero image through `<?!= include('…') ?>` scriptlets. `Client.html` reaches the server only through `call(fn, ...args)`, which uses `google.script.run` in production and falls back to `window.MockServer` locally.
- **Testing without Apps Script**: `test/gas-mock.js` is an in-memory stand-in for `SpreadsheetApp`, `CacheService`, `LockService`, `Utilities` and so on, with a controllable `now`. It works in Node and in the browser. `server.test.js` loads `Logic.gs` and `Code.gs` into a `vm` context on top of the mock. `build-preview.js` inlines the mock, `Logic.gs`, `Code.gs` and the real HTML into one standalone page. `e2e.test.js` builds two of these pages at fixed moments (mid-season and during registration) and drives them in Chromium.
- `scoring-regression.test.js` is a made-up season with hand-computed totals, ranks and team scores. If scoring changes, these expected values must stay right; don't just regenerate them.

## Conventions and constraints

- `.gs` files are ES2022 **scripts**, not modules: no `import`/`export`, and every top-level function is global. ESLint allows unused top-level functions in `src/` on purpose, because menus, triggers and `google.script.run` call them.
- If you use a new Apps Script service, add it to the globals list in `eslint.config.js` and to `test/gas-mock.js`.
- `appsscript.json` limits the script to `spreadsheets.currentonly` (`@OnlyCurrentDoc`). Don't add scopes casually.
- Badge requirement text from the Handbook is copyrighted. The app must never list it: users type which badge and requirement they completed in a free-text field.
- `src/HeroImage.html` is a single-line WebP data URI, and Prettier ignores it. Regenerate it with `tools/cut_moose.py`; don't edit it by hand.
- There is no login: identity is "pick your name" (honor system), and `Checkins` records submission times.
