// Browser tests: drive the real page (Index/Styles/Client + Code.gs on the in-memory Apps Script mock,
// with made-up demo data) in headless Chromium. Run: node --test test/e2e.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'strengames-e2e-'));
const MID_SEASON = path.join(TMP, 'mid-season.html');   // week 4 open, registration + team changes closed
const REG_OPEN = path.join(TMP, 'registration.html');   // registration and team changes open
const QUIPS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'Client.html'), 'utf8');
  const block = src.slice(src.indexOf('var QUIPS = ['), src.indexOf('];', src.indexOf('var QUIPS = [')));
  return [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => JSON.parse('"' + m[1].replace(/"/g, '\\"') + '"'));
})();

let browser;
before(async () => {
  execFileSync('node', [path.join(__dirname, 'build-preview.js'), '2025-11-10 19:30:00', MID_SEASON]);
  execFileSync('node', [path.join(__dirname, 'build-preview.js'), '2025-10-10 12:00:00', REG_OPEN]);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); });

/** Opens a preview; `asMe` remembers the demo's first participant (Arthur Hale) like a returning visitor. */
async function open(file, { asMe = false, view, device } = {}) {
  const context = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); // no network in tests
  await page.goto('file://' + file);
  await page.waitForSelector('#loading', { state: 'hidden' });
  if (asMe) {
    await page.evaluate(() => localStorage.setItem('strengames.me', window.__demoMe));
    await page.reload();
    await page.waitForSelector('#loading', { state: 'hidden' });
  }
  if (view) await page.click(`nav button[data-view=${view}]`);
  return page;
}
async function done(page) {
  assert.deepStrictEqual(page.errors, [], 'no JavaScript errors on the page');
  await page.context().close();
}
const toast = async page => (await page.waitForSelector('.toast.show')).textContent();

test('loads cleanly with header, tabs and version label', async () => {
  const page = await open(MID_SEASON);
  assert.match(await page.textContent('#seasonName'), /StrenGames/);
  assert.strictEqual(await page.locator('nav.tabs button').count(), 5);
  assert.match(await page.textContent('.app-version'), /^StrenGames Hub v\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.ok(await page.isVisible('#mastMoose'), 'animated moose in the header');
  await done(page);
});

test('enlist: new person signs up and starts a team', async () => {
  const page = await open(REG_OPEN);
  await page.click('nav button[data-view=enlist]');
  await page.fill('input[name=name]', 'Percival Stout');
  await page.fill('input[name=username]', '@percy-stout');
  await page.fill('.new-team[data-kind=signup]', 'Granite Grinders');
  await page.click('#signupBtn');
  assert.match(await toast(page), /Welcome to .*Percival.*Joined: Granite Grinders/);
  assert.match(await page.textContent('#whoBtn'), /Percival Stout/);
  await page.waitForSelector('[data-leave="Granite Grinders"]');
  assert.strictEqual(await page.locator('#signupForm').count(), 0, 'no "enlist someone else" form once enlisted');
  await done(page);
});

test('enlist: duplicate TSL username is refused', async () => {
  const page = await open(REG_OPEN, { view: 'enlist' });
  await page.fill('input[name=name]', 'Someone Else');
  await page.fill('input[name=username]', 'arthurhale');
  await page.click('#signupBtn');
  assert.match(await toast(page), /already enlisted/);
  await done(page);
});

test('weekly report: fill, pick a badge requirement, file, then edit', async () => {
  const page = await open(MID_SEASON, { asMe: true, view: 'report' });
  await page.waitForSelector('#reportForm');
  assert.match(await page.textContent('#view-report h2'), /Fourth Week Report/, 'opens on the open, unfiled week');
  await page.click('[data-pips=pa_days] .pip[data-n="5"]');
  await page.click('[data-pips=deed_days] .pip[data-n="7"]');
  await page.click('[data-yn=agon] button[data-v=yes]');
  await page.click('[data-yn=badge_done] button[data-v=yes]');
  // filing without saying which requirement is caught
  await page.click('#submitBtn');
  assert.match(await toast(page), /badge requirement/);
  await page.fill('#badgeInput', 'clove hitch');
  await page.waitForSelector('#badgeList li[data-i="0"]');
  assert.match(await page.textContent('#badgeList li[data-i="0"]'), /Knot Craft/);
  await page.keyboard.press('Enter');
  assert.match(await page.textContent('#badgePicked'), /Knot Craft/);
  assert.match(await page.textContent('#badgePicked'), /Every part must be done/);
  assert.strictEqual(await page.textContent('#tallyNum'), '280'); // 50 + 70 + 80 + 80
  await page.click('#submitBtn');
  assert.match(await toast(page), /Report filed/);
  await page.waitForSelector('.week-chip.done[data-week="4"]');
  // edit: lower physical activity, update
  await page.waitForSelector('#submitBtn:has-text("Update report")');
  await page.click('[data-pips=pa_days] .pip[data-n="3"]');
  assert.strictEqual(await page.textContent('#tallyNum'), '260');
  await page.click('#submitBtn');
  await page.waitForSelector('.toast.show');
  await page.click('nav button[data-view=record]');
  await page.waitForSelector('tr[data-week="4"]');
  assert.match(await page.textContent('tr[data-week="4"]'), /Filed/);
  await done(page);
});

test('weekly report: a closed week is read-only', async () => {
  const page = await open(MID_SEASON, { asMe: true, view: 'report' });
  await page.click('.week-chip[data-week="1"]');
  await page.waitForSelector('.banner.closed');
  assert.ok(await page.isDisabled('[data-pips=pa_days] .pip[data-n="3"]'));
  assert.strictEqual(await page.locator('#submitBtn').count(), 0);
  await done(page);
});

test('TR speech bubble: marking a task makes TR say a line from the list', async () => {
  const page = await open(MID_SEASON, { asMe: true, view: 'report' });
  await page.waitForSelector('#reportForm');
  await page.click('[data-pips=deed_days] .pip[data-n="2"]');
  await page.waitForSelector('#trBubble.show');
  const said = (await page.textContent('#trBubble')).trim();
  assert.ok(QUIPS.includes(said), `"${said}" is one of the quips`);
  // switching back to "No" / lowering days stays quiet
  await page.waitForSelector('#trBubble:not(.show)', { state: 'attached', timeout: 6000 });
  await page.click('[data-pips=deed_days] .pip[data-n="0"]');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('#trBubble.show').count(), 0);
  // scrolled down: the small moose trots in at the corner
  await page.locator('[data-yn=personal_goal]').scrollIntoViewIfNeeded();
  await page.click('[data-yn=personal_goal] button[data-v=yes]');
  await page.waitForSelector('#trFloat.show #trBubble.show');
  await done(page);
});

