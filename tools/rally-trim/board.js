/* Reading the scoreboard — by watching it change, not by reading it.

   docs/scoring.md designs a scoreboard READER: binarise, connected
   components, cluster the glyphs this recording happens to use, majority-vote
   over stable intervals, reject readings that are not a legal successor. It
   costs that at "300-400 lines and a day", and it is the right design for the
   question it asks, which is *what does the scoreboard say*.

   That is not the question here. This one is *when did it change*, and that
   is a frame difference over a small crop. No glyphs, no fonts, no legal
   successors — and it does not care that the plate was moved and rescaled in
   Resolve, which a template match very much would.

   It works because of what the scoreboard export does NOT draw.
   `sbxDrawFrame` has no clock: "There is deliberately no match clock here any
   more" (index.html:13807). And overlay.html states the general rule —
   "The clock is the only thing that moves on its own; everything else changes
   only when a point is scored" (overlay.html:287).

   So on this footage every change in that crop is a scored point. The clock
   guard below is there anyway, because somebody will eventually point this at
   an OBS capture where the clock IS drawn, and a reader that silently
   reports 5,400 points instead of 154 is worse than one that says so. */
'use strict';

const DEF = {
  /* finding the plate */
  cellsX: 8, cellsY: 4,
  minArea: 0.004, maxArea: 0.25,   // of the frame
  minAspect: 1.4, maxAspect: 14,   // a scoreboard plate is wide and short
  margin: 0.04,                    // grown by this much of its own size
  busyFloor: 0.10,                 // a graphic changes in fewer frames than this
  bridgeBusy: 0.08,                // refuse to span two blobs across this much movement
  minBlob: 4,                      // connected mask pixels before a blob counts at all

  /* watching it change */
  pixThresh: 12,                   // gray levels; below this is codec noise
  minFrac: 0.004,                  // of the crop's pixels, before it is a change
  sigmas: 5,                       // ... or this far above the quiet level, whichever is higher
  debounce: 1.2,                   // seconds; two points cannot be closer than this
  fadeFrac: 0.80,                  // this many cells at once is a cut or a fade, not a score
  cellFrac: 0.02,                  // of a cell's pixels, before that cell counts as changed
  /* Anything changing more often than this is not a scoreline. A tennis point
     ends at most about three times a minute (0.05/s); the export's scoreline
     runs around 0.03/s. A drawn clock ticks at 1/s and a patch of court that
     strayed into the box moves at the frame rate. Two-and-a-bit times the
     fastest plausible scoring rate separates them by two orders of magnitude,
     and this is the guard that lets a loose crop still work: the court cells
     inside it disqualify themselves. */
  clockRate: 0.12,
  edgeGuard: 1.5,                  // seconds at each end ignored, for fades
  t0: 0,                           // media time of the first frame in `frames`
  guardHead: true, guardTail: true // only the real ends of the FILE get the guard
};

