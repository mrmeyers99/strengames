/**
 * @OnlyCurrentDoc  — limits this script to the spreadsheet it is bound to.
 *
 * StrenGames Hub — Apps Script server.
 * Bind this project to the "StrenGames Hub" spreadsheet (Extensions → Apps Script),
 * run setup() once, then Deploy → New deployment → Web app.
 */

var SCHEMA = {
  Config: ['key', 'value', 'notes'],
  Weeks: ['week', 'label', 'start_date', 'end_date', 'checkin_opens', 'checkin_deadline'],
  Participants: ['id', 'name', 'tsl_username', 'created_at', 'pin_hash', 'pin_failures', 'locked_until'],
  Teams: ['name', 'leader_id', 'leader_name', 'created_at'],
  Memberships: ['participant_id', 'name', 'team', 'joined_at', 'active'],
  Checkins: [
    'participant_id',
    'name',
    'week',
    'pa_days',
    'deed_days',
    'agon',
    'badge_done',
    'badge_requirement',
    'badge_requirement_id',
    'agft',
    'meetup',
    'personal_goal',
    'bonus',
    'late',
    'submitted_at',
    'first_submitted_at'
  ],
  Overrides: ['tsl_username', 'week', 'new_deadline', 'note']
};

var CONFIG_NOTES = {
  season_name: 'Shown in the header',
  timezone: 'IANA name, e.g. America/New_York. All dates below are in this zone.',
  season_start: 'yyyy-MM-dd — first day of week 1 (used to pre-fill the Weeks tab)',
  week_count: 'Number of weeks',
  registration_opens: 'yyyy-MM-dd HH:mm:ss — sign-up opens',
  registration_closes: 'yyyy-MM-dd HH:mm:ss — sign-up closes',
  team_join_closes: 'Last moment enlisted folks can join extra teams (blank = registration_closes)',
  default_opens_offset_days: 'If a week has no checkin_opens: opens this many days after week start',
  default_deadline_grace_days:
    'If a week has no checkin_deadline: due this many days after week end (6 = following Thursday)',
  default_deadline_time: 'HH:mm:ss for default deadlines',
  allow_late_submissions: 'TRUE = accept after deadline but flag as late',
  late_submissions_count: 'TRUE = late check-ins still score (or clear the late box per row to accept one)',
  allow_multiple_teams: 'TRUE = people may join more than one team',
  min_official_team_size: 'Teams smaller than this are listed as Unofficial',
  points_physical_per_day: '',
  points_deed_per_day: '',
  points_agon_per_week: '',
  points_badge_per_week: '',
  agft_max: 'AGFT best score is capped at this',
  points_meetup: 'Once per season',
  points_personal_goal: 'Once per season',
  points_bonus: 'Once per season',
  bonus_challenge_name: 'e.g. Tim Werth Bonus Challenge',
  bonus_challenge_description: 'Shown once revealed',
  bonus_reveal_at: 'yyyy-MM-dd HH:mm:ss — hidden until then (blank = visible)',
  link_agft_chart: '',
  link_personal_goals_thread: '',
  link_faq: '',
  link_community_badges: '',
  link_group: '',
  organizer_contact: 'Shown on the Rules tab',
  tagline: 'Short motto shown in the header',
  hero_image_url:
    'Header image. Blank = the built-in animated TR-on-moose; an https image URL replaces it; "none" hides it.',
  hero_image_alt: 'Description of that image for screen readers'
};

var CACHE_KEY = 'standings_v1';
var LOCAL_FMT = 'yyyy-MM-dd HH:mm:ss';

