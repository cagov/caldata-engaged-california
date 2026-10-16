(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g=(g.d3||(g.d3 = {}));g=(g.layout||(g.layout = {}));g.cloud = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// Word cloud layout by Jason Davies, https://www.jasondavies.com/wordcloud/
// Algorithm due to Jonathan Feinberg, https://s3.amazonaws.com/static.mrfeinberg.com/bv_ch03.pdf

const dispatch = require("d3-dispatch").dispatch;

const RADIANS = Math.PI / 180;

const SPIRALS = {
  archimedean: archimedeanSpiral,
  rectangular: rectangularSpiral
};

const cw = 1 << 11 >> 5;
const ch = 1 << 11;

module.exports = function() {
  var size = [256, 256],
      text = cloudText,
      font = cloudFont,
      fontSize = cloudFontSize,
      fontStyle = cloudFontNormal,
      fontWeight = cloudFontNormal,
      padding = cloudPadding,
      spiral = archimedeanSpiral,
      words = [],
      timeInterval = Infinity,
      event = dispatch("word", "end"),
      timer = null,
      random = Math.random,
      rotate = () => (~~(random() * 6) - 3) * 30,
      cloud = {},
      keepSprites = false,
      canvas = cloudCanvas;

  cloud.canvas = function(_) {
    return arguments.length ? (canvas = functor(_), cloud) : canvas;
  };

  cloud.start = function() {
    if (!(size[0] > 0 && size[1] > 0)) throw new Error("d3-cloud: size must be two positive numbers, got " + size); // PATCH 5: NaN size = infinite spiral
    var contextAndRatio = getContext(canvas()),
        board = zeroArray((size[0] >> 5) * size[1]),
        bounds = null,
        n = words.length,
        i = -1,
        tags = [],
        data = words.map(function(d, i) {
          d.text = text.call(this, d, i);
          d.font = font.call(this, d, i);
          d.style = fontStyle.call(this, d, i);
          d.weight = fontWeight.call(this, d, i);
          d.rotate = rotate.call(this, d, i);
          d.size = +fontSize.call(this, d, i); // PATCH 2: keep the fractional size; the mask must be drawn at exactly the size the app draws
          d.padding = padding.call(this, d, i);
          return d;
        }).sort(function(a, b) { return b.size - a.size; });

    if (timer) clearInterval(timer);
    timer = setInterval(step, 0);
    step();

    return cloud;

    function step() {
      var start = Date.now();
      while (Date.now() - start < timeInterval && ++i < n && timer) {
        var d = data[i];
        // PATCH 4 (optional): caller-provided search start point, so the layout's texture is
        // set by where words START looking (e.g. a spread-out low-discrepancy set), not by
        // d3-cloud's default random point in the central 50% box.
        if (d.seedX != null) { d.x = d.seedX | 0; d.y = d.seedY | 0; }
        else { d.x = (size[0] * (random() + .5)) >> 1; d.y = (size[1] * (random() + .5)) >> 1; }
        cloudSprite(contextAndRatio, d, data, i);
        if (d.hasText && place(board, d, bounds)) {
          tags.push(d);
          event.call("word", cloud, d);
          if (bounds) cloudBounds(bounds, d);
          else bounds = [{x: d.x + d.x0, y: d.y + d.y0}, {x: d.x + d.x1, y: d.y + d.y1}];
          // Temporary hack
          d.x -= size[0] >> 1;
          d.y -= size[1] >> 1;
        }
      }
      if (i >= n) {
        cloud.stop();
        event.call("end", cloud, tags, bounds);
      }
    }
  }

  cloud.stop = function() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // PATCH 8: optionally keep sprites. A sprite depends only on text, font,
    // size and padding, so callers that run the same words many times with
    // different start points (best-of-N selection) can skip re-rasterizing
    // 27 labels into the 2048x2048 sheet and reading it back on every run —
    // that readback was most of the per-candidate cost.
    if (!keepSprites) for (const d of words) {
      delete d.sprite;
    }
    return cloud;
  };

  cloud.keepSprites = function(_) {
    return arguments.length ? (keepSprites = !!_, cloud) : keepSprites;
  };

  function getContext(canvas) {
    const context = canvas.getContext("2d", {willReadFrequently: true});

    canvas.width = canvas.height = 1;
    const ratio = Math.sqrt(context.getImageData(0, 0, 1, 1).data.length >> 2);
    canvas.width = (cw << 5) / ratio;
    canvas.height = ch / ratio;

    context.fillStyle = context.strokeStyle = "red";

    return {context, ratio};
  }

  function place(board, tag, bounds) {
    var perimeter = [{x: 0, y: 0}, {x: size[0], y: size[1]}],
        startX = tag.x,
        startY = tag.y,
        maxDelta = Math.sqrt(size[0] * size[0] + size[1] * size[1]),
        s = spiral(size),
        dt = random() < .5 ? 1 : -1,
        t = -dt,
        dxdy,
        dx,
        dy;

    while (dxdy = s(t += dt)) {
      dx = ~~dxdy[0];
      dy = ~~dxdy[1];

      if (Math.min(Math.abs(dx), Math.abs(dy)) >= maxDelta) break;

      tag.x = startX + dx;
      tag.y = startY + dy;

      if (tag.x + tag.x0 < 0 || tag.y + tag.y0 < 0 ||
          tag.x + tag.x1 > size[0] || tag.y + tag.y1 > size[1]) continue;
      // TODO only check for collisions within current bounds.
      // PATCH 6: upstream only accepts a position whose rect touches the
      // bounding box of the words already placed (that is what keeps a
      // default cloud connected and compact). A caller-seeded word (PATCH 4)
      // is exempt, so a deliberately placed skeleton word lands exactly on
      // its seed instead of walking its spiral until it touches the cluster.
      if (!bounds || tag.seedX != null || collideRects(tag, bounds)) {
        if (!cloudCollide(tag, board, size[0])) {
          var sprite = tag.sprite,
              w = tag.width >> 5,
              sw = size[0] >> 5,
              lx = tag.x - (w << 4),
              sx = lx & 0x7f,
              msx = 32 - sx,
              h = tag.y1 - tag.y0,
              x = (tag.y + tag.y0) * sw + (lx >> 5),
              last;
          for (var j = 0; j < h; j++) {
            last = 0;
            for (var i = 0; i <= w; i++) {
              board[x + i] |= (last << msx) | (i < w ? (last = sprite[j * w + i]) >>> sx : 0);
            }
            x += sw;
          }
          return true;
        }
      }
    }
    return false;
  }

  cloud.timeInterval = function(_) {
    return arguments.length ? (timeInterval = _ == null ? Infinity : _, cloud) : timeInterval;
  };

  cloud.words = function(_) {
    return arguments.length ? (words = _, cloud) : words;
  };

  cloud.size = function(_) {
    return arguments.length ? (size = [+_[0], +_[1]], cloud) : size;
  };

  cloud.font = function(_) {
    return arguments.length ? (font = functor(_), cloud) : font;
  };

  cloud.fontStyle = function(_) {
    return arguments.length ? (fontStyle = functor(_), cloud) : fontStyle;
  };

  cloud.fontWeight = function(_) {
    return arguments.length ? (fontWeight = functor(_), cloud) : fontWeight;
  };

  cloud.rotate = function(_) {
    return arguments.length ? (rotate = functor(_), cloud) : rotate;
  };

  cloud.text = function(_) {
    return arguments.length ? (text = functor(_), cloud) : text;
  };

  cloud.spiral = function(_) {
    return arguments.length ? (spiral = SPIRALS[_] || _, cloud) : spiral;
  };

  cloud.fontSize = function(_) {
    return arguments.length ? (fontSize = functor(_), cloud) : fontSize;
  };

  cloud.padding = function(_) {
    return arguments.length ? (padding = functor(_), cloud) : padding;
  };

  cloud.random = function(_) {
    return arguments.length ? (random = _, cloud) : random;
  };

  cloud.on = function() {
    var value = event.on.apply(event, arguments);
    return value === event ? cloud : value;
  };

  return cloud;
};