function median(a) {
  if (!a.length) return NaN;
  const s = Array.prototype.slice.call(a).sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(a, med) {
  if (!a.length) return 0;
  return median(a.map(v => Math.abs(v - med)));
}

/* ------------------------------------------------------------------ finding

   A burnt-in graphic is the one thing in the frame that is simultaneously
   SHARP and STILL. The court is still too on a locked-off camera, but it is
   soft — grass, clay and fence have nothing like the edge energy of
   anti-aliased text on a solid plate. Players are sharp-ish but never still.
   So: high spatial gradient, low temporal change, and then the largest
   compact blob of that, preferring the corners because that is where anyone
   puts a scoreboard. */
function features(frames, w, h, pixThresh) {
  const n = frames.length, px = w * h;
  const T = pixThresh == null ? DEF.pixThresh : pixThresh;
  /* HOW OFTEN a pixel changes, not how much.

     Mean difference was the obvious choice and it is wrong, because the part
     of a scoreboard worth finding is the part that CHANGES. A digit flipping
     0->15 moves by the full contrast of the graphic, so on a mean it scores
     like a player and gets thrown out with them — leaving the detector
     clinging to whichever corner of the plate never updates.

     A fraction separates them cleanly instead: a scoreline changes in a few
     percent of frames and is identical in all the rest; a player is in motion
     in most of them. */
  const act = new Float64Array(px), edge = new Float64Array(px), mean = new Float64Array(px);
  for (let k = 0; k < n; k++) {
    const f = frames[k], prev = k ? frames[k - 1] : null;
    for (let i = 0; i < px; i++) {
      mean[i] += f[i];
      if (prev) { const d = f[i] - prev[i]; if ((d < 0 ? -d : d) >= T) act[i]++; }
    }
  }
  for (let i = 0; i < px; i++) { mean[i] /= n; if (n > 1) act[i] /= (n - 1); }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = mean[i + 1] - mean[i - 1], gy = mean[i + w] - mean[i - w];
      edge[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { act, edge, mean, w, h, n };
}

function components(mask, w, h) {
  const seen = new Uint8Array(w * h), out = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let top = 0; stack[top++] = s; seen[s] = 1;
    let x0 = w, x1 = -1, y0 = h, y1 = -1, count = 0;
    while (top) {
      const i = stack[--top], x = i % w, y = (i / w) | 0;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    out.push({ x0, x1, y0, y1, count, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return out;
}

function detect(frames, w, h, options) {
  const o = Object.assign({}, DEF, options || {});
  const F = features(frames, w, h, o.pixThresh);
  const px = w * h;
  const actList = Array.from(F.act), edgeList = Array.from(F.edge);
  const actMed = median(actList), actMad = mad(actList, actMed);
  /* Bursty: changes in only a small fraction of frames. Sharp: gradient well
     above the typical pixel's. Both measured on this recording, because "well
     above" means something different for a phone in a sports hall and a
     camera on a bright court. The floor on busyness matters — without it a
     perfectly static court drags the bar down to zero and the scoreline's own
     updates disqualify it. */
  const edgeMed = median(edgeList), edgeMad = mad(edgeList, edgeMed);
  const actCut = Math.min(0.35, Math.max(o.busyFloor, actMed + 3 * (actMad || 0)));
  const edgeCut = edgeMed + Math.max(2, 3 * (edgeMad || 1));
  const mask = new Uint8Array(px);
  for (let i = 0; i < px; i++) if (F.act[i] <= actCut && F.edge[i] >= edgeCut) mask[i] = 1;

  /* Drop single-pixel specks first. Sensor noise on a smooth surface throws
     off isolated gradients that are, quite truthfully, sharp and still — and
     a scatter of them across a static court will happily group itself onto
     the plate and drag the box out to twice its size. A glyph's edge is
     several pixels of connected run; a speck is one or two. */
  const clean = new Uint8Array(px);
  for (const c of components(mask, w, h)) {
    if (c.count < o.minBlob) continue;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * w + x;
      if (mask[i]) clean[i] = 1;
    }
  }

  /* Close the gaps BETWEEN GLYPHS without reaching far enough to touch
     anything else. One pixel further and a plate in the bottom corner welds
     itself to whichever player happens to stand near it, and the box comes
     back twice the size it should be — which still finds the changes, but
     drags a moving player's pixels into the signal along with them. */
  const grown = new Uint8Array(px);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!clean[i]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) grown[yy * w + xx] = 1;
    }
  }

  /* A plate's body is flat colour, so it has no gradient and never enters the
     mask — only its glyphs do, as a row of little separate blobs. Dilating
     far enough to weld them is what reached into the court before, so group
     them instead: blobs that sit within a scoreboard's own spacing belong to
     one plate, and a player standing nearby is much further away than that. */
  const gapX = Math.max(3, Math.round(w * 0.05)), gapY = Math.max(2, Math.round(h * 0.04));
  /* What FRACTION of this rectangle is a moving thing — not the mean
     busyness, which a big box full of static court dilutes to nothing however
     obviously a player is standing in the middle of it. */
  const busyFrac = (x0, x1, y0, y1) => {
    let hot = 0, n = 0;
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        if (F.act[y * w + x] > actCut) hot++;
        n++;
      }
    return n ? hot / n : 0;
  };
  const groups = components(grown, w, h);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < groups.length && !changed; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
        const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        if (dx > gapX || dy > gapY) continue;
        /* Close is not enough — a graphic is a contiguous STILL region, and a
           player standing against the plate is close to it too. Only bridge
           across ground that is as quiet as the plate itself. */
        if (busyFrac(Math.min(a.x0, b.x0), Math.max(a.x1, b.x1),
                     Math.min(a.y0, b.y0), Math.max(a.y1, b.y1)) > o.bridgeBusy) continue;
        a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1);
        a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1);
        a.count += b.count; a.w = a.x1 - a.x0 + 1; a.h = a.y1 - a.y0 + 1;
        groups.splice(j, 1); changed = true; break;
      }
    }
  }

  const cands = groups.map(c => {
    /* Shrink-wrap back onto the undilated mask, then trim edge rows and
       columns that carry almost none of it, so the box is the graphic rather
       than the graphic plus whatever the dilation reached. */
    const cols = new Float64Array(c.w), rows = new Float64Array(c.h);
    let inside = 0, actSum = 0, actN = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * w + x;
      if (F.act[i] > actCut) actSum++;
      actN++;
      if (!clean[i]) continue;
      cols[x - c.x0]++; rows[y - c.y0]++; inside++;
    }
    const trim = (arr, len) => {
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, arr[i]);
      const bar = peak * 0.08;
      let a = 0, b = len - 1;
      while (a < b && arr[a] <= bar) a++;
      while (b > a && arr[b] <= bar) b--;
      return [a, b];
    };
    const [cx0, cx1] = trim(cols, c.w), [ry0, ry1] = trim(rows, c.h);
    const x0 = c.x0 + cx0, x1 = c.x0 + cx1, y0 = c.y0 + ry0, y1 = c.y0 + ry1;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const area = (bw * bh) / px;
    const aspect = bw / Math.max(1, bh);
    const fill = inside / Math.max(1, bw * bh);
    const activity = actN ? actSum / actN : 0;   // fraction of the box in motion
    const near = Math.min(
      Math.hypot(x0, y0), Math.hypot(w - x1, y0),
      Math.hypot(x0, h - y1), Math.hypot(w - x1, h - y1)
    ) / Math.hypot(w, h);
    let score = 0;
    if (area >= o.minArea && area <= o.maxArea) score += 1;
    if (aspect >= o.minAspect && aspect <= o.maxAspect) score += 1;
    score += fill;                            // solid, not a scatter of speckles
    score += Math.max(0, 1 - near * 3);       // corners, strongly
    score += Math.min(0.5, area / 0.08);      // size helps, but only a little
    score -= Math.min(3, activity / o.bridgeBusy);   // a graphic has nothing moving in it
    return { x0, x1, y0, y1, w: bw, h: bh, count: inside, area, aspect, fill, activity, near, score };
  }).filter(c => c.area >= o.minArea && c.area <= o.maxArea)
    .sort((a, b) => b.score - a.score);

  if (!cands.length) return { box: null, candidates: [], reason: 'nothing in the picture looks like a burnt-in graphic' };
  const best = cands[0];
  const mx = Math.round(best.w * o.margin) + 1, my = Math.round(best.h * o.margin) + 1;
  const bx = Math.max(0, best.x0 - mx), by = Math.max(0, best.y0 - my);
  return {
    box: { x: bx, y: by, w: Math.min(w, best.x1 + mx + 1) - bx, h: Math.min(h, best.y1 + my + 1) - by },
    candidates: cands.slice(0, 5),
    score: best.score
  };
}

