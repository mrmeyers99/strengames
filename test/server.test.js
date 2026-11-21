// End-to-end test of Code.gs against the in-memory Apps Script mock.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'),
  vm = require('vm'),
  path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot() {
  const ctx = vm.createContext({ console, Intl });
  vm.runInContext(
    read('src/Logic.gs') +
      '\n' +
      '' +
      '\n' +
      read('src/Code.gs') +
      '\n' +
      fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8'),
    ctx
  );
  const env = ctx.GasMock.install(ctx, ctx.Logic, {
    now: ctx.Logic.zonedToEpoch('2025-10-01 12:00:00', 'America/New_York')
  });
  ctx.setup();
  const cfg = env.ss.getSheetByName('Config');
  const set = (k, v) => {
    const rows = cfg.d;
    const i = rows.findIndex(r => r[0] === k);
    cfg.set(i + 1, 2, v);
  };
  set('season_name', 'StrenGames VIII');
  set('season_start', '2025-10-18');
  set('registration_opens', '2025-09-25 00:00:00');
  set('registration_closes', '2025-10-16 23:59:59');
  set('bonus_challenge_name', 'Tim Werth Bonus Challenge');
  set('bonus_reveal_at', '2025-10-18 00:00:00');
  ctx.fillWeeks();
  return { ctx, env, set, at: s => ctx.Logic.zonedToEpoch(s, 'America/New_York') };
}

test('full season flow', () => {
  const { ctx, env, set, at } = boot();
  const b = ctx.getBootstrap();
  assert.strictEqual(b.season.name, 'StrenGames VIII');
  assert.strictEqual(b.season.weeks.length, 6);
  assert.strictEqual(b.season.weeks[0].deadlineLabel, 'Thu 30 Oct, 11:59 PM EDT');
  assert.strictEqual(b.registration.state, 'open');
  // Handbook requirement text is never sent to the public page
  assert.strictEqual(b.badgeRequirements, undefined);
  assert.strictEqual(b.season.bonus.revealed, false);
  assert.strictEqual(b.season.bonus.name, 'Bonus Challenge', 'real name hidden before reveal');

  const r1 = ctx.signup({
    pin: '1234',
    name: '  Wyatt   Holloway ',
    username: '@Ridge-Runner',
    teams: [],
    newTeam: 'Bull Moose Brigade'
  });
  assert.strictEqual(r1.participant.name, 'Wyatt Holloway');
  assert.strictEqual(r1.participant.username, 'ridge-runner');
  assert.deepStrictEqual(Array.from(r1.joined), ['Bull Moose Brigade']);
  assert.strictEqual(r1.bootstrap.teams[0].leader, 'Wyatt Holloway');
  assert.throws(() => ctx.signup({ pin: '1234', name: 'Wyatt H', username: 'ridge-runner' }), /already enlisted/);

  const r2 = ctx.signup({ pin: '1234', name: 'Silas Crane', username: 'bull-moose', teams: ['bull moose BRIGADE'] });
  assert.deepStrictEqual(Array.from(r2.joined), ['Bull Moose Brigade'], 'case-insensitive match to existing team');
  const sam = r2.token,
    trevor = r1.token;
  const j = ctx.joinTeams({ token: sam, teams: ['Bull Moose Brigade'], newTeam: 'Pacific Pathfinders' });
  assert.deepStrictEqual(Array.from(j.joined), ['Pacific Pathfinders']);

  // registration closes
  env.clock.now = at('2025-10-17 00:00:01');
  assert.throws(() => ctx.signup({ pin: '1234', name: 'Late Larry', username: 'larry' }), /Registration closed/);
  assert.throws(() => ctx.joinTeams({ token: sam, teams: ['Bull Moose Brigade'] }), /Team changes closed/);
  // personal registration extension
  env.ss.getSheetByName('Overrides').appendRow(['@larry', 'registration', '2025-10-18 12:00:00', 'travel']);
  assert.ok(ctx.signup({ pin: '1234', name: 'Late Larry', username: 'larry' }).token);

  // week 1 check-ins
  assert.throws(() => ctx.submitCheckin({ token: sam, week: 1, pa_days: 3 }), /isn.t open yet/);
  env.clock.now = at('2025-10-25 09:00:00');
  assert.strictEqual(ctx.getBootstrap().season.bonus.name, 'Tim Werth Bonus Challenge');
  let res = ctx.submitCheckin({
    token: trevor,
    week: 1,
    pa_days: 7,
    deed_days: 7,
    agon: true,
    badge_done: true,
    badge_requirement: 'Knotsmanship — Req 1',
    badge_requirement_id: 'knotsmanship-1',
    agft: '393',
    meetup: false,
    personal_goal: false,
    bonus: false
  });
  assert.strictEqual(res.record.score.total, 70 + 70 + 80 + 80 + 393);
  // edit (upsert) — still one row
  res = ctx.submitCheckin({
    token: trevor,
    week: 1,
    pa_days: 6,
    deed_days: 7,
    agon: true,
    badge_done: true,
    badge_requirement: 'Knotsmanship — Req 1',
    badge_requirement_id: 'knotsmanship-1',
    agft: '393',
    meetup: true
  });
  assert.strictEqual(env.ss.getSheetByName('Checkins').getLastRow(), 2);
  assert.strictEqual(res.record.score.total, 60 + 70 + 80 + 80 + 393 + 200);
  assert.strictEqual(res.record.weeks[0].submitted, true);
  assert.strictEqual(res.record.pastBadgeRequirements[0].text, 'Knotsmanship — Req 1');
  ctx.submitCheckin({ token: sam, week: 1, pa_days: 2, deed_days: 4 });

  // deadline passes; late rejected, override accepted
  env.clock.now = at('2025-10-31 00:00:05');
  assert.throws(() => ctx.submitCheckin({ token: sam, week: 1, pa_days: 7 }), /deadline .* passed/);
  env.ss.getSheetByName('Overrides').appendRow(['bull-moose', '1', '2025-11-01 23:59:59', '']);
  ctx.submitCheckin({ token: sam, week: 1, pa_days: 5, deed_days: 4 });
  // late mode
  set('allow_late_submissions', 'TRUE');
  env.clock.now = at('2025-11-03 10:00:00');
  const late = ctx.submitCheckin({
    token: r1.token,
    week: 1,
    pa_days: 7,
    deed_days: 7,
    agon: true,
    badge_done: true,
    badge_requirement: 'x',
    agft: 393,
    meetup: true
  });
  assert.strictEqual(late.late, true);
  assert.strictEqual(late.record.score.total, 0, 'late row replaces the on-time one and does not count');
  set('late_submissions_count', 'TRUE');
  ctx.clearStandingsCache();

  const st = ctx.getStandings();
  assert.strictEqual(st.individuals[0].name, 'Wyatt Holloway');
  assert.strictEqual(st.teamsOfficial.length, 0);
  const brigade = st.teamsUnofficial.find(t => t.name === 'Bull Moose Brigade');
  assert.strictEqual(brigade.size, 2);
  assert.strictEqual(brigade.score, Math.round((st.individuals.find(p => p.name === 'Wyatt Holloway').total + 90) / 2));
  assert.strictEqual(st.perfectScore, 3000);
  // JSON-serialisable (what google.script.run requires)
  JSON.parse(JSON.stringify(ctx.getMyRecord(sam)));
});

