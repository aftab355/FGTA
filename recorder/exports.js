/* Everything made FROM a recording rather than during one: the combined
 * single-file version of a match, and the highlight clips cut out of it.
 *
 * These are deliberately kept apart from the recordings themselves. A derived
 * file dropped next to the originals would be picked up as another camera
 * angle by the session grouping (which reads the code out of the filename),
 * so the multi-angle player would offer you a montage of the match as one of
 * the cameras filming it. Exports live in their own folder, are listed
 * separately, and carry a sidecar saying which session and which moment they
 * came from. */
const fs = require('fs');
const path = require('path');
const ff = require('./ffmpeg');

/* ---------- job registry ----------
   Combining a two-hour match takes minutes even on a GPU. The dashboard needs
   to show that it is happening, so every long job is a small object the
   status endpoint can report, and only one runs at a time — this machine is
   very likely still recording a live match, and that job matters more. */
const jobs = [];
let running = null;

function newJob(kind, label) {
  const job = { id: Math.random().toString(36).slice(2, 9), kind, label,
    status: 'queued', pct: 0, message: '', startedAt: Date.now(), endedAt: null, output: null };
  jobs.unshift(job);
  while (jobs.length > 12) jobs.pop();
  return job;
}
function listJobs() {
  return jobs.map(j => ({ ...j }));
}
function busy() { return !!running; }

async function withJob(job, fn) {
  if (running) throw new Error('another export is already running');
  running = job;
  job.status = 'running';
  try {
    const out = await fn(job);
    job.status = 'done';
    job.pct = 1;
    job.output = out || null;
    job.message = out ? ('saved ' + (out.name || out)) : 'done';
    return out;
  } catch (e) {
    job.status = 'failed';
    job.message = (e && e.message) || String(e);
    throw e;
  } finally {
    job.endedAt = Date.now();
    running = null;
  }
}

/* ---------- layout ----------
   Cells are sized so nothing is wasted: two 16:9 cameras side by side make a
   1920x540 file, not a 1080p frame that is half black. Everything past four
   goes to a smaller cell rather than a bigger file. */
function gridFor(n) {
  if (n <= 1) return { cols: 1, rows: 1, cw: 1280, ch: 720 };
  if (n === 2) return { cols: 2, rows: 1, cw: 960, ch: 540 };
  if (n <= 4) return { cols: 2, rows: 2, cw: 960, ch: 540 };
  const cols = 3;
  return { cols, rows: Math.ceil(n / cols), cw: 640, ch: 360 };
}

function stamp(t) {
  return new Date(t).toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
function safeLabel(s) {
  return String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'clip';
}

function writeSidecar(file, meta) {
  try { fs.writeFileSync(file + '.json', JSON.stringify(meta, null, 1)); } catch (e) {}
}

function listExports(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(mp4|webm)$/i.test(f))
    .map(f => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(full + '.json', 'utf8')); } catch (e) {}
      return { name: f, bytes: st.size, mtime: st.mtimeMs, kind: meta.kind || 'export',
        code: meta.code || '', label: meta.label || '', sessionStartedAt: meta.sessionStartedAt || null,
        caption: meta.caption || '', reason: meta.reason || '', judged: !!meta.judged };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function findCombined(dir, session) {
  return listExports(dir).find(e => e.kind === 'combined' && e.sessionStartedAt === session.startedAt) || null;
}

/* ---------- one match, one file ----------
   Every camera on the same timeline, laid out side by side, with all of their
   microphones mixed together — the thing you can hand to somebody who was not
   there, or scrub through in any editor, instead of a folder of files that
   each start at a different moment.

   Lining them up is the whole job, and it is done with the wall-clock start
   times the recorder already writes beside every file: a camera that joined
   90 seconds late gets 90 seconds of black in front of it, so a given instant
   in the output is the same instant in every cell. */