// ---------------------------------------------------------------- entry points

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(getSeason_().name || 'StrenGames')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Image shown in the header and on the Enlist page: built-in animation, a custom URL, or none. */
function heroSrc_() {
  var v = Logic.str(readConfig_().hero_image_url);
  if (/^none$/i.test(v)) return '';
  if (/^https:\/\//i.test(v)) return v;
  try {
    return include('HeroImage').trim();
  } catch (e) {
    return '';
  }
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('StrenGames')
    .addItem('Set up / repair tabs', 'setup')
    .addItem('Fill Weeks tab from season_start', 'fillWeeks')
    .addItem('Refresh standings now', 'clearStandingsCache')
    .addSeparator()
    .addItem('Import roster from the "Import" tab…', 'importRosterPrompt')
    .addToUi();
}

// ---------------------------------------------------------------- setup

function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SCHEMA[name];
    var existing = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    headers.forEach(function (h) {
      if (existing.indexOf(h) === -1) {
        existing.push(h);
        sh.getRange(1, existing.length).setValue(h);
      }
    });
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#f3ead7');
  });
  // Config defaults
  var cfg = ss.getSheetByName('Config');
  var have = {};
  if (cfg.getLastRow() > 1)
    cfg
      .getRange(2, 1, cfg.getLastRow() - 1, 1)
      .getValues()
      .forEach(function (r) {
        have[r[0]] = true;
      });
  var rows = [];
  Object.keys(Logic.DEFAULTS).forEach(function (k) {
    if (!have[k]) rows.push([k, Logic.DEFAULTS[k], CONFIG_NOTES[k] || '']);
  });
  if (rows.length) cfg.getRange(cfg.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  // Text formats so Sheets doesn't reinterpret dates/times
  cfg.getRange('B:B').setNumberFormat('@');
  ss.getSheetByName('Weeks').getRange('C:F').setNumberFormat('@');
  ss.getSheetByName('Overrides').getRange('C:C').setNumberFormat('@');
  ['Memberships', 'Checkins'].forEach(function (n) {
    var sh = ss.getSheetByName(n),
      hdr = SCHEMA[n];
    ['active', 'agon', 'badge_done', 'meetup', 'personal_goal', 'bonus', 'late'].forEach(function (col) {
      var i = hdr.indexOf(col);
      if (i > -1) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).insertCheckboxes();
    });
  });
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  var tz = Logic.str(readConfig_().timezone);
  if (tz) ss.setSpreadsheetTimeZone(tz);
  clearStandingsCache();
}

/** Pre-fill the Weeks tab from season_start (only if it's empty). */
function fillWeeks() {
  var cfg = readConfig_();
  var sh = sheet_('Weeks');
  if (sh.getLastRow() > 1) {
    toast_('Weeks tab already has rows — clear them first to regenerate.');
    return;
  }
  if (!Logic.str(cfg.season_start)) {
    toast_('Set season_start in Config first.');
    return;
  }
  var n = Logic.num(cfg.week_count, 6),
    start = Logic.str(cfg.season_start).slice(0, 10);
  var names = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  var rows = [];
  for (var i = 0; i < n; i++) {
    var s = Logic.addDays(start, 7 * i),
      e = Logic.addDays(start, 7 * i + 6);
    rows.push([i + 1, (i === n - 1 ? 'Final' : names[i] || 'Week ' + (i + 1)) + ' Week', s, e, '', '']);
  }
  sh.getRange(2, 1, rows.length, 6).setValues(rows);
  toast_('Weeks filled. Leave checkin_opens / checkin_deadline blank to use the defaults, or type exact times.');
}

// ---------------------------------------------------------------- API (called from the client)

function getBootstrap() {
  var season = getSeason_(),
    now = Date.now();
  var participants = readTable_('Participants')
    .map(function (p) {
      return { id: p.id, name: p.name, username: p.tsl_username };
    })
    .filter(function (p) {
      return p.id;
    });
  var memberships = activeMemberships_();
  var counts = {};
  memberships.forEach(function (m) {
    var k = Logic.key(m.team);
    counts[k] = (counts[k] || 0) + 1;
  });
  var teams = readTable_('Teams')
    .filter(function (t) {
      return t.name;
    })
    .map(function (t) {
      return { name: t.name, leader: t.leader_name || '', members: counts[Logic.key(t.name)] || 0 };
    })
    .sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  return {
    now: now,
    season: publicSeason_(season, now),
    registration: regInfo_(season, now),
    participants: participants.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    }),
    teams: teams
  };
}

