/* One decode, spread across the cores you have.

   v1 went over the file three times: once for the audio, once again for the
   motion tensor, and a third time to encode 154 clips one by one. Decoding
   1080p is the expensive part of all three, so the fix is to decode once and
   take everything off that pass.

   Each worker handles a slice of the file and splits its decoded frames two
   ways in a single filter graph:

     [0:v]split=2[b][m];
     [b]crop=BOARD,scale=...,format=gray   -> the scoreboard, 4 fps, a temp file
     [m]fps=10,scale=96:54,format=gray     -> the AV-CORE tensor, on stdout

   The tensor goes to stdout because it is the big one and is reduced to 144
   cells a frame the moment it arrives, so it never lands anywhere. The board
   crop is small enough to stage on disk, which keeps this to one pipe per
   process and one obvious place to look when something is wrong.

   The audio is decoded by its own process, concurrently. It could have come
   off the same pass, but chunking it would put a seam in the RMS envelope
   every few minutes, and `-vn` demuxing is cheap enough that there is nothing
   to win by trying. */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOT_W = 96, MOT_H = 54;      // AV-SCAN's working size
const MOT_FPS = 10;                // AV_STEP = 0.10
const BOARD_FPS = 4;               // SBX_FPS — "plenty for a clock and a scoreboard"
const BOARD_W = 128;               // enough for a digit change, small enough to stage
const PROBE_W = 240, PROBE_H = 135;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { ok: !r.error && r.status === 0, out: (r.stdout || '') + (r.stderr || ''), error: r.error };
}

/* What this machine can actually do, asked rather than assumed. */
function capabilities(opt) {
  opt = opt || {};
  const ffmpeg = opt.ffmpeg || 'ffmpeg';
  const v = run(ffmpeg, ['-hide_banner', '-version']);
  if (!v.ok) return { ok: false, reason: 'ffmpeg not found on PATH (looked for "' + ffmpeg + '")' };
  const hw = run(ffmpeg, ['-hide_banner', '-hwaccels']).out;
  const enc = run(ffmpeg, ['-hide_banner', '-encoders']).out;
  const has = s => enc.indexOf(s) >= 0;
  /* Ordered by how much they usually help, not alphabetically. */
  const encoders = ['h264_nvenc', 'h264_videotoolbox', 'h264_qsv', 'h264_amf', 'h264_vaapi']
    .filter(has);
  const version = (/ffmpeg version (\S+)/.exec(v.out) || [, '?'])[1];
  return {
    ok: true,
    version,
    major: majorOf(version),
    hwaccels: hw.split('\n').map(s => s.trim()).filter(s => s && !/:$/.test(s)),
    encoders,
    cores: os.cpus().length
  };
}

/* ffmpeg's own version, when it is a release. A git build ("N-109321-g...")
   has no major number to read, and is by definition recent. */
function majorOf(version) {
  const m = /^(\d+)/.exec(String(version || ''));
  return m ? +m[1] : null;
}

/* Emit exactly the frames that were decoded, without padding the gaps.

   This matters more than it looks. The probe decodes only keyframes, so its
   frames are seconds apart; left to pad to a constant rate, ffmpeg repeats
   each one until the next — at 59.94 fps with a two-second GOP that is about
   120 copies of every frame, which is both ruinous for memory and quietly
   wrong, because the busy-fraction the board detector measures is computed
   across consecutive frames and duplicates read as "nothing moved".

   The flag for it changed name. `-vsync` was deprecated in ffmpeg 5 when
   `-fps_mode` replaced it, and REMOVED in ffmpeg 9 — where passing it is a
   hard error, not a warning. So pick by version, and assume a build too new
   to parse is new enough for the new spelling. */
function passthroughArgs(caps) {
  const maj = caps ? caps.major : undefined;
  return (maj == null || maj >= 5) ? ['-fps_mode', 'passthrough'] : ['-vsync', '0'];
}

