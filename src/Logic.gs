/**
 * StrenGames Hub — pure logic (no Apps Script services).
 * Scoring, deadline windows and validation live here so they can be unit-tested in Node.
 * In Apps Script every .gs file shares one global scope, so Code.gs just calls Logic.*.
 */
var Logic = (function () {
  var DAY_MS = 24 * 60 * 60 * 1000;

  var DEFAULTS = {
    season_name: 'StrenGames',
    timezone: 'America/New_York',
    season_start: '', // yyyy-MM-dd (a Saturday)
    week_count: 6,
    registration_opens: '', // yyyy-MM-dd HH:mm:ss, season timezone
    registration_closes: '',
    team_join_closes: '', // blank = same as registration_closes
    default_opens_offset_days: 6, // check-in opens N days after week start (6 = last day of a Sat–Fri week)
    default_deadline_grace_days: 6, // due N days after week end (Fri + 6 = Thu)
    default_deadline_time: '23:59:59',
    allow_late_submissions: false,
    late_submissions_count: false,
    allow_multiple_teams: true,
    min_official_team_size: 4,
    points_physical_per_day: 10,
    points_deed_per_day: 10,
    points_agon_per_week: 80,
    points_badge_per_week: 80,
    agft_max: 500,
    points_meetup: 200,
    points_personal_goal: 250,
    points_bonus: 250,
    bonus_challenge_name: 'Bonus Challenge',
    bonus_challenge_description: '',
    bonus_reveal_at: '',
    link_agft_chart: '',
    link_personal_goals_thread: '',
    link_faq: '',
    link_community_badges: '',
    link_group: '',
    organizer_contact: '',
    tagline: 'Do hard things.',
    hero_image_url: '',
    hero_image_alt: ''
  };

  // ---------- small helpers ----------
  function truthy(v) {
    if (v === true) return true;
    if (v === false || v === null || v === undefined) return false;
    return /^(true|yes|y|1|x)$/i.test(String(v).trim());
  }
  function num(v, dflt) {
    if (v === '' || v === null || v === undefined) return dflt;
    var n = Number(v);
    return isNaN(n) ? dflt : n;
  }
  function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }
  function normName(s) {
    return str(s).replace(/\s+/g, ' ');
  }
  function key(s) {
    return normName(s).toLowerCase();
  }
  function normUsername(s) {
    return str(s).replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
  }

  /** Add days to a yyyy-MM-dd string (calendar arithmetic, DST-proof). */
  function addDays(ymd, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) throw new Error('Bad date "' + ymd + '" (expected yyyy-MM-dd)');
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    return d.toISOString().slice(0, 10);
  }
  function ymdOf(localStr) {
    return str(localStr).slice(0, 10);
  }
  function withTime(ymd, t) {
    return ymd + ' ' + (t || '00:00:00');
  }
  function normLocal(s) {
    s = str(s);
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + ' 00:00:00';
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) return s.replace('T', ' ') + ':00';
    return s.replace('T', ' ');
  }

  /**
   * Build the season object.
   * rawConfig: {key: value} (strings/numbers/booleans; dates already as 'yyyy-MM-dd HH:mm:ss' local strings)
   * rawWeeks: [{week, label, start_date, end_date, checkin_opens, checkin_deadline}]
   * parseLocal(localString, tz) -> epoch ms
   */
  function buildSeason(rawConfig, rawWeeks, parseLocal) {
    var c = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = rawConfig && rawConfig[k];
      c[k] = v === undefined || v === null || v === '' ? DEFAULTS[k] : v;
    });
    var tz = str(c.timezone) || DEFAULTS.timezone;
    function at(local) {
      local = normLocal(local);
      return local ? parseLocal(local, tz) : null;
    }

    var weeks = [];
    var rows = (rawWeeks || []).filter(function (w) {
      return str(w.start_date) || str(w.end_date);
    });
    if (!rows.length && str(c.season_start)) {
      for (var i = 0; i < num(c.week_count, 6); i++) {
        rows.push({
          week: i + 1,
          start_date: addDays(ymdOf(c.season_start), 7 * i),
          end_date: addDays(ymdOf(c.season_start), 7 * i + 6)
        });
      }
    }
    rows.forEach(function (w, idx) {
      var start = ymdOf(w.start_date);
      var end = ymdOf(w.end_date) || addDays(start, 6);
      var opensLocal =
        normLocal(w.checkin_opens) || withTime(addDays(start, num(c.default_opens_offset_days, 6)), '00:00:00');
      var deadlineLocal =
        normLocal(w.checkin_deadline) ||
        withTime(addDays(end, num(c.default_deadline_grace_days, 6)), str(c.default_deadline_time) || '23:59:59');
      weeks.push({
        week: num(w.week, idx + 1),
        label: str(w.label) || 'Week ' + num(w.week, idx + 1),
        startDate: start,
        endDate: end,
        opensLocal: opensLocal,
        deadlineLocal: deadlineLocal,
        opens: at(opensLocal),
        deadline: at(deadlineLocal)
      });
    });

    var regCloses = at(c.registration_closes);
    return {
      name: str(c.season_name),
      timezone: tz,
      points: {
        physical: num(c.points_physical_per_day, 10),
        deed: num(c.points_deed_per_day, 10),
        agon: num(c.points_agon_per_week, 80),
        badge: num(c.points_badge_per_week, 80),
        meetup: num(c.points_meetup, 200),
        personalGoal: num(c.points_personal_goal, 250),
        bonus: num(c.points_bonus, 250)
      },
      agftMax: num(c.agft_max, 500),
      minOfficialTeamSize: num(c.min_official_team_size, 4),
      allowMultipleTeams: truthy(c.allow_multiple_teams),
      allowLate: truthy(c.allow_late_submissions),
      lateCounts: truthy(c.late_submissions_count),
      registration: {
        opens: at(c.registration_opens),
        closes: regCloses,
        opensLocal: normLocal(c.registration_opens),
        closesLocal: normLocal(c.registration_closes),
        teamJoinCloses: at(c.team_join_closes) || regCloses,
        teamJoinClosesLocal: normLocal(c.team_join_closes) || normLocal(c.registration_closes)
      },
      bonus: {
        name: str(c.bonus_challenge_name),
        description: str(c.bonus_challenge_description),
        revealAt: at(c.bonus_reveal_at)
      },
      links: {
        agftChart: str(c.link_agft_chart),
        personalGoalsThread: str(c.link_personal_goals_thread),
        faq: str(c.link_faq),
        communityBadges: str(c.link_community_badges),
        group: str(c.link_group)
      },
      organizerContact: str(c.organizer_contact),
      tagline: str(c.tagline),
      hero: { url: str(c.hero_image_url), alt: str(c.hero_image_alt) },
      weeks: weeks
    };
  }

  function perfectScore(season) {
    var p = season.points,
      n = season.weeks.length;
    return n * (7 * p.physical + 7 * p.deed + p.agon + p.badge) + season.agftMax + p.meetup + p.personalGoal + p.bonus;
  }

  // ---------- windows ----------
  function windowState(opens, closes, now) {
    if (opens !== null && opens !== undefined && now < opens) return 'upcoming';
    if (closes !== null && closes !== undefined && now > closes) return 'closed';
    return 'open';
  }

  /** override: epoch ms or null — a personal extension of the closing time. */
  function registrationStatus(season, now, override) {
    var closes = maxOf(season.registration.closes, override);
    return {
      state: windowState(season.registration.opens, closes, now),
      opens: season.registration.opens,
      closes: closes
    };
  }
  function teamJoinStatus(season, now, override) {
    var closes = maxOf(season.registration.teamJoinCloses, override);
    return { state: windowState(season.registration.opens, closes, now), closes: closes };
  }
  function findWeek(season, week) {
    for (var i = 0; i < season.weeks.length; i++) if (season.weeks[i].week === Number(week)) return season.weeks[i];
    return null;
  }
  function weekStatus(season, week, now, override) {
    var w = findWeek(season, week);
    if (!w) throw new Error('Unknown week ' + week);
    var deadline = maxOf(w.deadline, override);
    var state = windowState(w.opens, deadline, now);
    if (state === 'closed' && season.allowLate) state = 'late';
    return { week: w.week, state: state, opens: w.opens, deadline: deadline, extended: deadline !== w.deadline };
  }
  /** Can a check-in for this week be written right now? */
  function canSubmit(season, week, now, override) {
    var s = weekStatus(season, week, now, override);
    if (s.state === 'upcoming') return { ok: false, late: false, reason: 'This week’s report isn’t open yet.' };
    if (s.state === 'closed') return { ok: false, late: false, reason: 'The deadline for this week has passed.' };
    return { ok: true, late: s.state === 'late' };
  }
  function bonusRevealed(season, now) {
    return !season.bonus.revealAt || now >= season.bonus.revealAt;
  }
  function maxOf(a, b) {
    if (b === null || b === undefined || b === '') return a;
    if (a === null || a === undefined) return b;
    return Math.max(a, b);
  }

  // ---------- validation ----------
  function validateCheckin(input, season, revealed) {
    var errs = [];
    function days(v, label) {
      var n = Number(v);
      if (v === '' || v === null || v === undefined) n = 0;
      if (!(n >= 0 && n <= 7) || Math.floor(n) !== n) errs.push(label + ' must be a whole number from 0 to 7.');
      return n;
    }
    var out = {
      week: Number(input.week),
      pa_days: days(input.pa_days, 'Physical activity days'),
      deed_days: days(input.deed_days, 'Good deed days'),
      agon: truthy(input.agon),
      badge_done: truthy(input.badge_done),
      badge_requirement: '',
      badge_requirement_id: '',
      agft: '',
      meetup: truthy(input.meetup),
      personal_goal: truthy(input.personal_goal),
      bonus: revealed ? truthy(input.bonus) : false
    };
    if (!findWeek(season, out.week)) errs.push('Pick a valid week.');
    if (out.badge_done) {
      out.badge_requirement = str(input.badge_requirement).slice(0, 300);
      out.badge_requirement_id = str(input.badge_requirement_id).slice(0, 40);
      if (!out.badge_requirement) errs.push('Tell us which badge requirement you completed.');
    }
    if (str(input.agft) !== '') {
      var a = Number(input.agft);
      if (isNaN(a) || a < 0 || a > season.agftMax)
        errs.push('AGFT score must be between 0 and ' + season.agftMax + '.');
      else out.agft = a;
    }
    if (errs.length) throw new Error(errs.join(' '));
    return out;
  }

  // ---------- scoring ----------
  /** checkins: rows {participant_id, week, pa_days, deed_days, agon, badge_done, agft, meetup, personal_goal, bonus, late} */
  function scoreParticipants(season, participants, checkins) {
    var p = season.points;
    var validWeeks = {};
    season.weeks.forEach(function (w) {
      validWeeks[w.week] = true;
    });
    var byId = {};
    participants.forEach(function (pt) {
      byId[pt.id] = {
        id: pt.id,
        name: pt.name,
        username: pt.username,
        physical: 0,
        deeds: 0,
        agons: 0,
        badges: 0,
        agft: 0,
        meetup: 0,
        personalGoal: 0,
        bonus: 0,
        total: 0,
        weeksReported: 0
      };
    });
    // one row per participant+week: keep the latest submitted_at (defensive; the app upserts)
    var latest = {};
    checkins.forEach(function (c) {
      var k = c.participant_id + '|' + Number(c.week);
      if (!latest[k] || num(c.submitted_at, 0) >= num(latest[k].submitted_at, 0)) latest[k] = c;
    });
    Object.keys(latest).forEach(function (k) {
      var c = latest[k],
        s = byId[c.participant_id];
      if (!s || !validWeeks[Number(c.week)]) return;
      if (truthy(c.late) && !season.lateCounts) return;
      s.weeksReported++;
      s.physical += clamp(num(c.pa_days, 0), 0, 7) * p.physical;
      s.deeds += clamp(num(c.deed_days, 0), 0, 7) * p.deed;
      if (truthy(c.agon)) s.agons += p.agon;
      if (truthy(c.badge_done)) s.badges += p.badge;
      s.agft = Math.max(s.agft, clamp(num(c.agft, 0), 0, season.agftMax));
      if (truthy(c.meetup)) s.meetup = p.meetup;
      if (truthy(c.personal_goal)) s.personalGoal = p.personalGoal;
      if (truthy(c.bonus)) s.bonus = p.bonus;
    });
    Object.keys(byId).forEach(function (id) {
      var s = byId[id];
      s.total = s.physical + s.deeds + s.agons + s.badges + s.agft + s.meetup + s.personalGoal + s.bonus;
    });
    return byId;
  }
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  /** Standard competition ranking (1,2,2,4) on a pre-sorted array. */
  function rank(sorted, valueFn) {
    var prev = null,
      r = 0;
    sorted.forEach(function (row, i) {
      var v = valueFn(row);
      if (v !== prev) {
        r = i + 1;
        prev = v;
      }
      row.rank = r;
    });
    return sorted;
  }

  function teamStandings(season, teams, memberships, scores) {
    var byTeam = {};
    teams.forEach(function (t) {
      byTeam[key(t.name)] = { name: t.name, leaderId: t.leader_id || '', members: [], total: 0 };
    });
    var seen = {};
    memberships.forEach(function (m) {
      if (m.active === false || (m.active !== undefined && m.active !== '' && !truthy(m.active))) return;
      var t = byTeam[key(m.team)];
      var s = scores[m.participant_id];
      if (!t || !s) return;
      var dedupe = key(m.team) + '|' + m.participant_id;
      if (seen[dedupe]) return;
      seen[dedupe] = true;
      t.members.push({ id: s.id, name: s.name, total: s.total });
      t.total += s.total;
    });
    var list = Object.keys(byTeam)
      .map(function (k) {
        var t = byTeam[k];
        t.size = t.members.length;
        t.score = t.size ? Math.round(t.total / t.size) : 0;
        t.official = t.size >= season.minOfficialTeamSize;
        t.members.sort(function (a, b) {
          return b.total - a.total || a.name.localeCompare(b.name);
        });
        return t;
      })
      .filter(function (t) {
        return t.size > 0;
      });
    list.sort(function (a, b) {
      return b.score - a.score || a.name.localeCompare(b.name);
    });
    var official = rank(
      list.filter(function (t) {
        return t.official;
      }),
      function (t) {
        return t.score;
      }
    );
    var unofficial = list
      .filter(function (t) {
        return !t.official;
      })
      .map(function (t) {
        return Object.assign({}, t);
      });
    rank(unofficial, function (t) {
      return t.score;
    });
    return { official: official, unofficial: unofficial };
  }

  function leaderboards(season, participants, teams, memberships, checkins) {
    var scores = scoreParticipants(season, participants, checkins);
    var individuals = Object.keys(scores).map(function (id) {
      return scores[id];
    });
    individuals.sort(function (a, b) {
      return b.total - a.total || a.name.localeCompare(b.name);
    });
    rank(individuals, function (s) {
      return s.total;
    });
    var agft = individuals
      .filter(function (s) {
        return s.agft > 0;
      })
      .map(function (s) {
        return { id: s.id, name: s.name, agft: s.agft };
      });
    agft.sort(function (a, b) {
      return b.agft - a.agft || a.name.localeCompare(b.name);
    });
    rank(agft, function (s) {
      return s.agft;
    });
    var t = teamStandings(season, teams, memberships, scores);
    return {
      individuals: individuals,
      teamsOfficial: t.official,
      teamsUnofficial: t.unofficial,
      agft: agft,
      perfectScore: perfectScore(season)
    };
  }

  /**
   * Reference implementation of a wall-clock -> epoch conversion using Intl.
   * Apps Script uses Utilities.parseDate instead; this one is for tests (and a fallback).
   */
  function zonedToEpoch(local, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normLocal(local));
    if (!m) throw new Error('Bad date/time "' + local + '" (expected yyyy-MM-dd HH:mm:ss)');
    var asUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    var guess = asUTC - tzOffset(asUTC, tz);
    var off2 = tzOffset(guess, tz);
    return asUTC - off2;
  }
  function tzOffset(epoch, tz) {
    var f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    var parts = {};
    f.formatToParts(new Date(epoch)).forEach(function (p) {
      parts[p.type] = p.value;
    });
    var wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return wall - Math.floor(epoch / 1000) * 1000;
  }

  return {
    DEFAULTS: DEFAULTS,
    DAY_MS: DAY_MS,
    truthy: truthy,
    num: num,
    str: str,
    normName: normName,
    key: key,
    normUsername: normUsername,
    addDays: addDays,
    normLocal: normLocal,
    buildSeason: buildSeason,
    perfectScore: perfectScore,
    registrationStatus: registrationStatus,
    teamJoinStatus: teamJoinStatus,
    findWeek: findWeek,
    weekStatus: weekStatus,
    canSubmit: canSubmit,
    bonusRevealed: bonusRevealed,
    validateCheckin: validateCheckin,
    scoreParticipants: scoreParticipants,
    teamStandings: teamStandings,
    leaderboards: leaderboards,
    zonedToEpoch: zonedToEpoch
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