function signup(payload) {
  return withLock_(function () {
    var season = getSeason_(),
      now = Date.now();
    var name = Logic.normName(payload && payload.name);
    var username = Logic.normUsername(payload && payload.username);
    if (name.length < 2) throw new Error('Please enter your name.');
    if (!username) throw new Error('Please enter your TSL username.');
    var pin = cleanPin_(payload && payload.pin);
    var ov = overridesFor_(username);
    var st = Logic.registrationStatus(season, now, ov.registration);
    if (st.state === 'upcoming') throw new Error('Registration opens ' + fmt_(season, st.opens) + '.');
    if (st.state === 'closed') throw new Error('Registration closed ' + fmt_(season, st.closes) + '.');

    var people = readTable_('Participants');
    people.forEach(function (p) {
      if (Logic.normUsername(p.tsl_username) === username) {
        throw new Error(
          '@' + username + ' is already enlisted as ' + p.name + '. Log in with your TSL username and PIN instead.'
        );
      }
    });
    var teamNames = cleanTeamList_(payload.teams, payload.newTeam);
    if (!season.allowMultipleTeams && teamNames.length > 1) throw new Error('This season you can join only one team.');

    var id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    var pinHash = hashPin_(pin);
    appendRow_('Participants', {
      id: id,
      name: name,
      tsl_username: username,
      created_at: new Date(),
      pin_hash: pinHash
    });
    var joined = addMemberships_({ id: id, name: name }, teamNames, []);
    clearStandingsCache();
    var session = session_({ id: id, name: name, tsl_username: username, pin_hash: pinHash });
    return { participant: session.participant, token: session.token, joined: joined, bootstrap: getBootstrap() };
  });
}

function joinTeams(payload) {
  return withLock_(function () {
    var season = getSeason_(),
      now = Date.now();
    var p = participantFromToken_(payload && payload.token);
    var ov = overridesFor_(p.tsl_username);
    var st = Logic.teamJoinStatus(season, now, ov.registration);
    if (st.state === 'upcoming') throw new Error('Team sign-up isn’t open yet.');
    if (st.state === 'closed') throw new Error('Team changes closed ' + fmt_(season, st.closes) + '.');
    var teamNames = cleanTeamList_(payload.teams, payload.newTeam);
    if (!teamNames.length) throw new Error('Pick at least one team.');
    var mine = readTable_('Memberships').filter(function (m) {
      return m.participant_id === p.id;
    });
    var activeMine = mine.filter(function (m) {
      return m.active === '' || Logic.truthy(m.active);
    });
    if (!season.allowMultipleTeams && activeMine.length + teamNames.length > 1) {
      throw new Error(
        'This season you can be on only one team' +
          (activeMine.length ? ' (you’re on ' + activeMine[0].team + ')' : '') +
          '.'
      );
    }
    var joined = addMemberships_({ id: p.id, name: p.name }, teamNames, mine);
    clearStandingsCache();
    return { joined: joined, record: recordFor_(p.id), bootstrap: getBootstrap() };
  });
}

/**
 * Leave a team (same window as joining). The membership row is deleted, so rejoining later works;
 * unticking "active" is reserved for organizer removals. A departing leader hands off to the
 * remaining member who joined earliest.
 */
function leaveTeam(payload) {
  return withLock_(function () {
    var season = getSeason_(),
      now = Date.now();
    var p = participantFromToken_(payload && payload.token);
    var st = Logic.teamJoinStatus(season, now, overridesFor_(p.tsl_username).registration);
    if (st.state === 'closed')
      throw new Error('Team changes closed ' + fmt_(season, st.closes) + '. Contact the organizers.');
    var k = Logic.key(payload && payload.team);
    var mem = table_('Memberships');
    var row = mem.rows.filter(function (m) {
      return m.participant_id === p.id && Logic.key(m.team) === k;
    })[0];
    if (!row) throw new Error('You\u2019re not on that team.');
    if (!(row.active === '' || Logic.truthy(row.active)))
      throw new Error('The organizers removed you from ' + row.team + ' \u2014 contact them about changes.');
    mem.sheet.deleteRow(row._row);

    var teams = table_('Teams');
    var team = teams.rows.filter(function (t) {
      return Logic.key(t.name) === k;
    })[0];
    var newLeader = '';
    if (team && team.leader_id === p.id) {
      var rest = readTable_('Memberships')
        .filter(function (m) {
          return Logic.key(m.team) === k && m.participant_id !== p.id && (m.active === '' || Logic.truthy(m.active));
        })
        .sort(function (a, b) {
          return String(a.joined_at).localeCompare(String(b.joined_at)) || a._row - b._row;
        });
      var next = rest[0] ? participantById_(rest[0].participant_id) : null;
      writeRow_(teams, team._row, { leader_id: next ? next.id : '', leader_name: next ? next.name : '' });
      newLeader = next ? next.name : '';
    }
    clearStandingsCache();
    return { left: row.team, newLeader: newLeader, record: recordFor_(p.id), bootstrap: getBootstrap() };
  });
}