function info(file, opt) {
  opt = opt || {};
  const r = run(opt.ffprobe || 'ffprobe', ['-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames:format=duration',
    '-of', 'default=nw=1', file]);
  if (!r.ok) throw new Error('ffprobe failed on ' + file + (r.error ? ': ' + r.error.message : ''));
  const grab = k => { const m = new RegExp('^' + k + '=(.+)$', 'm').exec(r.out); return m ? m[1].trim() : null; };
  const fr = grab('avg_frame_rate') || '0/1';
  const [a, b] = fr.split('/').map(Number);
  return {
    width: +grab('width') || 0,
    height: +grab('height') || 0,
    fps: b ? a / b : 0,
    duration: parseFloat(grab('duration')) || 0
  };
}

/* A look at the picture, without reading the whole file to get it.

   The first version asked for `-skip_frame nokey` over the entire recording,
   on the theory that keyframes are sparse. They are not necessarily: an
   editor's export can use a short GOP or be all-intra, and then this decodes
   every frame of an eight-gigabyte file and holds all of them — gigabytes of
   240x135 frames to answer a question that needs a few hundred.

   Sparse SEEKING is the obvious fix and it is wrong, because of what the
   detector measures. It finds the scoreboard by how OFTEN each pixel changes:
   a plate updates in a few percent of frames, a player moves in most of them.
   Sample twenty seconds apart and the scoreline differs between most
   consecutive pairs too — it stops looking bursty and disqualifies itself.

   So: a handful of short windows, spread across the match, each sampled
   densely enough to keep that statistic meaningful. Eight windows of 45s at
   one frame every 2s is ~7% of the file decoded, a couple of hundred frames
   held, and the same answer. */
const PROBE_WINDOWS = 8;
const PROBE_SPAN = 45;      // seconds decoded at each
const PROBE_STEP = 2;       // one frame every this many seconds

function probeStarts(duration, n, span) {
  const edge = Math.min(duration * 0.03, 60);
  const last = Math.max(0, duration - span - edge);
  const lo = Math.min(edge, last);
  if (n < 2 || last <= lo) return [lo];
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + (last - lo) * i / (n - 1));
  return out;
}

function grabProbeWindow(file, start, span, opt) {
  return new Promise((resolve, reject) => {
    /* The fps filter fixes the output rate, so no -fps_mode is needed or
       wanted here — unlike the keyframe route this replaced. */
    const args = ['-nostdin', '-loglevel', 'error',
      '-ss', start.toFixed(3), '-accurate_seek', '-i', file, '-t', span.toFixed(3),
      '-an', '-vf', `fps=1/${PROBE_STEP},scale=${PROBE_W}:${PROBE_H},format=gray`,
      '-f', 'rawvideo', 'pipe:1'];
    const p = spawn(opt.ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let total = 0, err = '';
    p.stdout.on('data', b => { chunks.push(b); total += b.length; });
    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', c => {
      if (c !== 0) return reject(new Error('ffmpeg failed probing frames:\n' + err.trim()));
      const buf = Buffer.concat(chunks, total), per = PROBE_W * PROBE_H;
      const n = Math.floor(buf.length / per), out = [];
      for (let k = 0; k < n; k++) out.push(buf.subarray(k * per, (k + 1) * per));
      resolve(out);
    });
  });
}

async function probeFrames(file, opt) {
  opt = opt || {};
  const duration = opt.duration || 0;
  const span = Math.max(4, Math.min(opt.probeSpan || PROBE_SPAN, duration || PROBE_SPAN));
  const starts = duration ? probeStarts(duration, opt.probeWindows || PROBE_WINDOWS, span) : [0];
  const got = await pool(starts, Math.max(1, opt.jobs || 4),
    (t, i) => grabProbeWindow(file, t, span, opt).then(f => {
      if (opt.onProbe) opt.onProbe(i + 1, starts.length);
      return f;
    }));
  const frames = [].concat.apply([], got);
  if (frames.length < 8) {
    throw new Error('only ' + frames.length + ' frames could be read from ' + file +
      ' — is it a video this ffmpeg can decode?');
  }
  return { frames, w: PROBE_W, h: PROBE_H, n: frames.length, windows: starts.length, span };
}

