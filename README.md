# StrenGames Hub

A Google Apps Script web app for **StrenGames**, the six-week Strenuous Life team competition. Participants enlist, join or leave teams, file weekly reports and watch the standings in one place. It replaces the old Google Forms and spreadsheet formula chains.

- **Live app:** https://script.google.com/macros/s/AKfycbyYQTpEqrMEP4LcEhUI-uY_RgkAfv49P2YbAULIjaBz3WSJGySrx4PdnCk13IPNm9y3Uw/exec
- **Friendly address (GitHub Pages):** https://mrmeyers99.github.io/strengames/ frames the live app
- **Demo with made-up data:** https://mrmeyers99.github.io/strengames/demo.html

## Repository layout

| Path | What it is |
|---|---|
| `src/Code.gs` | Server: reads and writes the Hub spreadsheet, enforces deadlines, serves the page |
| `src/Logic.gs` | Scoring, deadline windows and validation (pure JS, unit-tested) |
| `src/Index.html`, `Styles.html`, `Client.html` | The web page |
| `src/HeroImage.html` | The animated TR-on-moose in the header (WebP data URI; used with permission) |
| `src/appsscript.json` | Manifest: limited to the bound spreadsheet (`spreadsheets.currentonly`) |
| `test/` | Node tests on an in-memory Apps Script mock, plus the demo builder |
| `tools/` | `parse_handbook.py` (badge list from the Handbook PDF) and `cut_moose.py` (animation cutout) |
| `docs/` | GitHub Pages site |
| `.github/workflows/` | `deploy.yml` (test, then push and deploy to Apps Script) and `pages.yml` (publish `docs/` and the demo) |

> **Badge requirements:** the Handbook's requirement text is copyrighted, so it isn't in this public repo. The live sheet's `BadgeRequirements` tab holds the list. For a new season, copy that tab into the new sheet, or regenerate it with `tools/parse_handbook.py` and paste it in.

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
3. Pick **setup** in the function dropdown, then press **Run** and authorize. This creates the tabs and default settings. Copy the badge requirements into the `BadgeRequirements` tab (see the note above). Reload the sheet; a **StrenGames** menu appears.
4. In the **Config** tab, set at least these. All times are in `timezone`.
   - `season_name`, `season_start` (the first Saturday, `yyyy-MM-dd`)
   - `registration_opens`, `registration_closes` (`yyyy-MM-dd HH:mm:ss`)
   - `bonus_challenge_name` / `bonus_challenge_description` / `bonus_reveal_at`
   - the `link_*` URLs and `organizer_contact`
5. **StrenGames → Fill Weeks tab from season_start.** Leave `checkin_opens` / `checkin_deadline` blank to get the defaults: a week opens when it starts and is due the following Thursday at 11:59:59 PM. Or type exact times per week.
6. **Deploy → New deployment → Web app.** Set Execute as **Me** and Who has access **Anyone**. Share the URL.
   After later code edits: Deploy → Manage deployments → edit → **New version**, so the URL stays the same.

## Running the season

| You want to… | Do this |
|---|---|
| Give someone an extension | `Overrides` tab: their TSL username, the week number (or `registration`), and the new deadline |
| Accept late reports | `allow_late_submissions` = TRUE records them flagged `late`. Untick a row's `late` box to accept it, or set `late_submissions_count` = TRUE to accept them all |
| Someone wants off a team | They click **Leave** next to the team on Enlist & Teams (until `team_join_closes`). A departing leader hands off to the earliest-joined member |
| Remove a no-show from a team (halfway rule) | `Memberships` tab: untick `active`. They drop out of that team's average |
| Allow only one team per person | `allow_multiple_teams` = FALSE |
| Change points | `points_*` and `agft_max` in Config. Standings recalculate automatically |
| Fix someone's report | Edit their row in `Checkins` directly |
| Fix a name or merge duplicates | Edit `Participants`. People pick their name from a list, so typos no longer split scores |
| Add community badges | Add rows to `BadgeRequirements` (id, badge, requirement, text) |
| Change or hide the moose | `hero_image_url`: blank = built-in animation, an https image URL = your image, `none` = hide it |
| Bring back last season's roster | Paste the old enrollment responses into a tab named `Import`, then StrenGames → Import roster from the "Import" tab… |

The standings are cached for 60 seconds. **StrenGames → Refresh standings now** forces an update.

## How scoring works (same as the old sheets, checked against StrenGames VII)
Physical activity and good deeds score 10 per day. Agon and badge requirement score 80 per week. AGFT counts your best score, capped at 500. Meet-up (200), personal goal (250) and bonus challenge (250) each count once.
Each person has one report per week, and editing it replaces the old one. Team score is the members' total divided by the member count, rounded. Teams with 4 or more members are Official.
Re-scoring StrenGames VII's 791 responses with this code gives exactly the same totals as the old spreadsheet: 215 of 215 people and 48 of 48 teams.

## Notes
- As with the Google Forms, there is no login: anyone with the link could file a report under any name. That matches TSL's honor system; the `Checkins` tab records every submission time.
- The deadline rules are enforced on the server, so a stale browser tab can't sneak in a late report.

## Development
```bash
node --test test/logic.test.js test/server.test.js   # unit + end-to-end tests on an Apps Script mock
node test/build-preview.js "2025-11-10 19:30:00"   # writes test/preview.html with made-up demo data
```
`tools/cut_moose.py` re-cuts the animation from the original banner GIF (`python3 tools/cut_moose.py tsl-banner-desktop.gif out.webp 220 2 45`). `tools/parse_handbook.py` regenerates the badge list from `pdftotext -layout` output of the Handbook.
