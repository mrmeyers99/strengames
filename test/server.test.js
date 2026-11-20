// End-to-end test of Code.gs against the in-memory Apps Script mock.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot() {
  const ctx = vm.createContext({ console, Intl });
  vm.runInContext(read('src/Logic.gs') + '\n' + '' + '\n' + read('src/Code.gs') + '\n' + fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8'), ctx);
  const env = ctx.GasMock.install(ctx, ctx.Logic, { now: ctx.Logic.zonedToEpoch('2025-10-01 12:00:00', 'America/New_York') });
  ctx.setup();
  const cfg = env.ss.getSheetByName('Config');
  const set = (k, v) => { const rows = cfg.d; const i = rows.findIndex(r => r[0] === k); cfg.set(i + 1, 2, v); };
  set('season_name', 'StrenGames VIII'); set('season_start', '2025-10-18');
  set('registration_opens', '2025-09-25 00:00:00'); set('registration_closes', '2025-10-16 23:59:59');
  set('bonus_challenge_name', 'Tim Werth Bonus Challenge'); set('bonus_reveal_at', '2025-10-18 00:00:00');
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

  const r1 = ctx.signup({ name: '  Wyatt   Holloway ', username: '@Ridge-Runner', teams: [], newTeam: 'Bull Moose Brigade' });
  assert.strictEqual(r1.participant.name, 'Wyatt Holloway');
  assert.strictEqual(r1.participant.username, 'ridge-runner');
  assert.deepStrictEqual(Array.from(r1.joined), ['Bull Moose Brigade']);
  assert.strictEqual(r1.bootstrap.teams[0].leader, 'Wyatt Holloway');
  assert.throws(() => ctx.signup({ name: 'Wyatt H', username: 'ridge-runner' }), /already enlisted/);

  const r2 = ctx.signup({ name: 'Silas Crane', username: 'bull-moose', teams: ['bull moose BRIGADE'] });
  assert.deepStrictEqual(Array.from(r2.joined), ['Bull Moose Brigade'], 'case-insensitive match to existing team');
  const sam = r2.participant.id, trevor = r1.participant.id;
  const j = ctx.joinTeams({ participantId: sam, teams: ['Bull Moose Brigade'], newTeam: 'Pacific Pathfinders' });
  assert.deepStrictEqual(Array.from(j.joined), ['Pacific Pathfinders']);

  // registration closes
  env.clock.now = at('2025-10-17 00:00:01');
  assert.throws(() => ctx.signup({ name: 'Late Larry', username: 'larry' }), /Registration closed/);
  assert.throws(() => ctx.joinTeams({ participantId: sam, teams: ['Bull Moose Brigade'] }), /Team changes closed/);
  // personal registration extension
  env.ss.getSheetByName('Overrides').appendRow(['@larry', 'registration', '2025-10-18 12:00:00', 'travel']);
  assert.ok(ctx.signup({ name: 'Late Larry', username: 'larry' }).participant.id);

  // week 1 check-ins
  assert.throws(() => ctx.submitCheckin({ participantId: sam, week: 1, pa_days: 3 }), /isn.t open yet/);
  env.clock.now = at('2025-10-25 09:00:00');
  assert.strictEqual(ctx.getBootstrap().season.bonus.name, 'Tim Werth Bonus Challenge');
  let res = ctx.submitCheckin({ participantId: trevor, week: 1, pa_days: 7, deed_days: 7, agon: true, badge_done: true,
    badge_requirement: 'Knotsmanship — Req 1', badge_requirement_id: 'knotsmanship-1', agft: '393', meetup: false, personal_goal: false, bonus: false });
  assert.strictEqual(res.record.score.total, 70 + 70 + 80 + 80 + 393);
  // edit (upsert) — still one row
  res = ctx.submitCheckin({ participantId: trevor, week: 1, pa_days: 6, deed_days: 7, agon: true, badge_done: true,
    badge_requirement: 'Knotsmanship — Req 1', badge_requirement_id: 'knotsmanship-1', agft: '393', meetup: true });
  assert.strictEqual(env.ss.getSheetByName('Checkins').getLastRow(), 2);
  assert.strictEqual(res.record.score.total, 60 + 70 + 80 + 80 + 393 + 200);
  assert.strictEqual(res.record.weeks[0].submitted, true);
  assert.strictEqual(res.record.pastBadgeRequirements[0].text, 'Knotsmanship — Req 1');
  ctx.submitCheckin({ participantId: sam, week: 1, pa_days: 2, deed_days: 4 });

  // deadline passes; late rejected, override accepted
  env.clock.now = at('2025-10-31 00:00:05');
  assert.throws(() => ctx.submitCheckin({ participantId: sam, week: 1, pa_days: 7 }), /deadline .* passed/);
  env.ss.getSheetByName('Overrides').appendRow(['bull-moose', '1', '2025-11-01 23:59:59', '']);
  ctx.submitCheckin({ participantId: sam, week: 1, pa_days: 5, deed_days: 4 });
  // late mode
  set('allow_late_submissions', 'TRUE');
  env.clock.now = at('2025-11-03 10:00:00');
  const late = ctx.submitCheckin({ participantId: r1.participant.id, week: 1, pa_days: 7, deed_days: 7, agon: true, badge_done: true, badge_requirement: 'x', agft: 393, meetup: true });
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
  assert.throws(() => ctx.signup({ name: 'A B', username: 'ab', teams: ['X'], newTeam: 'Y' }), /only one team/);
  const a = ctx.signup({ name: 'A B', username: 'ab', newTeam: 'X' }).participant.id;
  assert.throws(() => ctx.joinTeams({ participantId: a, newTeam: 'Y' }), /only one team/);
  set('allow_multiple_teams', 'TRUE');
  const mem = env.ss.getSheetByName('Memberships');
  mem.set(2, 5, false); // organizer unticks "active"
  assert.throws(() => ctx.joinTeams({ participantId: a, teams: ['X'] }), /removed from X/);
  assert.throws(() => ctx.getMyRecord('nope'), /couldn.t find/);
});

