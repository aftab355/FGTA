/* Does rally-trim find the serve, survive a spliced recording, and refuse to
   be fooled by the court next door?

   No video and no ffmpeg needed: the serve and alignment cases are driven with
   synthetic strike trains that have known ground truth, and the picture case
   reuses test/tensors.js, which already builds an 'adjacent' scenario — audio
   heard a full rally, the frame is empty.

   node test/trim.test.js */
'use strict';
const align = require('../tools/rally-trim/align.js');
const serve = require('../tools/rally-trim/serve.js');
const motion = require('../tools/rally-trim/motion.js');
const { build } = require('./tensors.js');
const { avROI, avSeries } = require('./extract.js').loadCore();

let pass = 0, fail = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x != null ? '   [' + x + ']' : '')); }
};
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

/* The reel's own defaults, and the detector's. */
const TUNE = { lag: 1.2, dead: 12, lead: 2, tail: 2, max: 30, min: 4 };
const AC = { maxGap: 2.5, minHits: 2, hardFrac: 0.45, aceFrac: 0.72 };

const hit = (t, lvl) => ({ t: Math.round(t * 100) / 100, lvl });
/* Strikes spread over [t0,t1] at roughly `step`, landing exactly on BOTH ends:
   the first is the serve and the last is the winning shot, and the tests are
   about finding precisely those two. */
function rally(t0, t1, lvl, step) {
  const k = Math.max(1, Math.round((t1 - t0) / (step || 0.9)));
  const out = [];
  for (let i = 0; i <= k; i++) out.push(hit(t0 + (t1 - t0) * i / k, lvl));
  return out;
}
const asAligned = pts => ({
  points: pts.map((p, i) => Object.assign({
    n: i + 1, aligned: true, residual: 0, reelStart: null, reelDur: null, label: 'r' + (i + 1)
  }, p))
});

/* ---------------------------------------------------------------- serves */
console.log('\nfinding the serve');
{
  let H = [];
  /* 1. bounces before the serve: the clip must not open on them */
  H = H.concat([hit(18, 0.2), hit(19, 0.2), hit(20, 0.2)], rally(21, 27, 0.8));
  /* 2. a fault, then the second serve: BOTH kept, one clip */
  H = H.concat([hit(40, 0.9)], rally(48, 54, 0.8));
  /* 3. the next court, far enough back that the gap rule alone rejects it */
  H = H.concat(rally(60, 66, 0.5), rally(85, 91, 0.8));
  /* 4. the next court, close enough that only the picture can reject it */
  H = H.concat(rally(100, 104, 0.5), rally(109, 115, 0.8));
  H.sort((a, b) => a.t - b.t);

  const pts = asAligned([
    { matchEnd: 27.6, videoEnd: 27.6 }, { matchEnd: 54.6, videoEnd: 54.6 },
    { matchEnd: 91.6, videoEnd: 91.6 }, { matchEnd: 115.6, videoEnd: 115.6 }
  ]);

  const r = serve.findServes(pts, H, TUNE, AC, {});
  ok(r.length === 4, 'four clips out', r.length);
  ok(r.every(x => x.measured), 'every start measured, none fell back');
  ok(near(r[0].serve, 21, 0.01), 'opens on the serve, not the three bounces before it', r[0].serve);
  ok(near(r[1].serve, 40, 0.01), 'fault kept: clip opens on the first serve attempt', r[1].serve);
  ok(r[1].faults === 1, 'the fault is counted', r[1].faults);
  ok(near(r[2].serve, 85, 0.01), 'next court 19s earlier is not absorbed', r[2].serve);
  ok(near(r[3].serve, 100, 0.01), 'next court 5s earlier IS absorbed by ear alone', r[3].serve);

  /* the same footage, with the picture saying the court was empty at 100-104 */
  const gate = (t0) => ({ ratio: t0 >= 99 && t0 < 108 ? 0.02 : 0.9, ok: !(t0 >= 99 && t0 < 108) });
  const g = serve.findServes(pts, H, TUNE, AC, { gate });
  ok(near(g[3].serve, 109, 0.01), 'with the picture, the next court is rejected', g[3].serve);
  ok(near(g[0].serve, 21, 0.01), 'and the real serves are untouched', g[0].serve);

  /* a point nobody heard falls back, and says so */
  const quiet = asAligned([{ matchEnd: 27.6, videoEnd: 27.6 }, { matchEnd: 50, videoEnd: 50 }]);
  const q = serve.findServes(quiet, H.filter(h => h.t < 30), TUNE, AC, {});
  ok(q[1].measured === false, 'a point with no strikes is not reported as measured');
  ok(/assumed dead time/.test(q[1].note), 'and the fallback is labelled', q[1].note);
  ok(near(q[1].start, 27.6 + TUNE.dead - TUNE.lead, 0.01), 'fallback is the reel arithmetic', q[1].start);

  /* and a guess after a long break is capped by the reel's own max, not by the
     generous rail that exists to protect measured long rallies */
  const far = asAligned([{ matchEnd: 27.6, videoEnd: 27.6 }, { matchEnd: 300, videoEnd: 300 }]);
  const f = serve.findServes(far, H.filter(h => h.t < 30), TUNE, AC, {});
  ok(near(f[1].dur, TUNE.max, 0.01), 'a guessed clip is capped at the reel max, not 45s', f[1].dur);
}