/* Scale a box found at probe resolution up to the real frame, and make it
   even — ffmpeg's crop wants that for chrominance-subsampled sources. */
function scaleBox(box, fromW, fromH, toW, toH) {
  const sx = toW / fromW, sy = toH / fromH;
  const ev = v => Math.max(2, Math.round(v / 2) * 2);
  const x = ev(box.x * sx), y = ev(box.y * sy);
  return { x, y, w: Math.min(ev(box.w * sx), toW - x), h: Math.min(ev(box.h * sy), toH - y) };
}

/* ----------------------------------------------------------------- watching

   Per cell, per frame: how many pixels moved by more than codec noise. Cells
   rather than the whole crop so that a clock can be told from a score — a
   clock is one cell ticking on its own, a score is one or two cells changing
   at instants scattered minutes apart, and a fade is every cell at once. */
function cellChanges(frames, w, h, fps, options) {
  const o = Object.assign({}, DEF, options || {});
  const n = frames.length;
  const CX = o.cellsX, CY = o.cellsY, C = CX * CY;
  const cw = w / CX, ch = h / CY;
  const per = new Array(C).fill(0).map(() => new Float64Array(Math.max(0, n - 1)));
  const cellPx = new Float64Array(C);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cellPx[((y / ch) | 0) * CX + ((x / cw) | 0)]++;

  for (let k = 1; k < n; k++) {
    const f = frames[k], p = frames[k - 1];
    for (let y = 0; y < h; y++) {
      const row = ((y / ch) | 0) * CX, off = y * w;
      for (let x = 0; x < w; x++) {
        const d = f[off + x] - p[off + x];
        if ((d < 0 ? -d : d) >= o.pixThresh) per[row + ((x / cw) | 0)][k - 1]++;
      }
    }
  }
  /* normalise each cell to the fraction of its own pixels that moved */
  for (let c = 0; c < C; c++) {
    const denom = Math.max(1, cellPx[c]);
    for (let k = 0; k < per[c].length; k++) per[c][k] /= denom;
  }
  return { per, C, CX, CY, cellPx, frames: n };
}

