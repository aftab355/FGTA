/* Was anything moving on YOUR court while those strikes were heard?

   Needed because the court next door is in use. docs/auto-cut.md is blunt
   about this: an adjacent court sounds exactly like yours, there is no
   audio-only fix, and the fix that does work is the picture — a rally on the
   next court is, from your camera, a still frame with a soundtrack.

   The reasoning here is not reimplemented. `avROI` (which court is the court),
   `avSeries` (the motion series) and `avApply` (the verdict) are pulled out of
   index.html by test/extract.js, exactly as test/vision-core.test.js drives
   them, and test/tensors.js already has an `'adjacent'` scenario built for
   this case.

   What IS reimplemented, because it has to be, is the scan: turning a file
   into the tensor those functions read. AV-SCAN is browser-only by
   construction — <video>, canvas, requestVideoFrameCallback — so ffmpeg takes
   its place. The tensor contract is fixed by test/tensors.js:

     grid   Float64Array(n * AV_CELLS), the AV_GX x AV_GY grid per frame
     T      Float64Array(n), media time of each frame
     dt     {shift}, camera shake per frame

   and the per-cell value follows `avCell`: mean absolute frame difference over
   the cell, with differences under AV_PIX discarded as sensor noise. If
   avCell changes, this has to change with it.

   Camera shake is NOT compensated. AV-SCAN searches +/-AV_MAXSHIFT pixels for
   it; this assumes a camera that is not moving, and reports shift as zero. On
   handheld footage the gate will be noisy and should be turned off. */
'use strict';
const { spawn } = require('child_process');
const { loadCore } = require('../../test/extract.js');

const AV = loadCore();
const AV_W = 96, AV_H = 54;      // AV-SCAN working size
const AV_PIX = 8;                // per-pixel difference below this is sensor noise
const AV_STEP = 0.10;            // sample every 100ms
const AV_PAD = 2.0;              // seconds either side of a candidate
const FPS = 1 / AV_STEP;

const DEF = {
  courtFrac: 0.15,   // of the way from the quietest to the 90th percentile
  pad: AV_PAD
};

function mergeWindows(wins, pad, duration) {
  const s = wins.map(w => ({ start: Math.max(0, w.start - pad), end: w.end + pad }))
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of s) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end });
  }
  if (duration) for (const w of out) w.end = Math.min(w.end, duration);
  return out.filter(w => w.end - w.start > 0.5);
}

/* One window of frames, greyscale, at the working size. */
function grabWindow(file, win, ffmpeg) {
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-loglevel', 'error',
      '-ss', win.start.toFixed(3), '-i', file, '-t', (win.end - win.start).toFixed(3),
      '-an', '-vf', `fps=${FPS},scale=${AV_W}:${AV_H},format=gray`,
      '-f', 'rawvideo', '-'];
    const p = spawn(ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let total = 0, err = '';
    p.stdout.on('data', b => { chunks.push(b); total += b.length; });
    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', code => {
      if (code !== 0) return reject(new Error('ffmpeg failed reading video:\n' + err.trim()));
      resolve(Buffer.concat(chunks, total));
    });
  });
}

/* Follows avCell with dx=dy=0 and scale=1 (frames arrive exactly AV_STEP
   apart, because fps= resamples them that way). */
function cellRow(prev, cur, grid, base) {
  const cw = AV_W / AV.AV_GX, ch = AV_H / AV.AV_GY, per = cw * ch;
  for (let c = 0; c < AV.AV_CELLS; c++) grid[base + c] = 0;
  for (let y = 0; y < AV_H; y++) {
    const cellRowIdx = ((y / ch) | 0) * AV.AV_GX, o = y * AV_W;
    for (let x = 0; x < AV_W; x++) {
      const d = cur[o + x] - prev[o + x], a = d < 0 ? -d : d;
      if (a < AV_PIX) continue;
      grid[base + cellRowIdx + ((x / cw) | 0)] += a;
    }
  }
  for (let c = 0; c < AV.AV_CELLS; c++) grid[base + c] = grid[base + c] / per;
}

async function scan(file, windows, opt) {
  opt = Object.assign({}, DEF, opt || {});
  const wins = mergeWindows(windows, opt.pad, opt.duration);
  if (!wins.length) return null;
  const frameBytes = AV_W * AV_H;
  const rows = [], times = [];

  for (const w of wins) {
    const buf = await grabWindow(file, w, opt.ffmpeg);
    const count = Math.floor(buf.length / frameBytes);
    if (count < 2) continue;
    for (let k = 1; k < count; k++) {
      rows.push([buf.subarray((k - 1) * frameBytes, k * frameBytes),
                 buf.subarray(k * frameBytes, (k + 1) * frameBytes)]);
      times.push(w.start + k * AV_STEP);
    }
    if (opt.onProgress) opt.onProgress(w, wins.length);
  }
  const n = rows.length;
  if (n < 8) return null;

  const grid = new Float64Array(n * AV.AV_CELLS);
  const T = new Float64Array(n), shift = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    cellRow(rows[k][0], rows[k][1], grid, k * AV.AV_CELLS);
    T[k] = times[k];
  }
  rows.length = 0;

  const roi = AV.avROI(grid, n);
  const ser = AV.avSeries(grid, n, roi);
  return { grid, n, T, dt: { shift }, roi, ser, windows: wins };
}

/* The gate serve.js calls. Scaled so 0 is the quietest the court ever gets and
   1 is its 90th percentile, which is what a rally looks like. */
function makeGate(s, opt) {
  if (!s) return null;
  opt = Object.assign({}, DEF, opt || {});
  const { T, ser, n } = s;
  const span = Math.max(1e-9, ser.ref - ser.floor);
  return function gate(t0, t1) {
    let sum = 0, cnt = 0;
    for (let k = 0; k < n; k++) {
      if (T[k] < t0) continue;
      if (T[k] > t1) break;
      sum += ser.m[k]; cnt++;
    }
    if (!cnt) return null;                       // not scanned: no opinion
    const ratio = (sum / cnt - ser.floor) / span;
    return { ratio, ok: ratio >= opt.courtFrac, samples: cnt };
  };
}

/* The shipped per-clip verdict, for the report. Inconclusive on a distant or
   locked-off camera, and says so rather than pre-dropping. */
function verdicts(s, segs, strikes) {
  if (!s) return null;
  try {
    return AV.avApply(segs.map(x => ({ n: x.n, start: x.start, end: x.end })),
      s.T, s.dt, s.ser, strikes);
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { scan, makeGate, verdicts, mergeWindows, cellRow, DEF, AV_W, AV_H, AV_STEP };
