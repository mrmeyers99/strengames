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

  // ---- SHA-256 / HMAC in plain JS (the demo page runs this mock in the browser, without Node's crypto)
  function bytesOf(v) {
    if (typeof v !== 'string')
      return Array.prototype.map.call(v, function (b) {
        return b & 255;
      });
    var s = unescape(encodeURIComponent(v)),
      out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function signed(bytes) {
    return bytes.map(function (b) {
      return b > 127 ? b - 256 : b;
    });
  }
  var K = [];
  (function () {
    var found = 0;
    for (var c = 2; found < 64; c++) {
      var prime = true;
      for (var d = 2; d * d <= c; d++)
        if (c % d === 0) {
          prime = false;
          break;
        }
      if (prime) K[found++] = ((Math.pow(c, 1 / 3) % 1) * 4294967296) | 0;
    }
  })();
  function sha256(msg) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = msg.slice(),
      bitLen = msg.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var s = 56; s >= 0; s -= 8)
      bytes.push(s >= 32 ? Math.floor(bitLen / Math.pow(2, s)) & 255 : (bitLen >>> s) & 255);
    function rotr(x, k) {
      return (x >>> k) | (x << (32 - k));
    }
    var W = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var i = 0; i < 16; i++)
        W[i] =
          (bytes[off + 4 * i] << 24) |
          (bytes[off + 4 * i + 1] << 16) |
          (bytes[off + 4 * i + 2] << 8) |
          bytes[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        var s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0],
        b = H[1],
        c = H[2],
        d = H[3],
        e = H[4],
        f = H[5],
        g = H[6],
        h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      H = [a, b, c, d, e, f, g, h].map(function (v, k) {
        return (H[k] + v) | 0;
      });
    }
    var out = [];
    H.forEach(function (v) {
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    });
    return out;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    while (key.length < 64) key = key.concat([0]);
    var ipad = key.map(function (b) {
        return b ^ 0x36;
      }),
      opad = key.map(function (b) {
        return b ^ 0x5c;
      });
    return sha256(opad.concat(sha256(ipad.concat(msg))));
  }

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
    var props = {};
    g.PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) {
            return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null;
          },
          setProperty: function (k, v) {
            props[k] = String(v);
            return this;
          }
        };
      }
    };
    var n = 0;
    g.Utilities = {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      // Like Apps Script: strings are UTF-8 encoded, results are arrays of signed bytes.
      computeDigest: function (alg, value) {
        return signed(sha256(bytesOf(value)));
      },
      computeHmacSha256Signature: function (value, key) {
        return signed(hmac(bytesOf(key), bytesOf(value)));
      },
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