/** Lets a participant fix the spelling of their display name. Usernames stay fixed (they are the identity). */
function renameParticipant(payload) {
  return withLock_(function () {
    var p = participantFromToken_(payload && payload.token);
    var name = Logic.normName(payload && payload.name);
    if (name.length < 2) throw new Error('Please enter your name.');
    if (name.length > 80) throw new Error('That name is too long.');
    if (name === p.name) return { record: recordFor_(p.id), bootstrap: getBootstrap() };
    var t = table_('Participants');
    writeRow_(t, p._row, { name: name });
    // keep the readable copies of the name in the other tabs in sync
    [
      ['Memberships', 'participant_id', 'name'],
      ['Checkins', 'participant_id', 'name'],
      ['Teams', 'leader_id', 'leader_name']
    ].forEach(function (spec) {
      var tb = table_(spec[0]);
      tb.rows.forEach(function (r) {
        if (r[spec[1]] === p.id) {
          var o = {};
          o[spec[2]] = name;
          writeRow_(tb, r._row, o);
        }
      });
    });
    clearStandingsCache();
    return { record: recordFor_(p.id), bootstrap: getBootstrap() };
  });
}

/** The logged-in person's own record. Takes the login token, never a participant id. */
function getMyRecord(token) {
  return recordFor_(participantFromToken_(token).id);
}

function recordFor_(participantId) {
  var season = getSeason_(),
    now = Date.now();
  var p = participantById_(participantId);
  var ov = overridesFor_(p.tsl_username);
  var all = readTable_('Checkins');
  var mine = all.filter(function (c) {
    return c.participant_id === p.id;
  });
  var byWeek = {};
  mine.forEach(function (c) {
    byWeek[Number(c.week)] = c;
  });
  var revealed = Logic.bonusRevealed(season, now);
  var weeks = season.weeks.map(function (w) {
    var st = Logic.weekStatus(season, w.week, now, ov[w.week]);
    var c = byWeek[w.week];
    return {
      week: w.week,
      state: st.state,
      deadline: st.deadline,
      deadlineLabel: fmt_(season, st.deadline),
      extended: st.extended,
      opensLabel: fmt_(season, st.opens),
      submitted: !!c,
      checkin: c ? publicCheckin_(c, revealed) : null
    };
  });
  var scores = Logic.scoreParticipants(season, [{ id: p.id, name: p.name, username: p.tsl_username }], mine);
  var teams = readTable_('Teams');
  var leaderOf = {};
  teams.forEach(function (t) {
    if (t.leader_id === p.id) leaderOf[Logic.key(t.name)] = true;
  });
  var myTeams = readTable_('Memberships')
    .filter(function (m) {
      return m.participant_id === p.id;
    })
    .map(function (m) {
      return { team: m.team, active: m.active === '' || Logic.truthy(m.active), leader: !!leaderOf[Logic.key(m.team)] };
    });
  var pastReqs = mine
    .filter(function (c) {
      return Logic.truthy(c.badge_done) && c.badge_requirement;
    })
    .map(function (c) {
      return { week: Number(c.week), text: c.badge_requirement };
    });
  return {
    participant: { id: p.id, name: p.name, username: p.tsl_username },
    score: scores[p.id],
    weeks: weeks,
    teams: myTeams,
    pastBadgeRequirements: pastReqs,
    teamJoin: (function () {
      var s = Logic.teamJoinStatus(season, now, ov.registration);
      return { state: s.state, closesLabel: fmt_(season, s.closes) };
    })()
  };
}

function submitCheckin(payload) {
  return withLock_(function () {
    var season = getSeason_(),
      now = Date.now();
    var p = participantFromToken_(payload && payload.token);
    var ov = overridesFor_(p.tsl_username);
    var week = Number(payload.week);
    var gate = Logic.canSubmit(season, week, now, ov[week]);
    if (!gate.ok) throw new Error(gate.reason);
    var clean = Logic.validateCheckin(payload, season, Logic.bonusRevealed(season, now));

    var t = table_('Checkins');
    var rowNum = -1,
      first = new Date();
    t.rows.forEach(function (r) {
      if (r.participant_id === p.id && Number(r.week) === week) {
        rowNum = r._row;
        first = r.first_submitted_at || first;
      }
    });
    var obj = {
      participant_id: p.id,
      name: p.name,
      week: week,
      pa_days: clean.pa_days,
      deed_days: clean.deed_days,
      agon: clean.agon,
      badge_done: clean.badge_done,
      badge_requirement: clean.badge_requirement,
      badge_requirement_id: clean.badge_requirement_id,
      agft: clean.agft,
      meetup: clean.meetup,
      personal_goal: clean.personal_goal,
      bonus: clean.bonus,
      late: gate.late,
      submitted_at: new Date(),
      first_submitted_at: first
    };
    if (rowNum > 0) writeRow_(t, rowNum, obj);
    else appendRow_('Checkins', obj);
    clearStandingsCache();
    return { late: gate.late, record: recordFor_(p.id) };
  });
}