function cloudText(d) {
  return d.text;
}

function cloudFont() {
  return "serif";
}

function cloudFontNormal() {
  return "normal";
}

function cloudFontSize(d) {
  return Math.sqrt(d.value);
}

function cloudPadding() {
  return 1;
}

// Fetches a monochrome sprite bitmap for the specified text.
// Load in batches for speed.
function cloudSprite(contextAndRatio, d, data, di) {
  if (d.sprite) return;
  var c = contextAndRatio.context,
      ratio = contextAndRatio.ratio;

  c.clearRect(0, 0, (cw << 5) / ratio, ch / ratio);
  var x = 0,
      y = 0,
      maxh = 0,
      n = data.length;
  --di;
  while (++di < n) {
    d = data[di];
    c.save();
    c.font = d.style + " " + d.weight + " " + (d.size / ratio) + "px " + d.font; // PATCH 2: exact px, not ~~size+1 (that made mask glyphs ~3% wider than drawn ones, so letters drifted off their own mask)
    // --- multi-line patch (not upstream d3-cloud): reads `d.lines`, an
    // array of strings, if the caller set one; otherwise falls back to
    // the original single-line `d.text` behavior unchanged. Everything
    // below this still writes into the SAME shared sprite-sheet canvas
    // that getImageData() reads back from further down, so the pixel
    // mask this produces is accurate for however many lines were
    // actually drawn — the overlap guarantee this library provides
    // still holds, just against real multi-line glyphs now.
    var lines = (d.lines && d.lines.length) ? d.lines : [d.text];
    var maxLineWidth = 0;
    for (var li = 0; li < lines.length; li++) {
      var lw = c.measureText(lines[li]).width;
      if (lw > maxLineWidth) maxLineWidth = lw;
    }
    const anchor = -Math.floor(maxLineWidth / 2);
    let w = (maxLineWidth + 1 + 2 * (d.padding || 0) + 4) * ratio; // PATCH 3: room for the padding stroke and right-side glyph overhang
    // Internal (pre-ratio) line height, matching this file's own
    // font-size-to-height convention (d.size << 1 for one line) scaled
    // per extra line, with the original one-line height as a floor so
    // single-line words render identically to unpatched d3-cloud.
    var lineHeightInternal = (d.size * 1.22) / ratio;
    // PATCH 1 (sprite height): the old 1.22em-per-line box left only 0.61em above the
    // first baseline; Noto Sans ascenders reach 0.765em, so the top of every 2-line
    // label was never in the collision mask. Now: one line-height per extra line,
    // plus the single-line 2em envelope (1em above the first baseline, 1em below the last).
    let h = Math.max(Math.ceil(2 * d.size), Math.ceil(((lines.length - 1) * lineHeightInternal + 2 * d.size) * ratio));
    if (d.rotate) {
      var sr = Math.sin(d.rotate * RADIANS),
          cr = Math.cos(d.rotate * RADIANS),
          wcr = w * cr,
          wsr = w * sr,
          hcr = h * cr,
          hsr = h * sr;
      w = (Math.max(Math.abs(wcr + hsr), Math.abs(wcr - hsr)) + 0x1f) >> 5 << 5;
      h = ~~Math.max(Math.abs(wsr + hcr), Math.abs(wsr - hcr));
    } else {
      w = (w + 0x1f) >> 5 << 5;
    }
    if (h > maxh) maxh = h;
    if (x + w >= (cw << 5)) {
      x = 0;
      y += maxh;
      maxh = 0;
    }
    if (y + h >= ch) break;
    c.translate((x + (w >> 1)) / ratio, (y + (h >> 1)) / ratio);
    if (d.rotate) c.rotate(d.rotate * RADIANS);
    if (d.padding) c.lineWidth = 2 * d.padding;
    var startYInternal = -((lines.length - 1) * lineHeightInternal) / 2;
    for (var lj = 0; lj < lines.length; lj++) {
      var ly = startYInternal + lj * lineHeightInternal;
      c.fillText(lines[lj], anchor, ly);
      if (d.padding) c.strokeText(lines[lj], anchor, ly);
    }
    c.restore();
    d.width = w;
    d.height = h;
    d.xoff = x;
    d.yoff = y;
    d.x1 = w >> 1;
    d.y1 = h >> 1;
    d.x0 = -d.x1;
    d.y0 = -d.y1;
    d.hasText = true;
    x += w;
  }
  var pixels = c.getImageData(0, 0, (cw << 5) / ratio, ch / ratio).data,
      sprite = [];
  while (--di >= 0) {
    d = data[di];
    if (!d.hasText) continue;
    var w = d.width,
        w32 = w >> 5,
        h = d.y1 - d.y0;
    // Zero the buffer
    for (var i = 0; i < h * w32; i++) sprite[i] = 0;
    x = d.xoff;
    if (x == null) return;
    y = d.yoff;
    // PATCH 7: trim blank rows at the BOTTOM as well as the top. Upstream's
    // `seen` is cumulative, so once any row has ink every later row counts as
    // seen and the trailing envelope (the ~0.75em under the last baseline
    // that the 2em-per-line sprite box reserves) stayed in the mask.
    // Correction after measuring: blank rows are zero bits and never collide,
    // so this does NOT change packing density — it only tightens the word's
    // bounding box (y1), which matters for the field-edge bounds check and
    // the bounds-intersection rule in place(). Kept because it is cheap and
    // correct: rows with ink (glyphs AND the padding stroke, both drawn red)
    // are kept exactly, so the mask still contains everything drawn.
    var seen = 0,
        lastInk = -1,
        rowSeen;
    for (var j = 0; j < h; j++) {
      rowSeen = 0;
      for (var i = 0; i < w; i++) {
        var k = w32 * j + (i >> 5),
            m = pixels[((y + j) * (cw << 5) + (x + i)) << 2] ? 1 << (31 - (i % 32)) : 0;
        sprite[k] |= m;
        rowSeen |= m;
      }
      if (rowSeen) { seen = 1; lastInk = j; }
      else if (!seen) {
        d.y0++;
        h--;
        j--;
        y++;
      }
    }
    d.y1 = d.y0 + lastInk + 1;
    d.sprite = sprite.slice(0, (lastInk + 1) * w32);
  }
}

