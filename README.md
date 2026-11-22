# StrenGames Hub

A Google Apps Script web app for **StrenGames**, the six-week Strenuous Life team competition. Participants enlist, join or leave teams, file weekly reports and watch the standings in one place. It replaces the old Google Forms and spreadsheet formula chains.

- **Live app:** https://script.google.com/macros/s/AKfycbyYQTpEqrMEP4LcEhUI-uY_RgkAfv49P2YbAULIjaBz3WSJGySrx4PdnCk13IPNm9y3Uw/exec
- **Friendly address (GitHub Pages):** https://mrmeyers99.github.io/strengames/ frames the live app
- **Demo with made-up data:** https://mrmeyers99.github.io/strengames/demo.html

## Repository layout

| Path                                           | What it is                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/Code.gs`                                  | Server: reads and writes the Hub spreadsheet, enforces deadlines, serves the page                                                                         |
| `src/Logic.gs`                                 | Scoring, deadline windows and validation (pure JS, unit-tested)                                                                                           |
| `src/Index.html`, `Styles.html`, `Client.html` | The web page                                                                                                                                              |
| `src/HeroImage.html`                           | The animated TR-on-moose in the header (WebP data URI; used with permission)                                                                              |
| `src/appsscript.json`                          | Manifest: limited to the bound spreadsheet (`spreadsheets.currentonly`)                                                                                   |
| `test/`                                        | Node tests on an in-memory Apps Script mock, plus the demo builder                                                                                        |
| `tools/`                                       | `cut_moose.py` (animation cutout)                                                                                                                         |
| `docs/`                                        | GitHub Pages site                                                                                                                                         |
| `.github/workflows/`                           | `test.yml` and `lint.yml` (run on pull requests), `deploy.yml` (test, then push and deploy to Apps Script) and `pages.yml` (publish `docs/` and the demo) |

> **Badge requirements:** the Handbook's requirement text is copyrighted, so the app never lists it. When someone marks a badge requirement done, they must type which badge and requirement they completed in a free-text box. If an older sheet still has a `BadgeRequirements` tab, it is no longer used and can be deleted.

## Development

Run `npm install` once. It installs the dev tools and turns on a pre-commit hook that formats the files you commit with Prettier.

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `npm test`         | Unit, server and scoring tests                                       |
| `npm run test:e2e` | Browser tests (run `npx playwright install chromium` first)          |
| `npm run lint`     | ESLint on `src/*.gs` and `test/*.js`                                 |
| `npm run format`   | Format everything with Prettier (`npm run format:check` only checks) |

Pull requests run the tests, and a lint check that fails if anything is unformatted or has lint errors.

## How deploys work

Push to `main`, and GitHub Actions does the rest:

1. **Deploy Apps Script** runs the tests. If they pass, it runs `clasp push`, which mirrors `src/` into the Apps Script project, then `clasp deploy -i <deployment>`. That publishes a new version under the **same** `/exec` URL.
2. **GitHub Pages** publishes `docs/` and builds `demo.html`.

Pushing replaces every file in the Apps Script project with what's in `src/`, so make code changes here rather than in the online editor.

The deploy uses the repository secret **`CLASPRC_JSON`**: the contents of `~/.clasprc.json` from a `clasp login`. If deploys start failing with an auth error (for example after revoking "Google Apps Script CLI" at myaccount.google.com), refresh it:

```bash
npx @google/clasp@2.4.2 login
```

```bash
gh secret set CLASPRC_JSON --repo mrmeyers99/strengames < ~/.clasprc.json
```

You can also paste the file's contents under GitHub → Settings → Secrets and variables → Actions.

You can trigger either workflow by hand from the **Actions** tab ("Run workflow").

## Set up a season (about 10 minutes)

1. Create a new Google Sheet named, for example, **StrenGames Hub**.
2. **Extensions → Apps Script.** (Or just set `scriptId` in `.clasp.json` and let the deploy workflow push the code.) Create one file per file in `src/`, with the same names. Apps Script adds `.gs` and `.html` itself, so make `Code` and `Logic` as Script files and `Index`, `Styles`, `Client` and `HeroImage` as HTML files. `HeroImage` is one very long line; paste it whole. Paste in the contents. Replace `appsscript.json` too: Project Settings → "Show appsscript.json".
3. Reload the sheet. A **StrenGames** menu appears. Pick **StrenGames → Set up / repair tabs** and authorize. This creates the tabs and default settings. (Organizer tools only run from this menu. Running them from the script editor's Run button, or from the web app, is refused on purpose.)
4. In the **Config** tab, set at least these. All times are in `timezone`.
   - `season_name`, `season_start` (the first Saturday, `yyyy-MM-dd`)
   - `registration_opens`, `registration_closes` (`yyyy-MM-dd HH:mm:ss`)
   - `bonus_challenge_name` / `bonus_challenge_description` / `bonus_reveal_at`
   - the `link_*` URLs and `organizer_contact`
5. **StrenGames → Fill Weeks tab from season_start.** Leave `checkin_opens` / `checkin_deadline` blank to get the defaults: a week’s report opens on its last day (Friday) and is due the following Thursday at 11:59:59 PM. Or type exact times per week.
6. **Deploy → New deployment → Web app.** Set Execute as **Me** and Who has access **Anyone**. Share the URL.
   After later code edits: Deploy → Manage deployments → edit → **New version**, so the URL stays the same.

## Running the season

| You want to…                                | Do this                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Give someone an extension                   | `Overrides` tab: their TSL username, the week number (or `registration`), and the new deadline                                                                 |
| Accept late reports                         | `allow_late_submissions` = TRUE records them flagged `late`. Untick a row's `late` box to accept it, or set `late_submissions_count` = TRUE to accept them all |
| Someone wants off a team                    | They click **Leave** next to the team on Enlist & Teams (until `team_join_closes`). A departing leader hands off to the earliest-joined member                 |
| Remove a no-show from a team (halfway rule) | `Memberships` tab: untick `active`. They drop out of that team's average                                                                                       |
| Allow only one team per person              | `allow_multiple_teams` = FALSE                                                                                                                                 |
| Change points                               | `points_*` and `agft_max` in Config. Standings recalculate automatically                                                                                       |
| Fix someone's report                        | Edit their row in `Checkins` directly                                                                                                                          |
| Fix a name or merge duplicates              | Edit `Participants`. People log in by TSL username, so typos in names don't split scores                                                                       |
| Reset someone's PIN                         | `Participants` tab: clear their `pin_hash` cell. Their old logins stop working, and the next time they log in they choose a new PIN                            |
| Unlock someone early                        | `Participants` tab: clear their `pin_failures` and `locked_until` cells (or just reset their PIN)                                                              |
| Change or hide the moose                    | `hero_image_url`: blank = built-in animation, an https image URL = your image, `none` = hide it                                                                |
| Bring back last season's roster             | Paste the old enrollment responses into a tab named `Import`, then StrenGames → Import roster from the "Import" tab…                                           |

The standings are cached for 60 seconds. **StrenGames → Refresh standings now** forces an update.

## How scoring works (same as the old sheets, checked against StrenGames VII)

Physical activity and good deeds score 10 per day. Agon and badge requirement score 80 per week. AGFT counts your best score, capped at 500. Meet-up (200), personal goal (250) and bonus challenge (250) each count once.
Each person has one report per week, and editing it replaces the old one. Team score is the members' total divided by the member count, rounded. Teams with 4 or more members are Official.
Re-scoring StrenGames VII's 791 responses with this code gives exactly the same totals as the old spreadsheet: 215 of 215 people and 48 of 48 teams.

## Notes

- **Logging in.** People log in with their TSL username and a 4-digit PIN they choose when they enlist. Anyone enlisted before PINs existed (or imported from last season) chooses one the first time they log in. Until they do, someone else who knows their username could claim it first, so tell everyone to log in and set a PIN early.
- The server works out who is logged in from a signed session token (valid 120 days, kept in the browser). It never takes a participant id from the page, so nobody can file a report or change teams as someone else.
- After 5 wrong PINs in a row the username is locked for 15 minutes. Each further miss doubles the lock, up to 24 hours. A correct PIN clears the count. The **Need help logging in?** link tells people to ask the organizers on the Strenuous Life forums.
- PINs are stored salted and hashed in `pin_hash`, never as typed. With only 10,000 possible PINs, though, anyone with **edit** access to the spreadsheet could work one out (or just edit the data), so share the sheet only with organizers. The session signing key lives in Script Properties (`session_key`); deleting it logs everyone out.
- The deadline rules are enforced on the server, so a stale browser tab can't sneak in a late report.

## Development

```bash
npm test            # logic, server (Apps Script mock) and hand-checked scoring regression tests
```

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run test:e2e    # browser tests: drive the real page in headless Chromium
```

```bash
npm run demo -- "2025-11-14 19:30:00"   # writes test/preview.html with made-up data at that moment
```

| Test file                         | What it covers                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/logic.test.js`              | Deadlines (time zones, daylight saving), overrides, validation, scoring rules                                                                               |
| `test/server.test.js`             | `Code.gs` end to end on an in-memory Apps Script mock: sign-up, teams, leave, rename, check-ins, import                                                     |
| `test/scoring-regression.test.js` | A made-up season whose totals, ranks and team scores were worked out by hand                                                                                |
| `test/e2e.test.js`                | The real page in Chromium: enlist, file and edit a report, badge search, closed weeks, TR's bubble, rename, leave, standings, no sideways scroll on a phone |

All of these run in the **Deploy Apps Script** workflow, and nothing deploys unless they pass.

`tools/cut_moose.py` re-cuts the animation from the original banner GIF.
