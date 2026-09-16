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

/* Decode the whole soundtrack to mono f32. At 16 kHz that is 64 kB a second —
   about 300 MB for a long match, which is the price of handing the detector
   the array it was written for rather than a chunked approximation of it. */
function decode(file, opt) {
  opt = opt || {};
  const ffmpeg = opt.ffmpeg || 'ffmpeg';
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-loglevel', 'error', '-i', file,
      '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let total = 0, err = '';
    p.stdout.on('data', b => { chunks.push(b); total += b.length; });
    p.stderr.on('data', b => { err += b.toString(); });
    p.on('error', e => reject(new Error('could not run ffmpeg: ' + e.message)));
    p.on('close', code => {
      if (code !== 0) return reject(new Error('ffmpeg failed decoding audio:\n' + err.trim()));
      if (!total) return reject(new Error('no audio decoded from ' + file));
      const buf = Buffer.concat(chunks, total);
      /* Buffer may not be 4-byte aligned for a Float32Array view, so copy. */
      const n = Math.floor(buf.length / 4);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = buf.readFloatLE(i * 4);
      resolve({ samples: x, sr: SR, seconds: n / SR });
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