function getStandings() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var season = getSeason_();
  var participants = readTable_('Participants')
    .filter(function (p) {
      return p.id;
    })
    .map(function (p) {
      return { id: p.id, name: p.name, username: p.tsl_username };
    });
  var teams = readTable_('Teams')
    .filter(function (t) {
      return t.name;
    })
    .map(function (t) {
      return { name: t.name, leader_id: t.leader_id };
    });
  var lb = Logic.leaderboards(season, participants, teams, readTable_('Memberships'), readTable_('Checkins'));
  lb.generatedAt = Date.now();
  lb.generatedLabel = fmt_(season, lb.generatedAt);
  var json = JSON.stringify(lb);
  try {
    cache.put(CACHE_KEY, json, 60);
  } catch (e) {
    /* too large to cache; fine */
  }
  return lb;
}

function clearStandingsCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// ---------------------------------------------------------------- login (TSL username + 4-digit PIN)
//
// The server never trusts a participant id sent by the page. After a correct PIN it hands out a signed
// session token, and every per-person call takes that token and looks the person up from it.
// To reset someone's PIN, an organizer clears their pin_hash cell in the Participants tab. The next time
// they log in they choose a new one, and their old sessions stop working.

var PIN_MAX_TRIES = 5; // wrong PINs in a row before the username is locked
var LOCK_FIRST_MIN = 15; // first lock; each further wrong PIN doubles it
var LOCK_MAX_MIN = 24 * 60;
var SESSION_DAYS = 120;
var PIN_ROUNDS = 100;

/** Step 1 of logging in: does this username exist, and has it chosen a PIN yet? */
function loginStatus(username) {
  var p = participantByUsername_(readTable_('Participants'), username);
  var wait = lockedUntil_(p) - Date.now();
  return {
    username: Logic.normUsername(p.tsl_username),
    name: p.name,
    hasPin: !!Logic.str(p.pin_hash),
    locked: wait > 0 ? lockedMsg_(wait) : ''
  };
}

/** Step 2: check the PIN. Wrong PINs count toward a lock on that username. */
function login(payload) {
  return withLock_(function () {
    var t = table_('Participants');
    var p = participantByUsername_(t.rows, payload && payload.username);
    if (!Logic.str(p.pin_hash)) return { needsPin: true };
    var now = Date.now();
    var until = lockedUntil_(p);
    if (until > now) throw new Error(lockedMsg_(until - now));
    var pin = cleanPin_(payload && payload.pin);
    if (!pinMatches_(pin, p.pin_hash)) {
      var fails = Logic.num(p.pin_failures, 0) + 1;
      var update = { pin_failures: fails };
      var msg;
      if (fails >= PIN_MAX_TRIES) {
        var mins = Math.min(LOCK_MAX_MIN, LOCK_FIRST_MIN * Math.pow(2, fails - PIN_MAX_TRIES));
        update.locked_until = new Date(now + mins * 60000);
        msg = 'Wrong PIN. Too many tries: ' + lockedMsg_(mins * 60000);
      } else {
        var left = PIN_MAX_TRIES - fails;
        msg =
          'Wrong PIN. ' +
          left +
          (left === 1 ? ' more try' : ' more tries') +
          ' before this username is locked for ' +
          LOCK_FIRST_MIN +
          ' minutes.';
      }
      writeRow_(t, p._row, update);
      throw new Error(msg);
    }
    if (Logic.str(p.pin_failures) || Logic.str(p.locked_until))
      writeRow_(t, p._row, { pin_failures: '', locked_until: '' });
    return session_(p);
  });
}

/** For someone without a PIN yet: enlisted before PINs existed, or an organizer cleared it. */
function setPin(payload) {
  return withLock_(function () {
    var t = table_('Participants');
    var p = participantByUsername_(t.rows, payload && payload.username);
    if (Logic.str(p.pin_hash)) throw new Error('@' + p.tsl_username + ' already has a PIN. Log in with it instead.');
    var pin = cleanPin_(payload && payload.pin);
    p.pin_hash = hashPin_(pin);
    writeRow_(t, p._row, { pin_hash: p.pin_hash, pin_failures: '', locked_until: '' });
    return session_(p);
  });
}

