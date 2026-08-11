/* Everything that shells out to ffmpeg.
 *
 * The recorder writes one file per camera because that is the only thing a
 * browser can do — a MediaRecorder records one stream, and putting several
 * cameras onto a single timeline means decoding them all, laying them out and
 * encoding the result. That is re-encoding, and re-encoding needs ffmpeg. So
 * this file is the whole of that dependency, kept in one place and entirely
 * optional: if ffmpeg is missing, everything the recorder did before still
 * works and only the combine/clip features report themselves unavailable.
 *
 * Where the binary comes from, in order:
 *   1. FGTA_FFMPEG, if someone points it at their own build
 *   2. the ffmpeg-static package, which ships a real binary per platform and
 *      is what `npm install` gets you without asking anybody to install
 *      anything system-wide
 *   3. plain `ffmpeg` on PATH, for machines that already have one
 *
 * On a machine with an NVIDIA card the encoder is the GPU (h264_nvenc), which
 * is roughly an order of magnitude faster than libx264 at this quality and
 * leaves the CPU free to keep recording the match that is still going on.
 * Whether that encoder exists is asked of the binary, not assumed. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let cached = null;

function candidatePaths() {
  const out = [];
  if (process.env.FGTA_FFMPEG) out.push(process.env.FGTA_FFMPEG);
  try {
    const p = require('ffmpeg-static');
    if (p) out.push(p);
  } catch (e) {}
  out.push(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return out;
}

/* Finds a working binary and asks it what it can do. Cached — the answer
 * cannot change while the process is running, and every job needs it. */
function probe() {
  if (cached) return cached;
  for (const bin of candidatePaths()) {
    let res;
    try { res = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 15000 }); }
    catch (e) { continue; }
    if (!res || res.error || res.status !== 0) continue;
    const version = ((res.stdout || '').split('\n')[0] || '').replace(/^ffmpeg version /, '').trim();
    let encoders = '';
    try { encoders = (spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 20000 }).stdout) || ''; }
    catch (e) {}
    /* Preference order is "fastest hardware encoder this machine actually
       has". Each of these is still H.264 in an MP4 — the file is identical in
       kind, only the thing that produced it differs. */
    const hw = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']
      .find(e => new RegExp('\\b' + e + '\\b').test(encoders)) || null;
    cached = {
      ok: true,
      path: bin,
      version,
      hw,
      encoder: hw || 'libx264',
      source: bin === process.env.FGTA_FFMPEG ? 'FGTA_FFMPEG'
        : /node_modules/.test(bin) ? 'bundled (ffmpeg-static)' : 'installed on this PC',
    };
    return cached;
  }
  cached = { ok: false, path: null, version: null, hw: null, encoder: null, source: null };
  return cached;
}

/* The encoder flags that go with whichever encoder probe() picked. Quality is
 * matched by eye across them: visually clean at a size that does not fill a
 * disk, which is the same bargain the per-angle recordings already make. */
function videoEncoderArgs(f) {
  switch (f.encoder) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0'];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-global_quality', '23'];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'];
    case 'h264_videotoolbox': return ['-c:v', 'h264_videotoolbox', '-q:v', '55'];
    default: return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
  }
}

/* Runs ffmpeg and reports progress as a fraction, from the `time=` it prints
 * against the duration we expect. stderr is kept (tail only) so a failure can
 * say what ffmpeg actually complained about rather than just a status code. */
function run(args, { totalSec, onProgress, signal } = {}) {
  const f = probe();
  if (!f.ok) return Promise.reject(new Error('ffmpeg is not available'));
  return new Promise((resolve, reject) => {
    const child = spawn(f.path, ['-hide_banner', '-nostdin', '-y', ...args]);
    let tail = '';
    child.stderr.on('data', d => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (!onProgress) return;
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (!m) return;
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      onProgress(totalSec ? Math.max(0, Math.min(1, t / totalSec)) : null, t);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve({ tail });
      reject(new Error('ffmpeg exited ' + code + '\n' + tail.split('\n').slice(-8).join('\n')));
    });
    if (signal) signal.addEventListener('abort', () => { try { child.kill('SIGKILL'); } catch (e) {} });
  });
}

/* What is actually inside a file. Deliberately parsed out of `ffmpeg -i`
 * rather than ffprobe: it is one binary instead of two to install, and the
 * only facts needed here (is there a video stream, is there an audio stream,
 * how big is the picture) are printed plainly.
 *
 * Duration is read when it is there and left null when it is not, which for
 * these recordings is most of the time — a MediaRecorder writes its header
 * before it knows how long the recording will be, so the container carries no
 * duration at all. Everything downstream uses the wall-clock times in the
 * sidecars instead, which are better anyway: they say when a camera started
 * relative to the others, which is the thing being lined up. */
function inspect(file) {
  const f = probe();
  if (!f.ok) return { ok: false };
  let out = '';
  try {
    const r = spawnSync(f.path, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 30000 });
    out = (r.stderr || '') + (r.stdout || '');
  } catch (e) { return { ok: false }; }
  const vid = /Stream #\d+:\d+.*: Video: ([a-z0-9]+).*?, (\d+)x(\d+)/i.exec(out);
  const aud = /Stream #\d+:\d+.*: Audio: /i.test(out);
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out);
  return {
    ok: !!vid,
    hasVideo: !!vid,
    hasAudio: aud,
    width: vid ? +vid[2] : 0,
    height: vid ? +vid[3] : 0,
    durationSec: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : null,
  };
}

/* Momentary loudness over the whole file, one reading every 100ms.
 *
 * This is the half of highlight detection that needs nobody to be scoring:
 * people react. A rally worth watching ends in noise, and that noise is in
 * the recording whether or not anyone touched the ref panel. ebur128 is the
 * broadcast loudness meter, in every standard ffmpeg build, and it prints
 * exactly this to stderr as it goes. */
async function loudness(file, { onProgress } = {}) {
  const f = probe();
  if (!f.ok) return [];
  /* nothing to measure, and asking anyway makes ffmpeg fail rather than say so */
  if (!inspect(file).hasAudio) return [];
  return new Promise(resolve => {
    const child = spawn(f.path, ['-hide_banner', '-nostdin', '-i', file,
      '-af', 'ebur128=peak=none', '-f', 'null', '-']);
    const out = [];
    let buf = '';
    child.stderr.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const m = /t:\s*([\d.]+)\s.*M:\s*(-?[\d.]+)/.exec(line);
        if (!m) continue;
        const lu = parseFloat(m[2]);
        if (!isFinite(lu) || lu < -70) continue;          // -120.7 is ebur128 for "silence"
        out.push({ t: parseFloat(m[1]), m: lu });
        if (onProgress) onProgress(null, parseFloat(m[1]));
      }
    });
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(out));
  });
}

/* A still from a recording, as a base64 JPEG small enough to send to a vision
 * model without paying for pixels nobody looks at. */
async function still(file, atSec, { width = 512 } = {}) {
  const f = probe();
  if (!f.ok) return null;
  const tmp = path.join(require('os').tmpdir(), `fgta-still-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await run(['-ss', String(Math.max(0, atSec)), '-i', file, '-frames:v', '1',
      '-vf', `scale=${width}:-2`, '-q:v', '5', tmp]);
    const b = fs.readFileSync(tmp);
    return b.toString('base64');
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { probe, run, inspect, loudness, still, videoEncoderArgs };