// Use mask-based collision detection.
function cloudCollide(tag, board, sw) {
  sw >>= 5;
  var sprite = tag.sprite,
      w = tag.width >> 5,
      lx = tag.x - (w << 4),
      sx = lx & 0x7f,
      msx = 32 - sx,
      h = tag.y1 - tag.y0,
      x = (tag.y + tag.y0) * sw + (lx >> 5),
      last;
  for (var j = 0; j < h; j++) {
    last = 0;
    for (var i = 0; i <= w; i++) {
      if (((last << msx) | (i < w ? (last = sprite[j * w + i]) >>> sx : 0))
          & board[x + i]) return true;
    }
    x += sw;
  }
  return false;
}

function cloudBounds(bounds, d) {
  var b0 = bounds[0],
      b1 = bounds[1];
  if (d.x + d.x0 < b0.x) b0.x = d.x + d.x0;
  if (d.y + d.y0 < b0.y) b0.y = d.y + d.y0;
  if (d.x + d.x1 > b1.x) b1.x = d.x + d.x1;
  if (d.y + d.y1 > b1.y) b1.y = d.y + d.y1;
}

function collideRects(a, b) {
  return a.x + a.x1 > b[0].x && a.x + a.x0 < b[1].x && a.y + a.y1 > b[0].y && a.y + a.y0 < b[1].y;
}

