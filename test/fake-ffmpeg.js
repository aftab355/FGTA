#!/usr/bin/env node
/* An ffmpeg that serves a match nobody played.

   rally-trim's whole job happens between ffmpeg and ffmpeg: frames in, cut
   out. Testing the parts separately leaves the wiring untested — the filter
   graph, the chunk boundaries, the board file the workers stage on disk, the
   order the motion samples come back in — and the wiring is where the bugs
   are. A real fixture video cannot help: the bundled ffmpeg in CI has no
   audio encoder (see test/make-fixture.js), and a 90-minute 1080p file is not
   something to keep in a repository.

   So this stands in for ffmpeg. It reads the same command lines rally-trim
   builds and answers them with synthetic frames and samples from a match with
   known ground truth: known point endings, known serves, a scoreboard in a
   known box, and a court next door making a noise throughout.

   Used as:  --ffmpeg test/fake-ffmpeg.js --ffprobe test/fake-ffmpeg.js
   (it answers to both, by looking at what it was asked for).

   MATCH is the ground truth; trim-e2e.test.js asserts against it. */
'use strict';
const fs = require('fs');

const W = 1920, H = 1080;
const DUR = 600, FPS = 25;
const BOARD = { x: 64, y: 880, w: 620, h: 136 };   // sbxDrawFrame's own geometry
const SR = 16000;

/* Twenty points. Each has a serve, a rally, and an ending; the scoreboard
   updates `LAG` after the ball dies, because that is when the ref taps. */
const LAG = 1.2;
const MATCH = (() => {
  let s = 4242;
  const R = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pts = [];
  let t = 18;
  for (let i = 0; i < 30; i++) {
    const rally = 4 + R() * 7;
    /* Only points the recording actually contains. Overrunning the file was
       the first thing this fixture got wrong, and it looked exactly like the
       detector missing the last two points of the match. */
    if (t + rally + LAG > DUR - 4) break;
    pts.push({ n: pts.length + 1, serve: t, end: t + rally, board: t + rally + LAG });
    t += rally + 14 + R() * 16;                    // dead time, genuinely variable
  }
  return pts;
})();

/* The ground truth, exported so the test can assert against it. Everything
   below the main guard only runs when this file is executed AS ffmpeg. */
module.exports = { MATCH, BOARD, W, H, DUR, LAG, FPS, SR };
if (require.main !== module) return;

const argv = process.argv.slice(2);
const has = f => argv.indexOf(f) >= 0;
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

/* ---------------------------------------------------------------- probing */
if (has('-version')) { process.stdout.write('ffmpeg version 6.0-fake\n'); process.exit(0); }
if (has('-hwaccels')) { process.stdout.write('Hardware acceleration methods:\nnone\n'); process.exit(0); }
if (has('-encoders')) { process.stdout.write(' V..... libx264 H.264\n'); process.exit(0); }
if (has('-show_entries')) {
  process.stdout.write(`width=${W}\nheight=${H}\navg_frame_rate=${FPS}/1\nnb_frames=${DUR * FPS}\nduration=${DUR}\n`);
  process.exit(0);
}

const ss = parseFloat(val('-ss') || '0');
const tt = parseFloat(val('-t') || String(DUR - ss));
const end = Math.min(DUR, ss + tt);

/* ------------------------------------------------------------- the picture */
function drawFrame(buf, w, h, t) {
  const sx = w / W, sy = h / H;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf[y * w + x] = 120 + ((x * 7 + y * 3) % 17);
  /* Two players, moving only while the ball is in play. Between points one of
     them wanders, which is exactly what makes a plain "motion rose" test
     useless and why the rise test wants BOTH ends busy. */
  const pt = MATCH.find(p => t >= p.serve && t <= p.end);
  const blobs = pt
    ? [[300 + 400 * Math.abs(Math.sin(t * 2)), 300], [1200 + 300 * Math.abs(Math.cos(t * 2)), 700]]
    : [[300 + 120 * Math.abs(Math.sin(t * 0.4)), 300]];
  for (const [bx, by] of blobs) {
    const x0 = Math.round(bx * sx), y0 = Math.round(by * sy);
    for (let y = y0; y < y0 + Math.max(2, Math.round(160 * sy)); y++)
      for (let x = x0; x < x0 + Math.max(2, Math.round(70 * sx)); x++)
        if (y >= 0 && y < h && x >= 0 && x < w) buf[y * w + x] = 35;
  }
  /* The scoreboard: a dark plate whose glyphs change once per point. */
  const bx0 = Math.round(BOARD.x * sx), by0 = Math.round(BOARD.y * sy);
  const bw = Math.max(4, Math.round(BOARD.w * sx)), bh = Math.max(4, Math.round(BOARD.h * sy));
  for (let y = by0; y < by0 + bh; y++) for (let x = bx0; x < bx0 + bw; x++)
    if (y >= 0 && y < h && x >= 0 && x < w) buf[y * w + x] = 16;
  const scored = MATCH.filter(p => p.board <= t).length;
  for (let g = 0; g < 8; g++) {
    /* a crude counter: which glyphs are lit depends on how many points are in */
    if (!((scored + g) % 3)) continue;
    const gx = bx0 + Math.round((0.05 + g * 0.11) * bw), gy = by0 + Math.round(0.3 * bh);
    const gw = Math.max(2, Math.round(0.07 * bw)), gh = Math.max(2, Math.round(0.35 * bh));
    for (let y = gy; y < gy + gh; y++) for (let x = gx; x < gx + gw; x++)
      if (y >= 0 && y < h && x >= 0 && x < w) buf[y * w + x] = 245;
  }
}

