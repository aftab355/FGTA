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
  return {
    ok: true,
    version: (/ffmpeg version (\S+)/.exec(v.out) || [, '?'])[1],
    hwaccels: hw.split('\n').map(s => s.trim()).filter(s => s && !/:$/.test(s)),
    encoders,
    cores: os.cpus().length
  };
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

/* A fast sparse look at the whole file. `-skip_frame nokey` decodes only
   keyframes, which on ordinary footage is one every couple of seconds — so
   this reads an hour and a half in seconds rather than minutes. Sparse is
   fine for the question it answers: what does the picture LOOK like, and
   where is there a graphic pasted over it. Timing questions need the dense
   pass below. */
function probeFrames(file, opt) {
  opt = opt || {};
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-loglevel', 'error', '-skip_frame', 'nokey',
      '-i', file, '-an', '-vsync', '0',
      '-vf', `scale=${PROBE_W}:${PROBE_H},format=gray`,
      '-f', 'rawvideo', 'pipe:1'];
    const p = spawn(opt.ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let total = 0, err = '';
    p.stdout.on('data', b => { chunks.push(b); total += b.length; });
    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', c => {
      if (c !== 0) return reject(new Error('ffmpeg failed probing frames:\n' + err.trim()));
      const buf = Buffer.concat(chunks, total), per = PROBE_W * PROBE_H;
      const n = Math.floor(buf.length / per);
      if (n < 4) return reject(new Error('only ' + n + ' keyframes decoded — is this a video file?'));
      const frames = [];
      for (let k = 0; k < n; k++) frames.push(buf.subarray(k * per, (k + 1) * per));
      resolve({ frames, w: PROBE_W, h: PROBE_H, n });
    });
  });
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

/* Audio, in one piece, concurrently with the video workers. */
function decodeAudio(file, sr, opt) {
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-loglevel', 'error', '-i', file,
      '-vn', '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'];
    const p = spawn(opt.ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let total = 0, err = '';
    p.stdout.on('data', b => { chunks.push(b); total += b.length; });
    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', c => {
      if (c !== 0) return reject(new Error('ffmpeg failed decoding audio:\n' + err.trim()));
      const buf = Buffer.concat(chunks, total), n = Math.floor(buf.length / 4);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = buf.readFloatLE(i * 4);
      resolve({ samples: x, sr, seconds: n / sr });
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
  capabilities, info, probeFrames, chunksOf, decodeChunk, decodeAudio, pool, mkTmp, rmTmp,
  MOT_W, MOT_H, MOT_FPS, BOARD_FPS, BOARD_W, PROBE_W, PROBE_H
};
