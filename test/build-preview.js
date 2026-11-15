// Builds preview.html: the real Index/Styles/Client + Code.gs running on the in-memory mock with fake demo data.
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const has = f => fs.existsSync(path.join(__dirname, '..', 'src', f));
const nowLocal = process.argv[2] || '2025-11-10 19:30:00';
const outFile = process.argv[3] || path.join(__dirname, 'preview.html');
// Tiny made-up badge list for the public demo (the real Handbook list is not in this repo).
const DEMO_BADGES = [
  ['knots-1', 'Knot Craft', 'Req 1', 'Tie a square knot, bowline, clove hitch and taut-line hitch without a guide: (a) Square knot (b) Bowline (c) Clove hitch (d) Taut-line hitch'],
  ['knots-2', 'Knot Craft', 'Req 2', 'Lash two poles together with a square lashing.'],
  ['fire-1', 'Campfire', 'Req 1', 'Build and light a fire with a single match.'],
  ['ruck-1', 'Rucking', 'Req 1', 'Ruck 5 miles carrying 20 lbs.'],
  ['letters-1', 'Correspondence', 'Req 1', 'Write and mail a handwritten letter to an old friend.'],
  ['chef-1', 'Camp Cook', 'Req 1', 'Cook a full meal outdoors over coals.']
];
const seed = `
<script>${fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8')}</script>
<script>${R('Logic.gs')}</script>
<script>${has('BadgeData.gs') ? R('BadgeData.gs') : 'var BADGE_SEED = ' + JSON.stringify(DEMO_BADGES) + ';'}</script>
<script>${R('Code.gs')}</script>
<script>
(function () {
  var env = GasMock.install(window, Logic, { now: Logic.zonedToEpoch('2025-10-01 12:00:00', 'America/New_York') });
  setup();
  var cfg = env.ss.getSheetByName('Config');
  function set(k, v) { var i = cfg.d.findIndex(function (r) { return r[0] === k; }); cfg.set(i + 1, 2, v); }
  set('season_name', 'StrenGames VIII'); set('season_start', '2025-10-18');
  set('registration_opens', '2025-09-25 00:00:00'); set('registration_closes', '2025-10-16 23:59:59');
  set('team_join_closes', '2025-10-24 23:59:59');
  set('bonus_challenge_name', 'Tim Werth Bonus Challenge'); set('bonus_challenge_description', 'Complete a 20-mile ruck over the six weeks.');
  set('bonus_reveal_at', '2025-10-18 00:00:00');
  set('link_agft_chart', 'https://example.com/agft'); set('link_personal_goals_thread', 'https://example.com/goals');
  fillWeeks();
  var first = ['Arthur','Silas','Gideon','Wyatt','Elias','Hollis','Jasper','Amos','Calvin','Rufus','Otis','Walter','Ezra','Felix','Harlan','Ira','Leland','Milo','Nolan','Porter','Quincy','Reuben','Sterling','Thaddeus','Virgil','Warren','Abel','Booker','Clement','Dorian'];
  var last = ['Hale','Brandt','Crowley','Dunmore','Ellery','Finch','Garrow','Hatch','Ingram','Jessup','Keane','Lockhart','Mercer','Nash','Orwell','Pike','Quill','Rook','Stroud','Tolliver','Upton','Vance','Wilder','Yates','Ashby','Bristow','Carver','Drury','Eames','Fenwick'];
  var teams = ['Bull Moose Brigade', 'Rough Riders of the Rockies', 'Northwoods Lumberjacks', 'Gulf Coast Grit', 'The Arena Men', 'Solo Sentinels'];
  var rnd = (function (s) { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })(42);
  var ids = [];
  first.forEach(function (f, i) {
    var t = [teams[i % 5]]; if (i % 7 === 0) t.push(teams[(i + 2) % 5]); if (i === 29) t = [teams[5]];
    var r = signup({ name: f + ' ' + last[i], username: (f + last[i]).toLowerCase(), teams: t });
    ids.push(r.participant.id);
  });
  var reqs = BADGE_SEED;
  [1, 2, 3, 4].forEach(function (w) {
    env.clock.now = Logic.zonedToEpoch(Logic.addDays('2025-10-18', 7 * (w - 1) + 7) + ' 10:00:00', 'America/New_York');
    ids.forEach(function (id, i) {
      if (i === 0 && w === 4) return; // leave "me" a week to fill in
      if (rnd() < 0.15) return;
      var badge = rnd() < 0.6, q = reqs[Math.floor(rnd() * reqs.length)];
      submitCheckin({ participantId: id, week: w, pa_days: Math.floor(rnd() * 8), deed_days: 3 + Math.floor(rnd() * 5), agon: rnd() < 0.75,
        badge_done: badge, badge_requirement: badge ? q[1] + ' \\u2014 ' + q[2] + ': ' + q[3] : '', badge_requirement_id: badge ? q[0] : '',
        agft: rnd() < 0.15 ? Math.floor(150 + rnd() * 300) : '', meetup: rnd() < 0.12, personal_goal: w === 4 && rnd() < 0.3, bonus: w >= 3 && rnd() < 0.2 });
    });
  });
  env.clock.now = Logic.zonedToEpoch('${nowLocal}', 'America/New_York');
  window.MockServer = { getBootstrap: getBootstrap, signup: signup, joinTeams: joinTeams, getMyRecord: getMyRecord, submitCheckin: submitCheckin, getStandings: getStandings, renameParticipant: renameParticipant, leaveTeam: leaveTeam };
  window.__demoMe = ids[0];
})();
</script>`;
let html = R('Index.html')
  .replace("<?!= include('Styles'); ?>", R('Styles.html'))
  .replace("<?!= include('Client'); ?>", seed + '\n' + R('Client.html'))
  .replace("<?!= JSON.stringify(heroSrc_()) ?>", JSON.stringify(has('HeroImage.html') ? R('HeroImage.html').trim() : ''));
fs.writeFileSync(outFile, html);
console.log('wrote preview.html', html.length);
