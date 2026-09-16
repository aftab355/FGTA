/* Strikes, from the file on disk.

   The detector itself is not reimplemented here. It is the AC-CORE region of
   index.html, pulled out by test/extract.js the same way test/floor.test.js
   drives it, so this tool cannot drift from what the app ships:

     acEnvelope -> acOnsetStrength -> acPickOnsets -> acCluster

   All ffmpeg does is hand it mono float samples. docs/auto-cut.md already
   recommends exactly this decode for the browser route:

     ffmpeg -i match.mov -vn -ac 1 -ar 16000 ...

   so the timings come out on the same clock as the video either way. */
'use strict';
const { spawn } = require('child_process');
const { loadAudio } = require('../../test/extract.js');

const AC = loadAudio();
const SR = 16000;             // AC_SR in index.html; the detector wants no more
const HOP_MS = 10;            // AC_HOP_MS

/* Mirrors AC_DEF (index.html). Kept here rather than imported because AC_DEF
   sits outside the AC-CORE sentinels, so extract.js cannot reach it — the
   same duplication test/floor.test.js has. If AC_DEF changes, change this. */
const AC_DEF = {
  sens: 1.2, maxGap: 2.5, minHits: 2, lead: 1.5, tail: 1.5, min: 2,
  minGapMs: 120, winMs: 1500, floorFrac: 0.30, envFrac: 0.18,
  hardFrac: 0.45, aceFrac: 0.72, noiseSig: 4, minRate: 6
};

function ffprobeDuration(file, ffprobe) {
  const r = require('child_process').spawnSync(ffprobe || 'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' });
  if (r.error) throw new Error('could not run ffprobe: ' + r.error.message);
  const d = parseFloat((r.stdout || '').trim());
  return isFinite(d) ? d : null;
}

/* Decode the whole soundtrack to mono f32, holding exactly one copy of it.

   At 16 kHz that is 64 kB a second — 230 MB per hour of recording. The first
   version of this collected the stream as Buffer chunks, concatenated them,
   and then copied that into a Float32Array, so the peak was THREE times the
   track: fine for the 90-minute match it was written against, and about 2.8 GB
   for a four-hour one, which does not survive.

   So the samples go straight into their final array as they arrive. `duration`
   (from ffprobe) sizes it up front; without one it starts small and doubles,
   which is the only case that ever copies. The 0-3 bytes left at the end of a
   chunk when it does not divide by four are carried into the next one — a
   float split across two reads is the bug this would otherwise have. */
const EMPTY = Buffer.alloc(0);

function decode(file, opt) {
  opt = opt || {};
  const ffmpeg = opt.ffmpeg || 'ffmpeg';
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-loglevel', 'error', '-i', file,
      '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let cap = Math.max(SR, Math.ceil((opt.duration || 240) * SR) + SR);
    let x = new Float32Array(cap);
    let n = 0, err = '', carry = EMPTY;

    p.stdout.on('data', b => {
      const buf = carry.length ? Buffer.concat([carry, b]) : b;
      const whole = buf.length >>> 2;
      if (whole) {
        if (n + whole > cap) {
          cap = Math.max(cap * 2, n + whole);
          const next = new Float32Array(cap);
          next.set(x.subarray(0, n));
          x = next;
        }
        /* A 4-byte-aligned chunk can be read as a typed array and copied in
           one go; otherwise fall back to reading it float by float. */
        if ((buf.byteOffset & 3) === 0) {
          x.set(new Float32Array(buf.buffer, buf.byteOffset, whole), n);
          n += whole;
        } else {
          for (let i = 0; i < whole; i++) x[n++] = buf.readFloatLE(i << 2);
        }
      }
      const rem = buf.length & 3;
      carry = rem ? Buffer.from(buf.subarray(buf.length - rem)) : EMPTY;
    });

    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', code => {
      if (code !== 0) return reject(new Error('ffmpeg failed decoding audio:\n' + err.trim()));
      if (!n) return reject(new Error('no audio decoded from ' + file +
        ' — does it have a soundtrack?'));
      /* A view, not a copy: the detector only reads length and indices. */
      resolve({ samples: n === cap ? x : x.subarray(0, n), sr: SR, seconds: n / SR });
    });
  });
}

/* Everything the rest of the tool needs to know about the soundtrack.
   `acTune` overrides the detector's own settings (AC_DEF), not the reel's
   cut timing — the two are different things and both are called tuning. */
function analyse(samples, sr, acTune) {
  const opt = Object.assign({}, AC_DEF, acTune || {});
  const env = AC.acEnvelope(samples, sr);
  const o = AC.acOnsetStrength(env);
  const hits = AC.acPickOnsets(o, env, opt, HOP_MS, null);   // null map: no browser clock
  const runs = AC.acCluster(hits, opt);
  const seconds = env.length * HOP_MS / 1000;
  return {
    hits, runs, seconds, opt,
    split: hits.split || null,
    perMin: seconds > 0 ? hits.length / (seconds / 60) : 0
  };
}

async function strikesFrom(file, opt) {
  const dec = await decode(file, opt);
  const a = analyse(dec.samples, dec.sr, opt && opt.acTune);
  a.seconds = dec.seconds;
  return a;
}

module.exports = { decode, analyse, strikesFrom, ffprobeDuration, AC_DEF, SR, HOP_MS };
