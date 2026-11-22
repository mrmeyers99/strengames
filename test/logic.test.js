const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/Logic.gs');
const tz = 'America/New_York';
const at = s => L.zonedToEpoch(s, tz);
const base = {
  season_start: '2025-10-18',
  timezone: tz,
  registration_opens: '2025-09-25 00:00:00',
  registration_closes: '2025-10-16 23:59:59'
};
const season = (extra, weeks) => L.buildSeason(Object.assign({}, base, extra), weeks || [], L.zonedToEpoch);

test('zonedToEpoch handles EDT and EST', () => {
  assert.strictEqual(new Date(at('2025-10-16 23:59:59')).toISOString(), '2025-10-17T03:59:59.000Z'); // EDT -4
  assert.strictEqual(new Date(at('2025-11-27 23:59:59')).toISOString(), '2025-11-28T04:59:59.000Z'); // EST -5
});

test('default weeks: 6 weeks Sat–Fri, due following Thursday 23:59:59 local', () => {
  const s = season();
  assert.strictEqual(s.weeks.length, 6);
  assert.deepStrictEqual([s.weeks[0].startDate, s.weeks[0].endDate], ['2025-10-18', '2025-10-24']);
  assert.strictEqual(s.weeks[0].deadlineLocal, '2025-10-30 23:59:59');
  // week 2 ends Oct 31, deadline Nov 6 — after the Nov 2 DST change, still 23:59:59 local
  assert.strictEqual(s.weeks[1].deadlineLocal, '2025-11-06 23:59:59');
  assert.strictEqual(new Date(s.weeks[1].deadline).toISOString(), '2025-11-07T04:59:59.000Z');
  assert.strictEqual(s.weeks[5].deadlineLocal, '2025-12-04 23:59:59');
  assert.strictEqual(L.perfectScore(s), 3000);
});

test('explicit week times override defaults; grace/time config respected', () => {
  const s = season({ default_deadline_grace_days: 1, default_deadline_time: '12:00:00' }, [
    { week: 1, start_date: '2025-10-18', end_date: '2025-10-24', checkin_deadline: '2025-10-26 20:00' },
    { week: 2, start_date: '2025-10-25', end_date: '2025-10-31' }
  ]);
  assert.strictEqual(s.weeks[0].deadlineLocal, '2025-10-26 20:00:00');
  assert.strictEqual(s.weeks[1].deadlineLocal, '2025-11-01 12:00:00');
});

test('registration window', () => {
  const s = season();
  assert.strictEqual(L.registrationStatus(s, at('2025-09-24 23:59:59')).state, 'upcoming');
  assert.strictEqual(L.registrationStatus(s, at('2025-10-16 23:59:59')).state, 'open');
  assert.strictEqual(L.registrationStatus(s, at('2025-10-17 00:00:00')).state, 'closed');
  assert.strictEqual(L.registrationStatus(s, at('2025-10-17 08:00:00'), at('2025-10-17 12:00:00')).state, 'open'); // personal extension
  assert.strictEqual(L.teamJoinStatus(s, at('2025-10-17 00:00:01')).state, 'closed');
  assert.strictEqual(
    L.teamJoinStatus(season({ team_join_closes: '2025-10-20 23:59:59' }), at('2025-10-18 10:00:00')).state,
    'open'
  );
});

test('check-in windows, late handling, overrides', () => {
  const s = season();
  assert.strictEqual(L.canSubmit(s, 1, at('2025-10-17 23:00:00')).ok, false); // before week starts
  assert.strictEqual(s.weeks[0].opensLocal, '2025-10-24 00:00:00'); // opens on the week's last day (Fri)
  assert.strictEqual(L.canSubmit(s, 1, at('2025-10-23 23:59:59')).ok, false); // mid-week: not yet
  assert.deepStrictEqual(L.canSubmit(s, 1, at('2025-10-24 00:00:00')), { ok: true, late: false });
  assert.strictEqual(L.canSubmit(season({ default_opens_offset_days: 0 }), 1, at('2025-10-18 09:00:00')).ok, true);
  assert.deepStrictEqual(L.canSubmit(s, 1, at('2025-10-30 23:59:59')), { ok: true, late: false });
  assert.strictEqual(L.canSubmit(s, 1, at('2025-10-31 00:00:00')).ok, false);
  assert.deepStrictEqual(L.canSubmit(s, 1, at('2025-10-31 00:00:00'), at('2025-11-01 23:59:59')), {
    ok: true,
    late: false
  });
  const lateOk = season({ allow_late_submissions: 'TRUE' });
  assert.deepStrictEqual(L.canSubmit(lateOk, 1, at('2025-11-15 09:00:00')), { ok: true, late: true });
  assert.throws(() => L.weekStatus(s, 9, Date.now()), /Unknown week/);
});