/* ------------------------------------------------------------- alignment */
console.log('\nlocating a spliced recording');
{
  const BIAS = 0.8, CUT = 150, AT = 10;
  const pts = [];
  let t = 30;
  for (let i = 0; i < 20; i++) {
    pts.push({ n: i + 1, matchEnd: t, reelStart: null, reelDur: null, label: 'r' + (i + 1) });
    t += (i === AT - 1) ? 200 : 30;         // one long break, which is where the cut is
  }
  const runs = pts.map((p, i) => {
    const o = i < AT ? BIAS : BIAS + CUT;
    return rally(p.matchEnd - o - 5, p.matchEnd - o, 0.8);
  });
  /* the court next door, all through the match, on its own rhythm */
  for (let x = 12; x < 700; x += 37) runs.push(rally(x, x + 3, 0.5));

  const res = align.align(pts, runs, { endPad: BIAS });
  ok(res.matched === 20, 'all twenty points located', res.matched);
  ok(res.spread != null && res.spread < 0.2, 'residuals are tight, so the fit is trustworthy',
    res.spread == null ? 'null' : res.spread.toFixed(3));
  /* the offset absorbs the flight time, so it must NOT be reported as one */
  ok(near(res.points[0].videoEnd, pts[0].matchEnd - BIAS + BIAS, 0.3),
    'a located point ends one assumed flight after its last strike', res.points[0].videoEnd);
  ok(res.splices.length === 1, 'exactly one splice found', res.splices.length);
  ok(res.splices.length === 1 && res.splices[0].afterRally === AT,
    'at the right rally', res.splices.length && res.splices[0].afterRally);
  ok(res.splices.length === 1 && near(res.splices[0].removed, CUT, 1.0),
    'and the right amount removed', res.splices.length && res.splices[0].removed.toFixed(2));
  const worst = Math.max(...res.points.filter(p => p.aligned).map(p => Math.abs(p.residual)));
  ok(worst < 0.5, 'every located point lands within half a second', worst.toFixed(3));

  /* an unbroken recording must not have splices invented in it */
  const flat = pts.map((p, i) => ({ n: i + 1, matchEnd: p.matchEnd, label: 'r' + (i + 1) }));
  const flatRuns = flat.map(p => rally(p.matchEnd - BIAS - 5, p.matchEnd - BIAS, 0.8));
  const res2 = align.align(flat, flatRuns, {});
  ok(res2.splices.length === 0, 'no splice invented in a continuous take', res2.splices.length);

  /* a stretch nobody recorded is reported, not guessed at */
  const gappy = flatRuns.filter((r, i) => i < 12 || i > 15);
  const res3 = align.align(flat, gappy, {});
  const lost = res3.points.filter(p => !p.aligned).length;
  ok(lost === 4, 'four unheard points reported unaligned rather than located', lost);
  ok(res3.points.filter(p => !p.aligned).every(p => /no strike run/.test(p.reason || '')),
    'each with a reason');
}

/* --------------------------------------------------------- the next court */
console.log('\nis it your court?');
{
  const plan = [
    { start: 2, end: 10, type: 'rally' },
    { start: 14, end: 22, type: 'adjacent' },   // heard, but nothing on camera
    { start: 26, end: 34, type: 'rally' }
  ];
  const S = build(plan, 7);
  const roi = avROI(S.grid, S.n);
  const ser = avSeries(S.grid, S.n, roi);
  const gate = motion.makeGate({ T: S.T, ser, n: S.n }, {});
  const a = gate(3, 9), b = gate(15, 21), c = gate(27, 33);
  ok(a && a.ok, 'a real rally passes the gate', a && a.ratio.toFixed(3));
  ok(b && !b.ok, 'the next court does not', b && b.ratio.toFixed(3));
  ok(c && c.ok, 'and the second real rally passes too', c && c.ratio.toFixed(3));
  ok(a && b && a.ratio > b.ratio * 3, 'with plenty of margin between them',
    a && b && (a.ratio / Math.max(b.ratio, 1e-6)).toFixed(1));
  ok(gate(500, 520) === null, 'unscanned footage gets no opinion, rather than a wrong one');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