test('roster import reads the local Import tab', () => {
  const { ctx, env } = boot();
  const imp = env.ss.insertSheet('Import');
  [['Timestamp', 'Your Name', 'Your TSL Username', 'Team(s) you want to join'],
   ['10/1/2025', 'Wyatt Holloway', 'Ridge Runner', 'Bull Moose Brigade, Rocky Mountain Rangers'],
   ['10/1/2025', 'Silas Crane', '@bull-moose', 'Bull Moose Brigade'],
   ['10/2/2025', 'Wyatt Holloway', 'Ridge Runner', 'Bull Moose Brigade']].forEach(r => imp.appendRow(r));
  const n = ctx.importRoster();
  assert.deepStrictEqual({ ...n }, { people: 2, teams: 2, memberships: 3 });
  assert.deepStrictEqual({ ...ctx.importRoster() }, { people: 0, teams: 0, memberships: 0 }, 'idempotent');
});

test('participant can fix their name everywhere', () => {
  const { ctx, env } = boot();
  const r = ctx.signup({ name: 'Jebediah Smtih', username: 'mm', newTeam: 'Gulf Coast Grit' });
  env.clock.now = ctx.Logic.zonedToEpoch('2025-10-25 09:00:00', 'America/New_York');
  ctx.submitCheckin({ participantId: r.participant.id, week: 1, pa_days: 3 });
  const res = ctx.renameParticipant({ participantId: r.participant.id, name: '  Jebediah   Smith ' });
  assert.strictEqual(res.record.participant.name, 'Jebediah Smith');
  for (const [tab, col] of [['Participants', 2], ['Memberships', 2], ['Checkins', 2], ['Teams', 3]]) {
    assert.strictEqual(env.ss.getSheetByName(tab).d[1][col - 1], 'Jebediah Smith', tab);
  }
  assert.strictEqual(ctx.getStandings().individuals[0].name, 'Jebediah Smith');
  assert.throws(() => ctx.renameParticipant({ participantId: r.participant.id, name: 'M' }), /enter your name/);
});

test('leaving a team: rejoin, leader hand-off, window', () => {
  const { ctx, env, set, at } = boot();
  const a = ctx.signup({ name: 'Ann Lead', username: 'ann', newTeam: 'Moose' }).participant.id;
  const b = ctx.signup({ name: 'Bob Second', username: 'bob', teams: ['Moose'] }).participant.id;
  const c = ctx.signup({ name: 'Cy Third', username: 'cy', teams: ['Moose'] }).participant.id;
  const teamRow = () => env.ss.getSheetByName('Teams').d[1];
  let r = ctx.leaveTeam({ participantId: b, team: 'moose' });
  assert.strictEqual(r.left, 'Moose');
  assert.strictEqual(r.bootstrap.teams.find(t => t.name === 'Moose').members, 2);
  ctx.joinTeams({ participantId: b, teams: ['Moose'] }); // rejoin works
  r = ctx.leaveTeam({ participantId: a, team: 'Moose' });
  assert.strictEqual(r.newLeader, 'Cy Third', 'earliest remaining member (Bob rejoined later)');
  assert.deepStrictEqual([teamRow()[1], teamRow()[2]], [c, 'Cy Third']);
  ctx.leaveTeam({ participantId: c, team: 'Moose' });
  assert.strictEqual(teamRow()[2], 'Bob Second');
  ctx.leaveTeam({ participantId: b, team: 'Moose' });
  assert.deepStrictEqual([teamRow()[1], teamRow()[2]], ['', '']);
  assert.throws(() => ctx.leaveTeam({ participantId: b, team: 'Moose' }), /not on that team/);
  ctx.joinTeams({ participantId: a, teams: ['Moose'] });
  env.clock.now = at('2025-10-17 00:00:01');
  assert.throws(() => ctx.leaveTeam({ participantId: a, team: 'Moose' }), /Team changes closed/);
});