test('single-team mode and removed members', () => {
  const { ctx, env, set } = boot();
  set('allow_multiple_teams', 'FALSE');
  assert.throws(
    () => ctx.signup({ pin: '1234', name: 'A B', username: 'ab', teams: ['X'], newTeam: 'Y' }),
    /only one team/
  );
  const a = ctx.signup({ pin: '1234', name: 'A B', username: 'ab', newTeam: 'X' }).token;
  assert.throws(() => ctx.joinTeams({ token: a, newTeam: 'Y' }), /only one team/);
  set('allow_multiple_teams', 'TRUE');
  const mem = env.ss.getSheetByName('Memberships');
  mem.set(2, 5, false); // organizer unticks "active"
  assert.throws(() => ctx.joinTeams({ token: a, teams: ['X'] }), /removed from X/);
  assert.throws(() => ctx.getMyRecord('nope'), /log in again/);
});

test('roster import reads the local Import tab', () => {
  const { ctx, env } = boot();
  const imp = env.ss.insertSheet('Import');
  [
    ['Timestamp', 'Your Name', 'Your TSL Username', 'Team(s) you want to join'],
    ['10/1/2025', 'Wyatt Holloway', 'Ridge Runner', 'Bull Moose Brigade, Rocky Mountain Rangers'],
    ['10/1/2025', 'Silas Crane', '@bull-moose', 'Bull Moose Brigade'],
    ['10/2/2025', 'Wyatt Holloway', 'Ridge Runner', 'Bull Moose Brigade']
  ].forEach(r => imp.appendRow(r));
  const n = ctx.importRoster();
  assert.deepStrictEqual({ ...n }, { people: 2, teams: 2, memberships: 3 });
  assert.deepStrictEqual({ ...ctx.importRoster() }, { people: 0, teams: 0, memberships: 0 }, 'idempotent');
});