function participantByUsername_(rows, username) {
  var u = Logic.normUsername(username);
  if (!u) throw new Error('Please enter your TSL username.');
  var p = rows.filter(function (r) {
    return r.id && Logic.normUsername(r.tsl_username) === u;
  })[0];
  if (!p) throw new Error('No one is enlisted as @' + u + '. Check the spelling, or enlist first.');
  return p;
}

function participantFromToken_(token) {
  var again = 'Please log in again.';
  var parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error(again);
  var exp = Number(parts[1]);
  if (!(exp > Date.now())) throw new Error('Your login has expired. ' + again);
  var p = readTable_('Participants').filter(function (r) {
    return r.id && r.id === parts[0];
  })[0];
  if (!p || !Logic.str(p.pin_hash)) throw new Error(again);
  if (!sameText_(sign_(p.id + '.' + exp + '.' + p.pin_hash), parts[2])) throw new Error(again);
  return p;
}

function session_(p) {
  var exp = Date.now() + SESSION_DAYS * 86400000;
  return {
    token: p.id + '.' + exp + '.' + sign_(p.id + '.' + exp + '.' + p.pin_hash),
    participant: { id: p.id, name: p.name, username: Logic.normUsername(p.tsl_username) }
  };
}

function cleanPin_(pin) {
  var s = Logic.str(pin);
  if (!/^\d{4}$/.test(s)) throw new Error('Your PIN must be exactly 4 digits.');
  return s;
}

/** Stored as v1$salt$hash, so the PIN itself is never written to the sheet. */
function hashPin_(pin, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '');
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  for (var i = 1; i < PIN_ROUNDS; i++) b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b);
  return 'v1$' + salt + '$' + hex_(b);
}

function pinMatches_(pin, stored) {
  var parts = String(stored).split('$');
  return parts.length === 3 && sameText_(hashPin_(pin, parts[1]), String(stored));
}

function lockedUntil_(p) {
  var v = Logic.str(p.locked_until);
  if (!v) return 0;
  try {
    return Utilities.parseDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), LOCAL_FMT).getTime();
  } catch (e) {
    return 0;
  }
}

function lockedMsg_(ms) {
  var m = Math.max(1, Math.ceil(ms / 60000));
  var h = Math.ceil(m / 60);
  var wait = m < 60 ? m + (m === 1 ? ' minute' : ' minutes') : h + (h === 1 ? ' hour' : ' hours');
  return 'this username is locked. Try again in ' + wait + ', or ask for help on the forums.';
}

/** Signs session tokens with a random key kept in Script Properties (created on first use). */
function sign_(text) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('session_key');
  if (!key) {
    key = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('session_key', key);
  }
  return hex_(Utilities.computeHmacSha256Signature(text, key));
}

function hex_(bytes) {
  return bytes
    .map(function (b) {
      return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
    })
    .join('');
}

function sameText_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- import (optional)

function importRosterPrompt() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActive().getSheetByName('Import');
  if (!sh || sh.getLastRow() < 2) {
    if (!sh) SpreadsheetApp.getActive().insertSheet('Import');
    ui.alert(
      'Import roster',
      'Paste last season\'s enrollment responses (including the header row) into the "Import" tab, ' +
        'then run this again.\nExpected columns: "Your Name", "Your TSL Username", "Team(s) you want to join".',
      ui.ButtonSet.OK
    );
    return;
  }
  var n = importRoster();
  ui.alert(
    'Imported ' +
      n.people +
      ' people, ' +
      n.teams +
      ' teams, ' +
      n.memberships +
      ' memberships. You can delete the Import tab now.'
  );
}

/**
 * Copies people + teams from rows pasted into the "Import" tab (a legacy Google Forms enrollment export).
 * Idempotent by username. Reads only this spreadsheet, so the script never needs access to your other files.
 */
