// Minimal in-memory stand-ins for the Apps Script services Code.gs uses.
// Works in Node (require) and in the browser (<script>), so Code.gs can be exercised end-to-end.
(function (root) {
  function Range(sheet, r, c, nr, nc) {
    this.s = sheet;
    this.r = r;
    this.c = c;
    this.nr = nr;
    this.nc = nc;
  }
  var chain = ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'insertCheckboxes', 'setWrap'];
  chain.forEach(function (m) {
    Range.prototype[m] = function () {
      return this;
    };
  });
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.nr; i++) {
      var row = [];
      for (var j = 0; j < this.nc; j++) {
        var v = (this.s.d[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  };
  Range.prototype.setValues = function (vals) {
    for (var i = 0; i < vals.length; i++)
      for (var j = 0; j < vals[i].length; j++) this.s.set(this.r + i, this.c + j, vals[i][j]);
    return this;
  };
  Range.prototype.setValue = function (v) {
    this.s.set(this.r, this.c, v);
    return this;
  };

  function Sheet(name) {
    this.name = name;
    this.d = [];
  }
  Sheet.prototype.set = function (r, c, v) {
    while (this.d.length < r) this.d.push([]);
    this.d[r - 1][c - 1] = v;
  };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.d.length - 1; i >= 0; i--)
      if (
        (this.d[i] || []).some(function (v) {
          return v !== '' && v !== undefined;
        })
      )
        return i + 1;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    return this.d.reduce(function (m, r) {
      return Math.max(m, (r || []).length);
    }, 0);
  };
  Sheet.prototype.getMaxRows = function () {
    return 1000;
  };
  Sheet.prototype.getRange = function (a, c, nr, nc) {
    if (typeof a === 'string') return new Range(this, 1, 1, 1, 1);
    return new Range(this, a, c, nr || 1, nc || 1);
  };
  Sheet.prototype.getDataRange = function () {
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  };
  Sheet.prototype.appendRow = function (row) {
    var r = this.getLastRow() + 1;
    for (var j = 0; j < row.length; j++) this.set(r, j + 1, row[j]);
  };
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype.deleteRow = function (r) {
    this.d.splice(r - 1, 1);
  };

  function SS() {
    this.sheets = { Sheet1: new Sheet('Sheet1') };
    this.tz = 'America/New_York';
  }
  SS.prototype.getSheetByName = function (n) {
    return this.sheets[n] || null;
  };
  SS.prototype.insertSheet = function (n) {
    return (this.sheets[n] = new Sheet(n));
  };
  SS.prototype.getSheets = function () {
    var s = this.sheets;
    return Object.keys(s).map(function (k) {
      return s[k];
    });
  };
  SS.prototype.deleteSheet = function (sh) {
    delete this.sheets[sh.name];
  };
  SS.prototype.setSpreadsheetTimeZone = function (tz) {
    this.tz = tz;
  };
  SS.prototype.getSpreadsheetTimeZone = function () {
    return this.tz;
  };
  SS.prototype.toast = function () {};

  function install(g, Logic, opts) {
    opts = opts || {};
    var ss = new SS();
    var clock = { now: opts.now || Date.now() };
    g.SpreadsheetApp = {
      getActive: function () {
        return ss;
      },
      getUi: function () {
        throw new Error('no UI in tests');
      }
    };
    var cache = {};
    g.CacheService = {
      getScriptCache: function () {
        return {
          get: function (k) {
            return cache[k] || null;
          },
          put: function (k, v) {
            cache[k] = v;
          },
          remove: function (k) {
            delete cache[k];
          }
        };
      }
    };
    g.LockService = {
      getScriptLock: function () {
        return {
          tryLock: function () {
            return true;
          },
          releaseLock: function () {}
        };
      }
    };
    var n = 0;
    g.Utilities = {
      getUuid: function () {
        n++;
        return ('00000000' + n.toString(16)).slice(-8) + '-aaaa-bbbb-cccc-dddddddddddd';
      },
      parseDate: function (s, tz) {
        return new Date(Logic.zonedToEpoch(s, tz));
      },
      formatDate: function (d, tz, fmt) {
        var p = {};
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
          weekday: 'short',
          timeZoneName: 'short'
        })
          .formatToParts(d)
          .forEach(function (x) {
            p[x.type] = x.value;
          });
        var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p.month - 1];
        var h12 = +p.hour % 12 || 12,
          ampm = +p.hour < 12 ? 'AM' : 'PM';
        if (fmt === 'yyyy-MM-dd HH:mm:ss')
          return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
        if (fmt === 'd MMM') return +p.day + ' ' + mon;
        return p.weekday + ' ' + +p.day + ' ' + mon + ', ' + h12 + ':' + p.minute + ' ' + ampm + ' ' + p.timeZoneName;
      }
    };
    // Freeze "now" so deadline logic is testable
    Date.now = function () {
      return clock.now;
    };
    return { ss: ss, clock: clock };
  }

  var api = { install: install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GasMock = api;
})(this);