function rawVideo(w, h, fps, t0, t1, sink) {
  const buf = Buffer.alloc(w * h);
  const n = Math.max(0, Math.round((t1 - t0) * fps));
  for (let k = 0; k < n; k++) { drawFrame(buf, w, h, t0 + k / fps); sink(Buffer.from(buf)); }
}

/* process.exit() discards whatever stdout has not flushed, which on a pipe
   this size is most of it — the first run of this harness delivered 2 seconds
   of a 600 second soundtrack and made the detector look broken. Write once,
   and leave only when the pipe says it is done. */
function emitAndExit(parts) {
  const all = Buffer.isBuffer(parts) ? parts : Buffer.concat(parts);
  process.stdout.write(all, () => process.exit(0));
}

/* ----------------------------------------------------------------- the mix */
function writeAudio(t0, t1, out) {
  const n = Math.round((t1 - t0) * SR);
  const buf = Buffer.alloc(n * 4);
  let s = 99;
  const R = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const strikes = [];
  for (const p of MATCH) for (let t = p.serve; t <= p.end + 1e-9; t += 0.95) strikes.push({ t, lvl: 1.0 });
  /* the court next door, on its own rhythm, all match */
  for (let t = 9; t < DUR; t += 23 + R() * 30) for (let j = 0; j < 3; j++) strikes.push({ t: t + j * 0.9, lvl: 0.34 });
  for (let i = 0; i < n; i++) buf.writeFloatLE((R() - 0.5) * 0.004, i * 4);
  for (const st of strikes) {
    if (st.t < t0 || st.t > t1) continue;
    const at = Math.round((st.t - t0) * SR);
    for (let j = 0; j < 220 && at + j < n; j++) {
      const env = Math.pow(1 - j / 220, 6);
      buf.writeFloatLE((R() * 2 - 1) * env * st.lvl, (at + j) * 4);
    }
  }
  out(buf);
}

/* ------------------------------------------------------------------ routing */
function route() {
const fc = val('-filter_complex') || '';
const vf = val('-vf') || '';

if (has('-vn')) { writeAudio(ss, end, emitAndExit); return; }

/* the probe: short windows, densely sampled, `-ss`/`-t` bounded */
const probe = /fps=1\/(\d+),scale=(\d+):(\d+)/.exec(vf);
if (probe) {
  const parts = [];
  rawVideo(+probe[2], +probe[3], 1 / +probe[1], ss, end, b => parts.push(b));
  emitAndExit(parts);
  return;
}

if (fc) {                                       // the main pass: board + motion
  /* Find the staged board file by what it IS, not by where it sits: the real
     command line grows flags (-pix_fmt landed between them once already) and
     a positional guess breaks silently when it does. */
  const bFile = argv.find(a => /\.raw$/.test(a)) || null;
  const bs = /\[b\]crop=\d+:\d+:\d+:\d+,fps=(\d+),scale=(\d+):(\d+)/.exec(fc);
  /* Matches both shapes: `[m]fps=...` when the graph splits for the board,
     and `[0:v]fps=...` when there is no board and motion is the only output.
     Anchoring on the [mo] label is what tells it from the board's [bo]. */
  const ms = /fps=(\d+),scale=(\d+):(\d+),format=gray\[mo\]/.exec(fc);
  if (bFile && bs) {
    const parts = [];
    /* the crop is applied first in the real thing; emulate by drawing the
       whole frame at the crop's scale and slicing the board out of it */
    const bw = +bs[2], bh = +bs[3], bfps = +bs[1];
    const fullW = Math.round(bw * W / BOARD.w), fullH = Math.round(bh * H / BOARD.h);
    const tmp = Buffer.alloc(fullW * fullH);
    const n = Math.max(0, Math.round((end - ss) * bfps));
    const ox = Math.round(BOARD.x * fullW / W), oy = Math.round(BOARD.y * fullH / H);
    for (let k = 0; k < n; k++) {
      drawFrame(tmp, fullW, fullH, ss + k / bfps);
      const c = Buffer.alloc(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const sy2 = Math.min(fullH - 1, oy + y), sx2 = Math.min(fullW - 1, ox + x);
        c[y * bw + x] = tmp[sy2 * fullW + sx2];
      }
      parts.push(c);
    }
    fs.writeFileSync(bFile, Buffer.concat(parts));
  }
  if (ms) {
    const parts = [];
    rawVideo(+ms[2], +ms[3], +ms[1], ss, end, b => parts.push(b));
    emitAndExit(parts);
  } else process.exit(0);
  return;
}

if (vf && /select=/.test(vf)) {                 // a render
  const out = argv[argv.length - 1];
  fs.writeFileSync(out, Buffer.from('fake mp4\n'));
  process.stderr.write('frame= 100 time=00:00:10.00\n');
  process.exit(0);
}

process.stderr.write('fake-ffmpeg: unrecognised invocation\n' + argv.join(' ') + '\n');
process.exit(1);
}
route();