function archimedeanSpiral(size) {
  var e = size[0] / size[1];
  return function(t) {
    return [e * (t *= .1) * Math.cos(t), t * Math.sin(t)];
  };
}

function rectangularSpiral(size) {
  var dy = 4,
      dx = dy * size[0] / size[1],
      x = 0,
      y = 0;
  return function(t) {
    var sign = t < 0 ? -1 : 1;
    // See triangular numbers: T_n = n * (n + 1) / 2.
    switch ((Math.sqrt(1 + 4 * sign * t) - sign) & 3) {
      case 0:  x += dx; break;
      case 1:  y += dy; break;
      case 2:  x -= dx; break;
      default: y -= dy; break;
    }
    return [x, y];
  };
}

// TODO reuse arrays?
function zeroArray(n) {
  var a = [],
      i = -1;
  while (++i < n) a[i] = 0;
  return a;
}

function cloudCanvas() {
  return document.createElement("canvas");
}

function functor(d) {
  return typeof d === "function" ? d : function() { return d; };
}

},{"d3-dispatch":2}],2:[function(require,module,exports){
// https://d3js.org/d3-dispatch/ v1.0.6 Copyright 2019 Mike Bostock
(function (global, factory) {
typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
typeof define === 'function' && define.amd ? define(['exports'], factory) :
(global = global || self, factory(global.d3 = global.d3 || {}));
}(this, function (exports) { 'use strict';

var noop = {value: function() {}};

function dispatch() {
  for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
    if (!(t = arguments[i] + "") || (t in _) || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
    _[t] = [];
  }
  return new Dispatch(_);
}

function Dispatch(_) {
  this._ = _;
}

function parseTypenames(typenames, types) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
    if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
    return {type: t, name: name};
  });
}

Dispatch.prototype = dispatch.prototype = {
  constructor: Dispatch,
  on: function(typename, callback) {
    var _ = this._,
        T = parseTypenames(typename + "", _),
        t,
        i = -1,
        n = T.length;

    // If no callback was specified, return the callback of the given type and name.
    if (arguments.length < 2) {
      while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
      return;
    }

    // If a type was specified, set the callback for the given type and name.
    // Otherwise, if a null callback was specified, remove callbacks of the given name.
    if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
    while (++i < n) {
      if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
      else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
    }

    return this;
  },
  copy: function() {
    var copy = {}, _ = this._;
    for (var t in _) copy[t] = _[t].slice();
    return new Dispatch(copy);
  },
  call: function(type, that) {
    if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  },
  apply: function(type, that, args) {
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  }
};

function get(type, name) {
  for (var i = 0, n = type.length, c; i < n; ++i) {
    if ((c = type[i]).name === name) {
      return c.value;
    }
  }
}

function set(type, name, callback) {
  for (var i = 0, n = type.length; i < n; ++i) {
    if (type[i].name === name) {
      type[i] = noop, type = type.slice(0, i).concat(type.slice(i + 1));
      break;
    }
  }
  if (callback != null) type.push({name: name, value: callback});
  return type;
}

exports.dispatch = dispatch;

Object.defineProperty(exports, '__esModule', { value: true });

}));

},{}]},{},[1])(1)
});