function chunksOf(duration, n, overlap) {
  const ov = overlap == null ? 0 : overlap;
  const span = duration / n, out = [];
  for (let i = 0; i < n; i++) {
    const start = i * span;
    out.push({ i, start: Math.max(0, start - (i ? ov : 0)), end: Math.min(duration, start + span), trimTo: start });
  }
  return out;
}

/* One worker: one decode, motion on stdout, board crop staged on disk.
   `onGrid` is handed each motion frame as it arrives so nothing accumulates. */
function decodeChunk(file, chunk, board, opt, onGrid) {
  const ffmpeg = opt.ffmpeg || 'ffmpeg';
  const boardFile = path.join(opt.tmp, 'board-' + String(chunk.i).padStart(3, '0') + '.raw');
  const filters = [];
  const outs = [];
  if (board) {
    const bw = Math.min(BOARD_W, board.w);
    const bh = Math.max(2, Math.round(board.h * bw / board.w / 2) * 2);
    filters.push('[0:v]split=2[b][m]');
    filters.push(`[b]crop=${board.w}:${board.h}:${board.x}:${board.y},fps=${BOARD_FPS},` +
                 `scale=${bw}:${bh},format=gray[bo]`);
    filters.push(`[m]fps=${MOT_FPS},scale=${MOT_W}:${MOT_H},format=gray[mo]`);
    outs.push('-map', '[bo]', '-f', 'rawvideo', boardFile);
    outs.push('-map', '[mo]', '-f', 'rawvideo', 'pipe:1');
    board.outW = bw; board.outH = bh;
  } else {
    filters.push(`[0:v]fps=${MOT_FPS},scale=${MOT_W}:${MOT_H},format=gray[mo]`);
    outs.push('-map', '[mo]', '-f', 'rawvideo', 'pipe:1');
  }

  const pre = ['-nostdin', '-loglevel', 'error'];
  if (opt.hwaccel) pre.push('-hwaccel', opt.hwaccel);
  /* Every timestamp downstream is computed as `chunk.start + k/fps`, so the
     first frame out really does have to be the one at chunk.start. Input -ss
     has been an accurate seek (keyframe, then decode and discard to the exact
     point) for many years, but it is the assumption this whole pass rests on,
     so say it rather than inherit it. */
  const args = pre.concat(
    ['-ss', chunk.start.toFixed(3), '-accurate_seek', '-i', file, '-t', (chunk.end - chunk.start + 0.05).toFixed(3),
     '-an', '-threads', String(opt.threads || 2), '-filter_complex', filters.join(';')],
    outs, ['-y']);

  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const per = MOT_W * MOT_H;
    let carry = Buffer.alloc(0), k = 0, err = '';
    p.stdout.on('data', b => {
      let buf = carry.length ? Buffer.concat([carry, b]) : b;
      let off = 0;
      while (buf.length - off >= per) {
        onGrid(buf.subarray(off, off + per), chunk.start + k * (1 / MOT_FPS), chunk);
        off += per; k++;
      }
      carry = off ? buf.subarray(off) : buf;
    });
    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', c => {
      if (c !== 0) return reject(new Error('ffmpeg failed on chunk ' + chunk.i + ':\n' + err.trim()));
      resolve({ frames: k, boardFile: board ? boardFile : null, chunk });
    });
  });
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'rally-trim-')); }
function rmTmp(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

module.exports = {
  capabilities, info, probeFrames, chunksOf, decodeChunk, pool, mkTmp, rmTmp,
  majorOf, passthroughArgs, probeStarts,
  MOT_W, MOT_H, MOT_FPS, BOARD_FPS, BOARD_W, PROBE_W, PROBE_H
};
