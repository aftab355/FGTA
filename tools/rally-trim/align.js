/* Putting the tap list onto the timeline of the file you actually have.

   The reel's timecodes are MATCH time — seconds from the first ball. The file
   on disk is often not that. This one was trimmed: set breaks and
   interruptions were cut out before it was handed over, so the video is about
   ten minutes shorter than the match and the difference is not a constant.

   `rrVideoSec` (index.html) cannot express that. It is affine — one `base`
   plus one `drift` for the whole match — and the generated script has the same
   single `OFFSET`. Nudge it to fix the third set and you break the first.

   So the offset is recovered here instead, and it is allowed to STEP.

   What makes it tractable: an excision is a removed BREAK, and a break is a
   long gap between taps. The candidate step locations are therefore known in
   advance — the handful of tap gaps over `bigGap` — and only the amount
   removed at each has to be measured.

   What makes it reliable: a step is not fitted to one point. It is fitted to
   the RELATIVE SPACING of the next several point endings, which within an
   unspliced stretch is exact. Matching a sequence of intervals is far more
   discriminating than matching a single instant, and it is what stops the
   search locking onto a neighbouring court's rally.

   One thing to be careful about. The offset `o` that comes out of this is NOT
   a timeline offset. It absorbs a bias, because a tap marks the ball going
   dead while the anchor in the audio is the last STRIKE, one ball flight
   earlier. Differences of `o` are meaningful — that is the removed time, and
   the bias cancels — but `o` itself is not.

   That bias cannot be measured here, and it would be dishonest to report a
   number as if it had been: a recording shifted by 0.8s and a ball that flies
   for 0.8s produce identical data. Flight time, the ref's reaction and any
   mis-set `lag` are confounded. So the flight is an explicit assumption,
   `endPad`, and `tail` is added on top of it. What IS measured, and is worth
   reading, is the spread of the residuals — how consistently the taps line up
   once the offset is found. That is the number that says whether to trust
   the alignment at all. */
'use strict';

function median(a) {
  if (!a.length) return NaN;
  const s = Array.prototype.slice.call(a).sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DEF = {
  tol: 5.0,          // how far a point ending may sit from where it was predicted
  bigGap: 40,        // a tap gap this long may hide an excision
  coarse: 0.5,       // offset search step, seconds
  fine: 0.05,
  lead: 10,          // point endings used to score a candidate offset
  searchLo: -300,    // bootstrap range for the head of the file
  searchHi: 900,
  slack: 3,          // a step may go slightly backwards, for rounding only
  endPad: 0.8        // assumed: last strike -> ball actually dead. See above.
};

/* The last strike of a run is the anchor: the winning shot of that point. */
function runEnds(runs) {
  return runs.map(r => r[r.length - 1].t).sort((a, b) => a - b);
}

function nearest(ends, t) {
  if (!ends.length) return -1;
  let lo = 0, hi = ends.length - 1;
  if (t <= ends[0]) return 0;
  if (t >= ends[hi]) return hi;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid] <= t) lo = mid; else hi = mid;
  }
  return (t - ends[lo]) <= (ends[hi] - t) ? lo : hi;
}

/* How well does this offset explain the next few point endings? Each point
   contributes at most 1, falling off linearly to 0 at `tol`, so a candidate
   that lines up several points beats one that nails a single point by luck. */
function score(points, from, to, o, ends, tol) {
  let s = 0;
  for (let i = from; i < to && i < points.length; i++) {
    const pred = points[i].matchEnd - o;
    const k = nearest(ends, pred);
    if (k < 0) continue;
    const err = Math.abs(pred - ends[k]);
    if (err < tol) s += 1 - err / tol;
  }
  return s;
}

function searchOffset(points, from, to, lo, hi, ends, opt) {
  let best = { o: lo, s: -1 };
  for (let o = lo; o <= hi; o += opt.coarse) {
    const s = score(points, from, to, o, ends, opt.tol);
    if (s > best.s) best = { o, s };
  }
  const a = best.o - opt.coarse, b = best.o + opt.coarse;
  for (let o = a; o <= b; o += opt.fine) {
    const s = score(points, from, to, o, ends, opt.tol);
    if (s > best.s) best = { o, s };
  }
  return best;
}