async function combineSession(session, { dir, exportsDir, onProgress }) {
  const f = ff.probe();
  if (!f.ok) throw new Error('ffmpeg is not available — see the README');
  const angles = session.angles.slice().sort((a, b) => a.offsetMs - b.offsetMs);
  if (!angles.length) throw new Error('this session has no recordings');

  const info = angles.map(a => ({ ...a, ...ff.inspect(path.join(dir, a.name)) }));
  const usable = info.filter(a => a.hasVideo);
  if (!usable.length) throw new Error('none of these files has a video stream ffmpeg can read');

  const { cols, rows, cw, ch } = gridFor(usable.length);
  const args = [];
  for (const a of usable) args.push('-fflags', '+genpts', '-i', path.join(dir, a.name));

  const parts = [];
  const vLabels = [];
  usable.forEach((a, i) => {
    const pad = Math.max(0, Math.round(a.offsetMs)) / 1000;
    /* fps first so every cell is ticking at the same rate before it is
       stacked — WebRTC recordings are wildly variable-rate and stacking two
       of those produces a picture that stutters in one half. */
    const chain = [
      'fps=30',
      `scale=${cw}:${ch}:force_original_aspect_ratio=decrease`,
      `pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1',
    ];
    if (pad > 0.05) chain.push(`tpad=start_duration=${pad.toFixed(3)}:start_mode=add:color=black`);
    parts.push(`[${i}:v]${chain.join(',')}[v${i}]`);
    vLabels.push(`[v${i}]`);
  });

  let vOut;
  if (usable.length === 1) {
    vOut = '[v0]';
  } else {
    const layout = usable.map((_, i) => `${(i % cols) * cw}_${Math.floor(i / cols) * ch}`).join('|');
    parts.push(`${vLabels.join('')}xstack=inputs=${usable.length}:layout=${layout}:fill=black[vout]`);
    vOut = '[vout]';
  }

  /* Every microphone, mixed, each delayed to its own start — the same
     principle as the live audio bed: cameras cut, sound does not, and the
     call that was made off camera is usually the one worth hearing. */
  const withAudio = usable.map((a, i) => ({ a, i })).filter(x => x.a.hasAudio);
  let aOut = null;
  if (withAudio.length) {
    withAudio.forEach(({ a, i }) => {
      const delay = Math.max(0, Math.round(a.offsetMs));
      parts.push(`[${i}:a]aresample=async=1${delay > 50 ? `,adelay=${delay}:all=1` : ''}[a${i}]`);
    });
    if (withAudio.length === 1) aOut = `[a${withAudio[0].i}]`;
    else {
      const ins = withAudio.map(x => `[a${x.i}]`).join('');
      parts.push(`${ins}amix=inputs=${withAudio.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.9[aout]`);
      aOut = '[aout]';
    }
  }

  const name = `${session.code}__combined__${stamp(session.startedAt)}.mp4`;
  const out = path.join(exportsDir, name);
  fs.mkdirSync(exportsDir, { recursive: true });

  const cmd = [...args, '-filter_complex', parts.join(';'), '-map', vOut];
  if (aOut) cmd.push('-map', aOut, '-c:a', 'aac', '-b:a', '160k');
  else cmd.push('-an');
  cmd.push(...ff.videoEncoderArgs(f), '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out);

  try {
    await ff.run(cmd, { totalSec: session.durationMs / 1000, onProgress });
  } catch (e) {
    /* a half-written file with no sidecar would sit in the exports list
       looking like a finished export of the match */
    try { fs.unlinkSync(out); } catch (err) {}
    throw e;
  }

  writeSidecar(out, { kind: 'combined', code: session.code, sessionStartedAt: session.startedAt,
    label: `${usable.length} angle${usable.length === 1 ? '' : 's'}`,
    angles: usable.map(a => ({ name: a.name, label: a.label, offsetMs: a.offsetMs })),
    encoder: f.encoder, createdAt: Date.now() });
  const st = fs.statSync(out);
  return { name, bytes: st.size, angles: usable.length, encoder: f.encoder };
}

/* ---------- picking the moments ----------
   Two independent signals, because each one is blind on its own:
   - the score, mirrored from the host while the match was recorded, which
     knows a set point from an ordinary rally but nothing about the rally
   - the sound, which knows nothing about the score but is how people react
     to something worth watching, and works even when nobody is scoring
   Whatever survives both of those is then shown to the model, which is the
   only one of the three that can see the tennis. */
const SCORE_WEIGHTS = {
  match: 1.0, set: 0.9, game: 0.55, ace: 0.75, streak: 0.5, tension: 0.7,
};

function scoreCandidates(events, base) {
  const out = [];
  for (const e of events || []) {
    const w = SCORE_WEIGHTS[e.kind];
    if (!w) continue;
    const t = (e.t - base) / 1000;
    if (t < 3) continue;                       // no room to cut in front of it
    out.push({ t, weight: w, reason: e.label || e.kind, source: 'score' });
  }
  return out;
}

/* A peak is loud relative to how loud this recording usually is, not against
   a fixed number — one court is next to a road, another is a back garden. */
function loudCandidates(readings, { minGapSec = 10 } = {}) {
  if (readings.length < 40) return [];
  const levels = readings.map(r => r.m).sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)];
  const p95 = levels[Math.floor(levels.length * 0.95)];
  const threshold = Math.max(median + 6, p95 - 1);
  const out = [];
  let last = -Infinity;
  for (const r of readings) {
    if (r.m < threshold || r.t - last < minGapSec || r.t < 5) continue;
    last = r.t;
    out.push({ t: r.t, weight: Math.min(0.85, 0.4 + (r.m - median) / 20), reason: 'crowd noise', source: 'audio' });
  }
  return out;
}

function mergeCandidates(lists, { gapSec = 8, max = 12 } = {}) {
  const all = [].concat(...lists).sort((a, b) => b.weight - a.weight);
  const kept = [];
  for (const c of all) {
    if (kept.some(k => Math.abs(k.t - c.t) < gapSec)) {
      /* the same moment found twice, by two different signals, is a stronger
         moment — not a duplicate to throw away */
      const near = kept.find(k => Math.abs(k.t - c.t) < gapSec);
      if (near.source !== c.source) {
        near.weight = Math.min(1, near.weight + 0.2);
        near.reason = near.reason + ' + ' + c.reason;
      }
      continue;
    }
    kept.push({ ...c });
    if (kept.length >= max) break;
  }
  return kept.sort((a, b) => a.t - b.t);
}

/* The same judge the live stream uses for auto-replays — the Netlify function
 * in this repo, running Claude against a handful of stills. Asking it from
 * here rather than shipping an API key with the recorder means there is
 * exactly one place that talks to a model, and the recorder needs no secrets
 * at all.
 *
 * Fails open, deliberately and in the same direction the live path does: if
 * the endpoint is unreachable (offline PC, site not deployed yet), the
 * heuristic's own verdict stands and the clip is cut anyway, marked unjudged.
 * A highlight reel that includes a few ordinary points is worth more than no
 * highlight reel. */
async function judge(file, cand, { endpoint, context }) {
  const offsets = [-2.5, -0.5, 1.0];
  const frames = [];
  for (const o of offsets) {
    const b64 = await ff.still(file, Math.max(0, cand.t + o));
    if (b64) frames.push(b64);
  }
  if (!frames.length) return { isHighlight: cand.weight >= 0.7, label: cand.reason, judged: false };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames, context: context || cand.reason }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j && j.error) throw new Error(j.error);
    return { isHighlight: !!j.isHighlight, label: (j.label || cand.reason), confidence: j.confidence || 0, judged: true };
  } catch (e) {
    return { isHighlight: cand.weight >= 0.7, label: cand.reason, judged: false, error: (e && e.message) || String(e) };
  }
}

const CLIP_PRE = 6, CLIP_POST = 3;

/* Cuts each approved moment out of the combined file (or the one angle, if
 * combining has not been run) and, if there is more than one, joins them into
 * a reel. Re-encoded rather than stream-copied: a copy can only cut at a
 * keyframe, which on these recordings moves the start of a clip by up to a
 * couple of seconds — long enough to miss the shot it exists to show. */
async function clipSession(session, { dir, exportsDir, events, endpoint, onProgress, onLog }) {
  const f = ff.probe();
  if (!f.ok) throw new Error('ffmpeg is not available — see the README');
  fs.mkdirSync(exportsDir, { recursive: true });
  const log = onLog || (() => {});

  const combined = findCombined(exportsDir, session);
  const base = combined
    ? { file: path.join(exportsDir, combined.name), startedAt: session.startedAt, label: 'the combined file' }
    : (() => {
        const a = session.angles.slice().sort((x, y) => x.offsetMs - y.offsetMs)[0];
        if (!a) throw new Error('this session has no recordings');
        return { file: path.join(dir, a.name), startedAt: session.startedAt + a.offsetMs, label: a.label };
      })();
  log(`clipping from ${base.label}`);

  const sc = scoreCandidates(events, base.startedAt);
  log(`${sc.length} moment${sc.length === 1 ? '' : 's'} from the score`);
  const readings = await ff.loudness(base.file, { onProgress: (_, t) => onProgress && onProgress(Math.min(0.35, t / Math.max(1, session.durationMs / 1000) * 0.35)) });
  const ac = loudCandidates(readings);
  log(`${ac.length} from the crowd`);
  const cands = mergeCandidates([sc, ac]);
  if (!cands.length) throw new Error('nothing stood out in this recording');

  const approved = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const verdict = await judge(base.file, c, { endpoint, context: c.reason });
    if (onProgress) onProgress(0.35 + 0.35 * ((i + 1) / cands.length));
    log(`${fmtT(c.t)} ${c.reason} → ${verdict.isHighlight ? 'keep' : 'skip'}`
      + (verdict.judged ? ` "${verdict.label}"` : ' (not judged: ' + (verdict.error || 'no answer') + ')'));
    if (verdict.isHighlight) approved.push({ ...c, ...verdict });
  }
  if (!approved.length) throw new Error('nothing in this recording was judged worth clipping');

  /* Clear out an earlier pass over the same match first. Clips are numbered,
     so a second run that finds fewer moments would otherwise leave the tail of
     the first run behind, mixed in with the new ones and indistinguishable. */
  for (const old of listExports(exportsDir)) {
    if (old.sessionStartedAt !== session.startedAt) continue;
    if (old.kind !== 'clip' && old.kind !== 'reel') continue;
    try { fs.unlinkSync(path.join(exportsDir, old.name)); } catch (e) {}
    try { fs.unlinkSync(path.join(exportsDir, old.name + '.json')); } catch (e) {}
  }

  const made = [];
  for (let i = 0; i < approved.length; i++) {
    const c = approved[i];
    const start = Math.max(0, c.t - CLIP_PRE);
    const name = `${session.code}__clip-${String(i + 1).padStart(2, '0')}-${safeLabel(c.label)}__${stamp(session.startedAt)}.mp4`;
    const out = path.join(exportsDir, name);
    await ff.run(['-ss', String(start), '-i', base.file, '-t', String(CLIP_PRE + CLIP_POST),
      ...ff.videoEncoderArgs(f), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', out]);
    writeSidecar(out, { kind: 'clip', code: session.code, sessionStartedAt: session.startedAt,
      label: c.label, caption: c.label, reason: c.reason, atSec: c.t, judged: !!c.judged,
      confidence: c.confidence || 0, createdAt: Date.now() });
    made.push({ name, path: out, label: c.label });
    if (onProgress) onProgress(0.7 + 0.25 * ((i + 1) / approved.length));
  }

  let reel = null;
  if (made.length > 1) {
    /* every clip came out of the same encoder with the same settings, so the
       concat demuxer can join them without touching a pixel */
    const listFile = path.join(exportsDir, `.reel-${Date.now()}.txt`);
    fs.writeFileSync(listFile, made.map(m => `file '${m.path.replace(/'/g, "'\\''")}'`).join('\n'));
    const name = `${session.code}__highlights__${stamp(session.startedAt)}.mp4`;
    const out = path.join(exportsDir, name);
    try {
      await ff.run(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]);
      writeSidecar(out, { kind: 'reel', code: session.code, sessionStartedAt: session.startedAt,
        label: `${made.length} moments`, clips: made.map(m => m.name), createdAt: Date.now() });
      reel = name;
    } finally {
      try { fs.unlinkSync(listFile); } catch (e) {}
    }
  }
  if (onProgress) onProgress(1);
  return { name: reel || made[0].name, clips: made.map(m => m.name), reel, judged: approved.filter(a => a.judged).length };
}

function fmtT(s) {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

module.exports = { combineSession, clipSession, listExports, findCombined, newJob, withJob, listJobs, busy, gridFor, mergeCandidates, loudCandidates, scoreCandidates };