test('bonus reveal', () => {
  const s = season({ bonus_reveal_at: '2025-10-18 08:00:00' });
  assert.strictEqual(L.bonusRevealed(s, at('2025-10-18 07:59:59')), false);
  assert.strictEqual(L.bonusRevealed(s, at('2025-10-18 08:00:00')), true);
  const v = L.validateCheckin({ week: 1, bonus: true }, s, false);
  assert.strictEqual(v.bonus, false);
});

test('validation', () => {
  const s = season();
  assert.throws(() => L.validateCheckin({ week: 1, pa_days: 8 }, s, true), /0 to 7/);
  assert.throws(() => L.validateCheckin({ week: 1, pa_days: 2.5 }, s, true), /0 to 7/);
  assert.throws(() => L.validateCheckin({ week: 1, badge_done: true }, s, true), /badge requirement/);
  assert.throws(() => L.validateCheckin({ week: 1, agft: 501 }, s, true), /AGFT/);
  assert.throws(() => L.validateCheckin({ week: 7 }, s, true), /valid week/);
  const v = L.validateCheckin(
    {
      week: '2',
      pa_days: '7',
      deed_days: '',
      badge_done: 'true',
      badge_requirement: ' Knotsmanship — Req 1 ',
      agft: ''
    },
    s,
    true
  );
  assert.deepStrictEqual(
    [v.week, v.pa_days, v.deed_days, v.badge_done, v.badge_requirement, v.agft],
    [2, 7, 0, true, 'Knotsmanship — Req 1', '']
  );
  assert.strictEqual(
    L.validateCheckin({ week: 1, badge_done: false, badge_requirement: 'x' }, s, true).badge_requirement,
    ''
  );
});

test('scoring: once-per-season items, AGFT cap, late exclusion, inactive members', () => {
  const s = season({ agft_max: 500 });
  const people = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D' }
  ];
  const ck = [
    {
      participant_id: 'a',
      week: 1,
      pa_days: 7,
      deed_days: 7,
      agon: true,
      badge_done: true,
      agft: 450,
      meetup: true,
      personal_goal: false,
      bonus: false
    },
    {
      participant_id: 'a',
      week: 2,
      pa_days: 7,
      deed_days: 7,
      agon: true,
      badge_done: true,
      agft: 999,
      meetup: true,
      personal_goal: true,
      bonus: true
    },
    {
      participant_id: 'b',
      week: 1,
      pa_days: 3,
      deed_days: 0,
      agon: false,
      badge_done: false,
      agft: '',
      meetup: false,
      late: true
    },
    { participant_id: 'c', week: 1, pa_days: 1, deed_days: 1 }
  ];
  const sc = L.scoreParticipants(s, people, ck);
  assert.strictEqual(sc.a.total, 2 * (70 + 70 + 80 + 80) + 500 + 200 + 250 + 250);
  assert.strictEqual(sc.b.total, 0, 'late excluded by default');
  assert.strictEqual(L.scoreParticipants(season({ late_submissions_count: true }), people, ck).b.total, 30);
  const t = L.teamStandings(
    s,
    [{ name: 'Alpha', leader_id: 'a' }, { name: 'Tiny' }],
    [
      { participant_id: 'a', team: 'Alpha', active: true },
      { participant_id: 'b', team: 'alpha', active: true },
      { participant_id: 'c', team: 'Alpha', active: true },
      { participant_id: 'd', team: 'Alpha', active: true },
      { participant_id: 'c', team: 'Alpha', active: true },
      { participant_id: 'c', team: 'Tiny', active: false }
    ],
    sc
  );
  assert.strictEqual(t.official.length, 1);
  assert.strictEqual(t.official[0].size, 4, 'duplicate membership counted once');
  assert.strictEqual(t.official[0].score, Math.round((sc.a.total + 0 + 20 + 0) / 4));
  assert.strictEqual(t.unofficial.length, 0, 'team with only inactive members disappears');
});

test('leaderboards rank ties as 1,2,2,4', () => {
  const s = season();
  const people = ['p', 'q', 'r', 's'].map(id => ({ id, name: id.toUpperCase() }));
  const ck = [
    { participant_id: 'p', week: 1, pa_days: 5 },
    { participant_id: 'q', week: 1, pa_days: 3 },
    { participant_id: 'r', week: 1, pa_days: 3 }
  ];
  const lb = L.leaderboards(s, people, [], [], ck);
  assert.deepStrictEqual(
    lb.individuals.map(x => x.rank + x.id),
    ['1p', '2q', '2r', '4s']
  );
});