function importRoster() {
  var src = sheet_('Import').getDataRange().getValues();
  var hdr = src.shift().map(function (h) {
    return String(h).toLowerCase();
  });
  function col(re) {
    for (var i = 0; i < hdr.length; i++) if (re.test(hdr[i])) return i;
    return -1;
  }
  var cName = col(/name/),
    cUser = col(/username/),
    cTeams = col(/team/);
  return withLock_(function () {
    var people = readTable_('Participants');
    var byUser = {},
      byName = {};
    people.forEach(function (p) {
      byUser[Logic.normUsername(p.tsl_username)] = p;
      byName[Logic.key(p.name)] = p;
    });
    var counts = { people: 0, teams: 0, memberships: 0 };
    var memberships = readTable_('Memberships');
    src.forEach(function (row) {
      var name = Logic.normName(row[cName]),
        user = Logic.normUsername(row[cUser]) || Logic.key(name).replace(/\s/g, '');
      if (!name) return;
      var p = byUser[user] || byName[Logic.key(name)];
      if (!p) {
        p = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 10), name: name, tsl_username: user };
        appendRow_('Participants', { id: p.id, name: name, tsl_username: user, created_at: new Date() });
        byUser[user] = p;
        byName[Logic.key(name)] = p;
        counts.people++;
      }
      var teams =
        cTeams > -1
          ? String(row[cTeams] || '')
              .split(/\s*,\s*/)
              .filter(String)
          : [];
      var before = readTable_('Teams').length;
      var added = addMemberships_(
        { id: p.id, name: p.name },
        teams,
        memberships.filter(function (m) {
          return m.participant_id === p.id;
        })
      );
      counts.teams += readTable_('Teams').length - before;
      counts.memberships += added.length;
      added.forEach(function (t) {
        memberships.push({ participant_id: p.id, team: t, active: true });
      });
    });
    clearStandingsCache();
    return counts;
  });
}

// ---------------------------------------------------------------- internals

function getSeason_() {
  var weeks = readTable_('Weeks');
  return Logic.buildSeason(readConfig_(), weeks, function (local, tz) {
    return Utilities.parseDate(local, tz, LOCAL_FMT).getTime();
  });
}

function readConfig_() {
  var out = {};
  readTable_('Config').forEach(function (r) {
    if (r.key) out[String(r.key).trim()] = r.value;
  });
  return out;
}

function publicSeason_(season, now) {
  var revealed = Logic.bonusRevealed(season, now);
  return {
    name: season.name,
    timezone: season.timezone,
    points: season.points,
    agftMax: season.agftMax,
    minOfficialTeamSize: season.minOfficialTeamSize,
    allowMultipleTeams: season.allowMultipleTeams,
    allowLate: season.allowLate,
    lateCounts: season.lateCounts,
    perfectScore: Logic.perfectScore(season),
    bonus: revealed
      ? { revealed: true, name: season.bonus.name, description: season.bonus.description }
      : { revealed: false, name: 'Bonus Challenge', revealLabel: fmt_(season, season.bonus.revealAt) },
    links: season.links,
    organizerContact: season.organizerContact,
    tagline: season.tagline,
    hero: season.hero,
    weeks: season.weeks.map(function (w) {
      return {
        week: w.week,
        label: w.label,
        range: fmtDay_(season, w.startDate) + ' – ' + fmtDay_(season, w.endDate),
        opens: w.opens,
        deadline: w.deadline,
        opensLabel: fmt_(season, w.opens),
        deadlineLabel: fmt_(season, w.deadline)
      };
    }),
    startLabel: season.weeks.length ? fmtDay_(season, season.weeks[0].startDate) : '',
    endLabel: season.weeks.length ? fmtDay_(season, season.weeks[season.weeks.length - 1].endDate) : ''
  };
}

function regInfo_(season, now) {
  var st = Logic.registrationStatus(season, now, null);
  var tj = Logic.teamJoinStatus(season, now, null);
  return {
    state: st.state,
    opens: st.opens,
    closes: st.closes,
    opensLabel: fmt_(season, st.opens),
    closesLabel: fmt_(season, st.closes),
    teamJoinState: tj.state,
    teamJoinCloses: tj.closes,
    teamJoinClosesLabel: fmt_(season, tj.closes)
  };
}

function publicCheckin_(c, revealed) {
  return {
    week: Number(c.week),
    pa_days: Logic.num(c.pa_days, 0),
    deed_days: Logic.num(c.deed_days, 0),
    agon: Logic.truthy(c.agon),
    badge_done: Logic.truthy(c.badge_done),
    badge_requirement: Logic.str(c.badge_requirement),
    badge_requirement_id: Logic.str(c.badge_requirement_id),
    agft: c.agft === '' ? '' : Logic.num(c.agft, ''),
    meetup: Logic.truthy(c.meetup),
    personal_goal: Logic.truthy(c.personal_goal),
    bonus: revealed && Logic.truthy(c.bonus),
    late: Logic.truthy(c.late),
    submittedLabel: Logic.str(c.submitted_at)
  };
}