test('participant can fix their name everywhere', () => {
  const { ctx, env } = boot();
  const r = ctx.signup({ pin: '1234', name: 'Jebediah Smtih', username: 'mm', newTeam: 'Gulf Coast Grit' });
  env.clock.now = ctx.Logic.zonedToEpoch('2025-10-25 09:00:00', 'America/New_York');
  ctx.submitCheckin({ token: r.token, week: 1, pa_days: 3 });
  const res = ctx.renameParticipant({ token: r.token, name: '  Jebediah   Smith ' });
  assert.strictEqual(res.record.participant.name, 'Jebediah Smith');
  for (const [tab, col] of [
    ['Participants', 2],
    ['Memberships', 2],
    ['Checkins', 2],
    ['Teams', 3]
  ]) {
    assert.strictEqual(env.ss.getSheetByName(tab).d[1][col - 1], 'Jebediah Smith', tab);
  }
  assert.strictEqual(ctx.getStandings().individuals[0].name, 'Jebediah Smith');
  assert.throws(() => ctx.renameParticipant({ token: r.token, name: 'M' }), /enter your name/);
});

test('leaving a team: rejoin, leader hand-off, window', () => {
  const { ctx, env, at } = boot();
  const a = ctx.signup({ pin: '1234', name: 'Ann Lead', username: 'ann', newTeam: 'Moose' }).token;
  const b = ctx.signup({ pin: '1234', name: 'Bob Second', username: 'bob', teams: ['Moose'] }).token;
  const c = ctx.signup({ pin: '1234', name: 'Cy Third', username: 'cy', teams: ['Moose'] }).token;
  const teamRow = () => env.ss.getSheetByName('Teams').d[1];
  let r = ctx.leaveTeam({ token: b, team: 'moose' });
  assert.strictEqual(r.left, 'Moose');
  assert.strictEqual(r.bootstrap.teams.find(t => t.name === 'Moose').members, 2);
  ctx.joinTeams({ token: b, teams: ['Moose'] }); // rejoin works
  r = ctx.leaveTeam({ token: a, team: 'Moose' });
  assert.strictEqual(r.newLeader, 'Cy Third', 'earliest remaining member (Bob rejoined later)');
  assert.deepStrictEqual([teamRow()[1], teamRow()[2]], [c.split('.')[0], 'Cy Third']);
  ctx.leaveTeam({ token: c, team: 'Moose' });
  assert.strictEqual(teamRow()[2], 'Bob Second');
  ctx.leaveTeam({ token: b, team: 'Moose' });
  assert.deepStrictEqual([teamRow()[1], teamRow()[2]], ['', '']);
  assert.throws(() => ctx.leaveTeam({ token: b, team: 'Moose' }), /not on that team/);
  ctx.joinTeams({ token: a, teams: ['Moose'] });
  env.clock.now = at('2025-10-17 00:00:01');
  assert.throws(() => ctx.leaveTeam({ token: a, team: 'Moose' }), /Team changes closed/);
});