function align(points, runs, options) {
  const opt = Object.assign({}, DEF, options || {});
  const ends = runEnds(runs);
  const N = points.length;
  const out = points.map(p => Object.assign({}, p));
  if (!N) return { points: out, splices: [], spread: null, endPad: opt.endPad, ends, matched: 0 };
  if (!ends.length) {
    for (const p of out) { p.aligned = false; p.reason = 'no strikes detected at all'; }
    return { points: out, splices: [], spread: null, endPad: opt.endPad, ends, matched: 0, failed: true };
  }

  /* ---- pass A: walk forward, allowing a step at every long tap gap ---- */
  let o = searchOffset(out, 0, opt.lead, opt.searchLo, opt.searchHi, ends, opt).o;
  const stretches = [{ from: 0, o }];
  for (let i = 1; i < N; i++) {
    const gap = out[i].matchEnd - out[i - 1].matchEnd;
    if (gap < opt.bigGap) continue;
    const here = score(out, i, i + opt.lead, o, ends, opt.tol);
    /* Time can only have been REMOVED, so the offset can only grow — by at
       most the whole gap. `slack` is for rounding, not for real movement. */
    const cand = searchOffset(out, i, i + opt.lead, o - opt.slack, o + gap + opt.slack, ends, opt);
    if (cand.s > here + 0.75 && Math.abs(cand.o - o) > 0.5) {
      o = cand.o;
      stretches.push({ from: i, o, gap, removed: null });
    }
  }

  /* ---- pass B: re-fit each stretch from all of its own matches ---- */
  for (let s = 0; s < stretches.length; s++) {
    const from = stretches[s].from;
    const to = s + 1 < stretches.length ? stretches[s + 1].from : N;
    const implied = [];
    for (let i = from; i < to; i++) {
      const pred = out[i].matchEnd - stretches[s].o;
      const k = nearest(ends, pred);
      if (k >= 0 && Math.abs(pred - ends[k]) < opt.tol) implied.push(out[i].matchEnd - ends[k]);
    }
    if (implied.length >= 3) stretches[s].o = median(implied);
    stretches[s].to = to;
    stretches[s].matched = implied.length;
  }

  /* ---- assign ---- */
  const resid = [];
  for (let s = 0; s < stretches.length; s++) {
    for (let i = stretches[s].from; i < stretches[s].to; i++) {
      const p = out[i];
      p.o = stretches[s].o;
      const pred = p.matchEnd - p.o;
      const k = nearest(ends, pred);
      if (k >= 0 && Math.abs(pred - ends[k]) < opt.tol) {
        p.aligned = true;
        p.lastStrike = ends[k];
        p.residual = pred - ends[k];
        resid.push(Math.abs(p.residual));
      } else {
        p.aligned = false;
        p.lastStrike = null;
        p.residual = null;
        p.reason = 'no strike run near where this point should have ended';
      }
    }
  }
  const spread = resid.length ? median(resid) : null;

  /* A point ending sits one ball flight after the last strike of its rally.
     Located points get it from their own anchor; the rest fall back to the
     stretch offset, which lands where that point's last strike would have
     been — so the same pad applies to both. */
  for (const p of out) {
    p.videoEnd = (p.aligned ? p.lastStrike : p.matchEnd - p.o) + opt.endPad;
  }

  const splices = [];
  for (let s = 1; s < stretches.length; s++) {
    splices.push({
      atPoint: stretches[s].from + 1,
      afterRally: stretches[s].from,
      removed: stretches[s].o - stretches[s - 1].o,
      gap: stretches[s].gap,
      matchTime: out[stretches[s].from - 1].matchEnd
    });
  }

  return {
    points: out, splices, spread, endPad: opt.endPad, ends, stretches,
    matched: out.filter(p => p.aligned).length
  };
}

module.exports = { align, runEnds, nearest, score, searchOffset, median, DEF };