/** Per-person deadline extensions: { registration: epoch, 1: epoch, 2: epoch, ... } */
function overridesFor_(username) {
  var u = Logic.normUsername(username),
    out = {},
    tz = getSeason_().timezone;
  if (!u) return out;
  readTable_('Overrides').forEach(function (o) {
    if (Logic.normUsername(o.tsl_username) !== u || !Logic.str(o.new_deadline)) return;
    var when = Utilities.parseDate(Logic.normLocal(o.new_deadline), tz, LOCAL_FMT).getTime();
    var wk = /^reg/i.test(String(o.week)) ? 'registration' : Number(o.week);
    out[wk] = Math.max(out[wk] || 0, when);
  });
  return out;
}

function cleanTeamList_(teams, newTeam) {
  var list = (teams || []).map(Logic.normName).filter(String);
  var nt = Logic.normName(newTeam);
  if (nt) {
    if (nt.length > 60) throw new Error('Team name is too long.');
    list.push(nt);
  }
  var seen = {},
    out = [];
  list.forEach(function (t) {
    if (!seen[Logic.key(t)]) {
      seen[Logic.key(t)] = true;
      out.push(t);
    }
  });
  return out;
}

/** Adds memberships, creating teams (with this person as leader) when new. Returns team names joined. */
function addMemberships_(person, teamNames, existing) {
  var teams = readTable_('Teams'),
    byKey = {};
  teams.forEach(function (t) {
    byKey[Logic.key(t.name)] = t;
  });
  var have = {};
  (existing || []).forEach(function (m) {
    have[Logic.key(m.team)] = m;
  });
  var joined = [];
  teamNames.forEach(function (name) {
    var k = Logic.key(name);
    var team = byKey[k];
    if (!team) {
      team = { name: name, leader_id: person.id, leader_name: person.name, created_at: new Date() };
      appendRow_('Teams', team);
      byKey[k] = team;
    }
    if (have[k]) {
      if (!(have[k].active === '' || Logic.truthy(have[k].active))) {
        throw new Error('You were removed from ' + team.name + ' — contact the organizer to rejoin.');
      }
      return;
    }
    appendRow_('Memberships', {
      participant_id: person.id,
      name: person.name,
      team: team.name,
      joined_at: new Date(),
      active: true
    });
    have[k] = { active: true };
    joined.push(team.name);
  });
  return joined;
}

function activeMemberships_() {
  return readTable_('Memberships').filter(function (m) {
    return m.participant_id && (m.active === '' || Logic.truthy(m.active));
  });
}

function participantById_(id) {
  var p = readTable_('Participants').filter(function (r) {
    return r.id && r.id === id;
  })[0];
  if (!p) throw new Error('We couldn’t find that participant.');
  return p;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The server is busy — please try again in a moment.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '" — run StrenGames → Set up / repair tabs.');
  return sh;
}

function table_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var headers = (values.shift() || []).map(function (h) {
    return String(h).trim();
  });
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var rows = values.map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) {
      var v = r[j];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, LOCAL_FMT);
      else if (typeof v === 'string') v = v.trim();
      if (h) o[h] = v;
    });
    return o;
  });
  return { sheet: sh, headers: headers, rows: rows };
}

function readTable_(name) {
  return table_(name).rows;
}

function appendRow_(name, obj) {
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(
    headers.map(function (h) {
      return obj[h] === undefined ? '' : obj[h];
    })
  );
}

function writeRow_(t, rowNum, obj) {
  var current = t.sheet.getRange(rowNum, 1, 1, t.headers.length).getValues()[0];
  var row = t.headers.map(function (h, i) {
    return obj[h] === undefined ? current[i] : obj[h];
  });
  t.sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
}

function fmt_(season, epoch) {
  if (epoch === null || epoch === undefined || epoch === '') return '';
  return Utilities.formatDate(new Date(epoch), season.timezone, 'EEE d MMM, h:mm a z');
}
function fmtDay_(season, ymd) {
  if (!ymd) return '';
  return Utilities.formatDate(
    Utilities.parseDate(ymd + ' 12:00:00', season.timezone, LOCAL_FMT),
    season.timezone,
    'd MMM'
  );
}
function toast_(msg) {
  SpreadsheetApp.getActive().toast(msg, 'StrenGames', 8);
}