test('login: PIN, lockout, organizer reset, and no acting as someone else', () => {
  const { ctx, env, at } = boot();
  const ann = ctx.signup({ pin: '4821', name: 'Ann Lead', username: '@Ann', newTeam: 'Moose' });
  const bob = ctx.signup({ pin: '1357', name: 'Bob Second', username: 'bob', teams: ['Moose'] });
  assert.throws(() => ctx.signup({ name: 'No Pin', username: 'np' }), /exactly 4 digits/);
  assert.throws(() => ctx.signup({ pin: '12a4', name: 'Bad Pin', username: 'bp' }), /exactly 4 digits/);

  // the PIN is never stored as typed
  const people = env.ss.getSheetByName('Participants');
  const hdr = people.d[0];
  const cell = (row, col) => people.d[row][hdr.indexOf(col)];
  assert.match(cell(1, 'pin_hash'), /^v1\$[0-9a-f]+\$[0-9a-f]{64}$/);
  assert.ok(!String(cell(1, 'pin_hash')).includes('4821'));

  // step 1 and step 2
  const st = ctx.loginStatus(' @ANN ');
  assert.deepStrictEqual({ ...st }, { username: 'ann', name: 'Ann Lead', hasPin: true, locked: '' });
  assert.throws(() => ctx.loginStatus('ghost'), /No one is enlisted as @ghost/);
  const s = ctx.login({ username: 'ann', pin: '4821' });
  assert.strictEqual(s.participant.name, 'Ann Lead');
  assert.strictEqual(ctx.getMyRecord(s.token).participant.username, 'ann');

  // identity comes only from the token: an id, a forged token, or another person's id in the token fail
  const annId = ann.participant.id;
  assert.throws(() => ctx.getMyRecord(annId), /log in again/);
  assert.throws(() => ctx.submitCheckin({ participantId: annId, week: 1 }), /log in again/);
  const [, exp, sig] = s.token.split('.');
  assert.throws(() => ctx.getMyRecord(bob.participant.id + '.' + exp + '.' + sig), /log in again/);
  assert.throws(() => ctx.getMyRecord(annId + '.' + (Number(exp) + 1) + '.' + sig), /log in again/);
  env.clock.now = at('2025-10-25 09:00:00');
  ctx.submitCheckin({ token: bob.token, participantId: annId, week: 1, pa_days: 3 });
  assert.strictEqual(ctx.getMyRecord(bob.token).weeks[0].submitted, true, 'filed for Bob, the token holder');
  assert.strictEqual(ctx.getMyRecord(s.token).weeks[0].submitted, false, 'nothing filed for Ann');

  // wrong PINs: 4 warnings, then a 15-minute lock that even the right PIN can't get past
  for (let i = 4; i >= 1; i--)
    assert.throws(
      () => ctx.login({ username: 'ann', pin: '0000' }),
      new RegExp(`${i} more tr(y|ies) before this username is locked for 15 minutes`)
    );
  assert.throws(() => ctx.login({ username: 'ann', pin: '0000' }), /Too many tries.*locked.*15 minutes/);
  assert.throws(() => ctx.login({ username: 'ann', pin: '4821' }), /locked. Try again in 15 minutes/);
  assert.match(ctx.loginStatus('ann').locked, /Try again in 15 minutes/);
  assert.throws(() => ctx.login({ username: 'ann', pin: 'abcd' }), /locked/, 'locked before the PIN is even checked');
  // the lock does not touch other people
  assert.ok(ctx.login({ username: 'bob', pin: '1357' }).token);
  // after the lock, each further miss doubles it
  env.clock.now = at('2025-10-25 09:15:01');
  assert.throws(() => ctx.login({ username: 'ann', pin: '9999' }), /Try again in 30 minutes/);
  env.clock.now = at('2025-10-25 09:45:02');
  assert.throws(() => ctx.login({ username: 'ann', pin: '9999' }), /Try again in 1 hour/);
  env.clock.now = at('2025-10-25 10:45:03');
  const ok = ctx.login({ username: 'ann', pin: '4821' });
  assert.ok(ok.token);
  assert.strictEqual(cell(1, 'pin_failures'), '', 'a good login clears the count');
  assert.throws(() => ctx.login({ username: 'ann', pin: '1111' }), /4 more tries/);

  // organizer reset: clear pin_hash -> old sessions die, next login sets a new PIN
  assert.throws(() => ctx.setPin({ username: 'ann', pin: '2222' }), /already has a PIN/);
  people.set(2, hdr.indexOf('pin_hash') + 1, '');
  assert.throws(() => ctx.getMyRecord(ok.token), /log in again/);
  assert.strictEqual(ctx.loginStatus('ann').hasPin, false);
  assert.strictEqual(ctx.login({ username: 'ann', pin: '4821' }).needsPin, true);
  assert.throws(() => ctx.setPin({ username: 'ann', pin: '22' }), /exactly 4 digits/);
  const fresh = ctx.setPin({ username: 'ann', pin: '2222' });
  assert.strictEqual(ctx.getMyRecord(fresh.token).participant.name, 'Ann Lead');
  assert.strictEqual(cell(1, 'pin_failures'), '');
  assert.throws(() => ctx.login({ username: 'ann', pin: '4821' }), /Wrong PIN/, 'old PIN no longer works');

  // sessions expire
  env.clock.now = at('2026-06-01 00:00:00');
  assert.throws(() => ctx.getMyRecord(fresh.token), /expired/);
});