test('edit name updates the header and record', async () => {
  const page = await open(MID_SEASON, { asMe: true, view: 'record' });
  await page.click('[data-edit-name]');
  await page.fill('[data-name-form] input', '  Arthur   Hale-Smythe ');
  await page.click('[data-name-form] button[type=submit]');
  assert.match(await toast(page), /Name updated to Arthur Hale-Smythe/);
  assert.match(await page.textContent('#whoBtn'), /Arthur Hale-Smythe/);
  assert.match(await page.textContent('#view-record h2'), /Arthur Hale-Smythe/);
  await done(page);
});

test('leave a team (and the leader hands off)', async () => {
  const page = await open(REG_OPEN, { asMe: true, view: 'enlist' });
  await page.waitForSelector('[data-leave]');
  const before = await page.$$eval('[data-leave]', els => els.map(e => e.dataset.leave));
  await page.click(`[data-leave="${before[0]}"]`);
  assert.match(await toast(page), new RegExp(`You left ${before[0]}\\.`));
  await page.waitForFunction(n => document.querySelectorAll('[data-leave]').length === n - 1, before.length);
  await done(page);
});

test('team changes are closed mid-season', async () => {
  const page = await open(MID_SEASON, { asMe: true, view: 'enlist' });
  await page.waitForSelector('#joinBox .small, #joinBox p');
  assert.strictEqual(await page.locator('[data-leave]').count(), 0);
  assert.match(await page.textContent('#joinBox'), /Team changes are closed/);
  await done(page);
});

test('standings: individuals, teams (expandable) and AGFT', async () => {
  const page = await open(MID_SEASON, { asMe: true, view: 'standings' });
  await page.waitForSelector('table.board tbody tr');
  assert.ok(await page.locator('table.board tbody tr').count() >= 20, 'everyone listed');
  assert.strictEqual(await page.locator('tr.me').count(), 1, 'my row highlighted');
  await page.click('.seg button[data-tab=teams]');
  await page.click('tr.expandable >> nth=0');
  await page.waitForSelector('tr.members');
  await page.click('.seg button[data-tab=agft]');
  await page.waitForSelector('table.board tbody tr');
  await page.fill('#standSearch', 'zzzz-nobody');
  await page.waitForSelector('.empty');
  await done(page);
});

test('phone: no sideways scrolling on any tab', async () => {
  const page = await open(MID_SEASON, { asMe: true, device: 'iPhone 13' });
  for (const view of ['report', 'standings', 'record', 'enlist', 'rules']) {
    await page.click(`nav button[data-view=${view}]`);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${view}: page is ${overflow}px too wide`);
  }
  await done(page);
});