function changes(frames, w, h, fps, options) {
  const o = Object.assign({}, DEF, options || {});
  const n = frames.length;
  if (n < 4) return { events: [], excluded: [], reason: 'not enough board frames' };
  const cc = cellChanges(frames, w, h, fps, o);
  const dt = 1 / fps;

  /* A cell that fires this often is a clock, not a scoreline. Excluded before
     anything else looks at it. */
  const excluded = [];
  const live = [];
  for (let c = 0; c < cc.C; c++) {
    let fires = 0;
    for (let k = 0; k < cc.per[c].length; k++) if (cc.per[c][k] >= o.cellFrac) fires++;
    const rate = fires / Math.max(dt, (n - 1) * dt);
    if (rate >= o.clockRate) excluded.push({ cell: c, rate });
    else live.push(c);
  }
  if (!live.length) return { events: [], excluded, reason: 'every part of this box changes constantly — wrong box?' };
  if (excluded.length > cc.C * 0.75) {
    return { events: [], excluded, live: live.length, cells: cc.C,
             reason: 'most of this box is in constant motion — that is court, not a scoreboard' };
  }

  /* Per frame: how much of the live area moved, and how many cells joined in. */
  const amp = new Float64Array(n - 1), spread = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    let s = 0, c2 = 0;
    for (const c of live) { s += cc.per[c][k]; if (cc.per[c][k] >= o.cellFrac) c2++; }
    amp[k] = s / live.length;
    spread[k] = c2 / live.length;
  }

  /* The bar, the way AC-CORE draws one: an absolute floor, and a robust
     distance above however quiet this particular board sits, whichever is
     higher. A static board is almost exactly zero, so the floor usually wins
     — but a noisy re-encode is what the second half is for. */
  const list = Array.from(amp);
  const med = median(list), sd = 1.4826 * mad(list, med);
  const bar = Math.max(o.minFrac, med + o.sigmas * (sd || 0));

  const events = [];
  let lastT = -1e9;
  for (let k = 0; k < n - 1; k++) {
    if (amp[k] < bar) continue;
    const rel = (k + 1) * dt, t = o.t0 + rel;
    /* Only the real head and tail of the file get the fade guard. A chunk
       boundary in the middle is an artefact of decoding in parallel, and
       trimming there would quietly lose the points either side of it. */
    if (o.guardHead && rel < o.edgeGuard) continue;
    if (o.guardTail && rel > (n - 1) * dt - o.edgeGuard) continue;
    if (spread[k] >= o.fadeFrac) continue;                             // a cut or a fade, not a score
    if (t - lastT < o.debounce) {                                      // one update, two frames
      const last = events[events.length - 1];
      if (last && amp[k] > last.amp) { last.t = t; last.amp = amp[k]; last.spread = spread[k]; }
      continue;
    }
    events.push({ t, amp: amp[k], spread: spread[k] });
    lastT = t;
  }
  return { events, excluded, bar, quiet: med, live: live.length, cells: cc.C };
}

module.exports = { detect, changes, cellChanges, features, components, scaleBox, median, mad, DEF };
