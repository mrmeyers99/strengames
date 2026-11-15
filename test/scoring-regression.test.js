// Scoring regression test on a made-up season. Every expected number below was worked out BY HAND
// from the StrenGames rules (not produced by the code), so a change to the scoring rules has to
// update this file on purpose.
//
// Rules: physical 10/day, good deed 10/day, Agon 80/week, badge requirement 80/week,
// AGFT = best score capped at 500, meet-up 200 once, personal goal 250 once, bonus 250 once.
// Only each person's latest report per week counts; late reports don't count (default);
// team score = round(sum of active members / active member count); 4+ members = official.
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/Logic.gs');

const season = L.buildSeason({ season_start: '2025-10-18', timezone: 'America/New_York' }, [], L.zonedToEpoch);

const people = [
  ['ada', 'Ada Ironside'], ['bram', 'Bram Holt'], ['cora', 'Cora Vance'], ['dmitri', 'Dmitri Lund'],
  ['edgar', 'Edgar Pike'], ['flora', 'Flora Quinn'], ['gus', 'Gus Marrow'], ['hattie', 'Hattie Rowe']
].map(([id, name]) => ({ id, name, username: id }));

const full = { pa_days: 7, deed_days: 7, agon: true, badge_done: true };
const r = (participant_id, week, fields) => Object.assign({ participant_id, week, submitted_at: 1 }, fields);
const checkins = [
  // Ada: perfect season. 6 x (70+70+80+80) = 1800; AGFT 520 is capped to 500 (300 later doesn't lower it);
  // meet-up claimed twice still counts once (200); goal 250; bonus 250. Total 3000.
  r('ada', 1, { ...full, meetup: true }), r('ada', 2, { ...full, agft: 520 }), r('ada', 3, { ...full, meetup: true }),
  r('ada', 4, { ...full, agft: 300 }), r('ada', 5, { ...full, bonus: true }), r('ada', 6, { ...full, personal_goal: true }),
  // Bram: wk1 50+30+80 = 160; wk2 70+70+80 + meet-up 200 = 420; wk3 resubmitted: the earlier
  // pa=1 report is replaced by 40+20+80+80 = 220. Total 800.
  r('bram', 1, { pa_days: 5, deed_days: 3, agon: true }),
  r('bram', 2, { pa_days: 7, deed_days: 7, badge_done: true, meetup: true }),
  r('bram', 3, { pa_days: 1, submitted_at: 100 }),
  r('bram', 3, { pa_days: 4, deed_days: 2, agon: true, badge_done: true, submitted_at: 200 }),
  // Cora: wk1 30+30 = 60 plus AGFT 455; wk2 is late (would be 500 points) and doesn't count. Total 515.
  r('cora', 1, { pa_days: 3, deed_days: 3, agft: 455 }),
  r('cora', 2, { ...full, meetup: true, late: true }),
  // Dmitri: never reported. 0.
  // Edgar and Gus: 6 x (20+20) = 240, + bonus 250 = 490 each (a tie).
  ...[1, 2, 3, 4, 5, 6].map(w => r('edgar', w, { pa_days: 2, deed_days: 2, bonus: w === 6 })),
  ...[1, 2, 3, 4, 5, 6].map(w => r('gus', w, { pa_days: 2, deed_days: 2, bonus: w === 6 })),
  // Flora: one big week 70+70+80+80 = 300, + goal 250 = 550.
  r('flora', 4, { ...full, personal_goal: true }),
  // Hattie: a report for a week that doesn't exist (7) is ignored; wk1 0+10 = 10.
  r('hattie', 7, { ...full }), r('hattie', 1, { pa_days: 0, deed_days: 1 })
];

const teams = [{ name: 'Iron Rangers', leader_id: 'ada' }, { name: 'Lone Pines' }, { name: 'Night Owls' }, { name: 'Ghost Team' }];
const m = (participant_id, team, active = true) => ({ participant_id, team, active });
const memberships = [
  // Iron Rangers: 3000 + 800 + 0 + 490 = 4290 / 4 = 1072.5, which rounds to 1073. Exactly 4, so official.
  m('ada', 'Iron Rangers'), m('bram', 'Iron Rangers'), m('dmitri', 'Iron Rangers'), m('edgar', 'Iron Rangers'),
  // Lone Pines: 515 + 550 + 3000 (Ada is on two teams) = 4065 / 3 = 1355. Only 3, so unofficial.
  m('cora', 'Lone Pines'), m('flora', 'Lone Pines'), m('ada', 'lone pines'),
  // Night Owls: Gus (listed twice, counts once) + Hattie = 500 / 2 = 250. Bram was removed (inactive).
  m('gus', 'Night Owls'), m('gus', 'Night Owls'), m('hattie', 'Night Owls'), m('bram', 'Night Owls', false),
  // Ghost Team: only an inactive member, so it isn't listed at all.
  m('flora', 'Ghost Team', 'FALSE')
];

const lb = L.leaderboards(season, people, teams, memberships, checkins);

test('individual totals and breakdowns', () => {
  const by = Object.fromEntries(lb.individuals.map(p => [p.id, p]));
  assert.deepStrictEqual(Object.fromEntries(lb.individuals.map(p => [p.id, p.total])),
    { ada: 3000, bram: 800, flora: 550, cora: 515, edgar: 490, gus: 490, hattie: 10, dmitri: 0 });
  assert.deepStrictEqual(
    { physical: by.ada.physical, deeds: by.ada.deeds, agons: by.ada.agons, badges: by.ada.badges, agft: by.ada.agft, meetup: by.ada.meetup, personalGoal: by.ada.personalGoal, bonus: by.ada.bonus },
    { physical: 420, deeds: 420, agons: 480, badges: 480, agft: 500, meetup: 200, personalGoal: 250, bonus: 250 });
  assert.deepStrictEqual(
    { physical: by.bram.physical, deeds: by.bram.deeds, agons: by.bram.agons, badges: by.bram.badges, meetup: by.bram.meetup },
    { physical: 160, deeds: 120, agons: 160, badges: 160, meetup: 200 });
  assert.strictEqual(by.cora.meetup, 0, 'late meet-up does not count');
  assert.deepStrictEqual(Object.fromEntries(lb.individuals.map(p => [p.id, p.weeksReported])),
    { ada: 6, bram: 3, flora: 1, cora: 1, edgar: 6, gus: 6, hattie: 1, dmitri: 0 });
  assert.strictEqual(lb.perfectScore, 3000);
  assert.strictEqual(by.ada.total, lb.perfectScore, 'a perfect season scores the perfect score');
});

test('individual ranking with ties', () => {
  assert.deepStrictEqual(lb.individuals.map(p => `${p.rank} ${p.name}`), [
    '1 Ada Ironside', '2 Bram Holt', '3 Flora Quinn', '4 Cora Vance', '5 Edgar Pike', '5 Gus Marrow', '7 Hattie Rowe', '8 Dmitri Lund'
  ]);
});

test('AGFT board', () => {
  assert.deepStrictEqual(lb.agft.map(p => [p.rank, p.name, p.agft]), [[1, 'Ada Ironside', 500], [2, 'Cora Vance', 455]]);
});

test('team scores, sizes, official/unofficial split', () => {
  assert.deepStrictEqual(lb.teamsOfficial.map(t => [t.rank, t.name, t.size, t.total, t.score]), [[1, 'Iron Rangers', 4, 4290, 1073]]);
  assert.deepStrictEqual(lb.teamsUnofficial.map(t => [t.rank, t.name, t.size, t.total, t.score]), [
    [1, 'Lone Pines', 3, 4065, 1355],
    [2, 'Night Owls', 2, 500, 250]
  ]);
  assert.ok(![...lb.teamsOfficial, ...lb.teamsUnofficial].some(t => t.name === 'Ghost Team'));
  assert.strictEqual(lb.teamsOfficial[0].leaderId, 'ada');
});

test('late reports count when the season allows it', () => {
  const lenient = L.buildSeason({ season_start: '2025-10-18', timezone: 'America/New_York', late_submissions_count: 'TRUE' }, [], L.zonedToEpoch);
  const cora = L.scoreParticipants(lenient, people, checkins).cora;
  // 515 + late wk2 (70+70+80+80 + meet-up 200 = 500) = 1015
  assert.strictEqual(cora.total, 1015);
});
