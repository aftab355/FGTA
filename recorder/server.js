/* HTTP layer: the control dashboard, the chunk sink the browser POSTs into,
   and a same-origin copy of the FGTA app.

   The app copy matters more than it looks. The recorder drives the real
   deployed page rather than reimplementing the signalling protocol, so it can
   never drift out of sync with what the phones are running — but a page on
   fgta.netlify.app cannot POST recording chunks to a server on localhost. So
   the app is fetched once at startup and served from here, which makes the
   page and this server the same origin and the upload a plain fetch. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ff = require('./ffmpeg');
const xp = require('./exports');

const RECORDINGS = path.join(__dirname, 'recordings');
/* Anything MADE from a recording goes in here rather than beside the
   originals: the session grouping below reads the match code out of a
   filename, so a combined file dropped next to its own sources would come
   back as a fourth camera angle of the match it is a summary of. */
const EXPORTS = path.join(RECORDINGS, 'exports');
fs.mkdirSync(RECORDINGS, { recursive: true });

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {}))
    for (const i of list || [])
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

/* One append stream per file, kept open for the life of the recording — a
   two-hour match is a few thousand chunks and reopening per chunk would be
   both slower and a good way to interleave writes. */
const writers = new Map();

function safeName(s, fallback) {
  const cleaned = String(s || '').replace(/[^A-Za-z0-9 _.-]/g, '').trim().replace(/\s+/g, '-');
  return cleaned || fallback;
}

function openFile(code, label, ext) {
  const startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `${safeName(code, 'match')}__${safeName(label, 'angle')}__${stamp}.${ext || 'webm'}`;
  const full = path.join(RECORDINGS, name);
  const id = name;
  /* A sidecar with the exact millisecond the recording opened. Angles start at
     different moments — a camera that joins 30s late produces a file that is
     30s "behind" — and lining them back up for synchronised playback needs
     better than the one-second resolution the filename can carry. */
  try { fs.writeFileSync(full + '.json', JSON.stringify({ name, code: String(code || ''), label: String(label || ''), startedAt })); } catch (e) {}
  writers.set(id, { stream: fs.createWriteStream(full), bytes: 0, path: full, name, started: startedAt, open: true });
  return id;
}

function writeChunk(id, buf) {
  const w = writers.get(id);
  if (!w || !w.open) return false;
  w.stream.write(buf);
  w.bytes += buf.length;
  return true;
}

function closeFile(id) {
  const w = writers.get(id);
  if (!w || !w.open) return;
  w.open = false;
  w.stream.end();
  /* A file this small is not a short recording, it is an encoder that never
     produced anything (see the watchdog in browser.js). Leaving the stub
     behind would put an unplayable entry in the match list next to the real
     one that replaced it. */
  if (w.bytes < 2000) {
    writers.delete(id);
    setTimeout(() => {
      try { fs.unlinkSync(w.path); } catch (e) {}
      try { fs.unlinkSync(w.path + '.json'); } catch (e) {}
    }, 300);
    return;
  }
  try {
    const p = w.path + '.json';
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    meta.endedAt = Date.now();
    fs.writeFileSync(p, JSON.stringify(meta));
  } catch (e) {}
}

/* Groups recordings back into matches so they can be played together.
   Recordings made before the sidecar existed still line up: the timestamp
   baked into the filename is second-accurate, which is close enough to watch
   the same rally from another camera. */
function fileMeta(name) {
  const full = path.join(RECORDINGS, name);
  const st = fs.statSync(full);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(full + '.json', 'utf8')); } catch (e) {}
  const parts = name.replace(/\.(webm|mp4)$/i, '').split('__');
  let fromName = NaN;
  if (parts[2]) {
    // 2026-08-11T17-56-20 -> 2026-08-11T17:56:20 (written in UTC by openFile)
    const iso = parts[2].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z';
    fromName = Date.parse(iso);
  }
  return {
    name,
    code: meta.code || parts[0] || 'match',
    label: meta.label || parts[1] || 'angle',
    startedAt: meta.startedAt || (isFinite(fromName) ? fromName : st.mtimeMs),
    endedAt: meta.endedAt || st.mtimeMs,
    bytes: st.size,
  };
}

const SESSION_GAP_MS = 6 * 3600 * 1000;   // the same code months apart is not the same match

function listSessions() {
  const files = fs.readdirSync(RECORDINGS)
    .filter(f => /\.(webm|mp4)$/i.test(f))
    .map(fileMeta)
    .sort((a, b) => a.startedAt - b.startedAt);

  const sessions = [];
  for (const f of files) {
    const s = sessions.find(x => x.code === f.code && f.startedAt - x.startedAt < SESSION_GAP_MS);
    if (s) { s.angles.push(f); s.endedAt = Math.max(s.endedAt, f.endedAt); }
    else sessions.push({ code: f.code, startedAt: f.startedAt, endedAt: f.endedAt, angles: [f] });
  }
  return sessions.map(s => ({
    code: s.code,
    startedAt: s.startedAt,
    durationMs: Math.max(0, s.endedAt - s.startedAt),
    bytes: s.angles.reduce((n, a) => n + a.bytes, 0),
    angles: s.angles.map(a => ({
      name: a.name,
      label: a.label,
      offsetMs: a.startedAt - s.startedAt,     // how late this camera joined
      bytes: a.bytes,
    })),
  })).sort((a, b) => b.startedAt - a.startedAt);
}

/* ---------- match log ----------
   The score, as it was mirrored to every viewer while the recording ran,
   written down with the wall-clock time it happened. It is what lets the
   clipper know a set point from a rally an hour later, and it costs one line
   of JSON per event. Kept per match code, appended to, never rewritten — a
   crash mid-match loses nothing that was already written.
   Not a video file, so it is invisible to every listing above. */
function eventsFile(code) {
  return path.join(RECORDINGS, `${safeName(code, 'match')}__events.jsonl`);
}
function appendEvent(code, ev) {
  if (!code || !ev || !ev.kind) return false;
  const line = JSON.stringify({ t: Number(ev.t) || Date.now(), kind: String(ev.kind).slice(0, 24),
    label: String(ev.label || '').slice(0, 120) });
  try { fs.appendFileSync(eventsFile(code), line + '\n'); } catch (e) { return false; }
  return true;
}
function readEvents(code, fromT, toT) {
  let raw = '';
  try { raw = fs.readFileSync(eventsFile(code), 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch (err) { continue; }
    if (fromT != null && e.t < fromT) continue;
    if (toT != null && e.t > toT) continue;
    out.push(e);
  }
  return out;
}

function activeFiles() {
  return [...writers.entries()]
    .filter(([, w]) => w.open)
    .map(([id, w]) => ({ id, name: w.name, bytes: w.bytes, seconds: Math.round((Date.now() - w.started) / 1000) }));
}

function listRecordings() {
  return fs.readdirSync(RECORDINGS)
    .filter(f => /\.(webm|mp4)$/i.test(f))
    .map(f => {
      const st = fs.statSync(path.join(RECORDINGS, f));
      return { name: f, bytes: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function findSession(code, startedAt) {
  const want = Number(startedAt);
  return listSessions().find(s => s.code === code && (!want || s.startedAt === want)) || null;
}

/* Serves a video out of one of the two folders, with range support — which is
   what makes seeking work at all. Without it the browser can only play a file
   straight through from the start, which would leave the multi-angle player
   unable to scrub or to line a late-joining camera up to the right moment. */
function serveVideo(req, res, send, root, rawName) {
  const name = path.basename(rawName);
  const full = path.join(root, name);
  if (!full.startsWith(root) || !fs.existsSync(full)) return send(404, { error: 'not found' });
  const st = fs.statSync(full);
  const type = name.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Accept-Ranges': 'bytes',
    });
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Content-Disposition': `inline; filename="${name}"`,
    'Accept-Ranges': 'bytes',
  });
  return fs.createReadStream(full).pipe(res);
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('chunk too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function start({ port, appHtml, control }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };

    try {
      /* the FGTA app itself, served from this origin — see the note at the top */
      if (url.pathname === '/app') return send(200, appHtml(), 'text/html; charset=utf-8');

      if (url.pathname === '/api/chunk' && req.method === 'POST') {
        const id = url.searchParams.get('f');
        const buf = await readBody(req);
        const ok = writeChunk(id, buf);
        return send(ok ? 200 : 410, { ok });
      }

      if (url.pathname === '/api/status') {
        return send(200, {
          ...control.status(),
          files: activeFiles(),
          disk: diskFree(),
          jobs: xp.listJobs(),
          ffmpeg: ff.probe(),
        });
      }

      if (url.pathname === '/api/watch' && req.method === 'POST') {
        const { code } = JSON.parse((await readBody(req)).toString() || '{}');
        if (!code) return send(400, { error: 'no code' });
        await control.watch(String(code).trim().toUpperCase());
        return send(200, { ok: true });
      }

      if (url.pathname === '/api/stop' && req.method === 'POST') {
        await control.stop();
        return send(200, { ok: true });
      }

      if (url.pathname === '/api/auto' && req.method === 'POST') {
        const { on } = JSON.parse((await readBody(req)).toString() || '{}');
        control.setAuto(!!on);
        return send(200, { ok: true, auto: !!on });
      }

      if (url.pathname === '/api/recordings') return send(200, { items: listRecordings() });
      if (url.pathname === '/api/sessions') return send(200, { items: listSessions() });
      if (url.pathname === '/api/exports') return send(200, { items: xp.listExports(EXPORTS), ffmpeg: ff.probe() });

      /* the app page reporting the score as it happened — see appendEvent */
      if (url.pathname === '/api/event' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
        return send(200, { ok: appendEvent(body.code, body) });
      }

      /* One match, one file: every angle stacked onto a single timeline. Runs
         in the background — a long match takes minutes — and reports through
         /api/status like everything else. */
      if (url.pathname === '/api/combine' && req.method === 'POST') {
        const { code, startedAt } = JSON.parse((await readBody(req)).toString() || '{}');
        const session = findSession(code, startedAt);
        if (!session) return send(404, { error: 'no such match' });
        if (xp.busy()) return send(409, { error: 'another export is already running' });
        const job = xp.newJob('combine', `${session.code} · ${session.angles.length} angle${session.angles.length === 1 ? '' : 's'}`);
        xp.withJob(job, j => xp.combineSession(session, {
          dir: RECORDINGS, exportsDir: EXPORTS,
          onProgress: p => { if (p != null) j.pct = p; },
        })).catch(e => control.log('combine failed: ' + e.message));
        return send(200, { ok: true, job: job.id });
      }

      /* Highlights: score + crowd noise pick the moments, the AI judge keeps
         the ones worth watching, ffmpeg cuts them. Also background. */
      if (url.pathname === '/api/clips' && req.method === 'POST') {
        const { code, startedAt } = JSON.parse((await readBody(req)).toString() || '{}');
        const session = findSession(code, startedAt);
        if (!session) return send(404, { error: 'no such match' });
        if (xp.busy()) return send(409, { error: 'another export is already running' });
        const job = xp.newJob('clips', `${session.code} · highlights`);
        xp.withJob(job, j => xp.clipSession(session, {
          dir: RECORDINGS, exportsDir: EXPORTS,
          /* a little slack either side: an event logged the instant a game
             ended can land just outside the recording's own start/stop */
          events: readEvents(session.code, session.startedAt - 5000, session.startedAt + session.durationMs + 5000),
          endpoint: control.highlightEndpoint(),
          onProgress: p => { if (p != null) j.pct = p; },
          onLog: m => { j.message = m; control.log('clips: ' + m); },
        })).catch(e => control.log('clipping failed: ' + e.message));
        return send(200, { ok: true, job: job.id });
      }

      if (url.pathname.startsWith('/rec/')) {
        return serveVideo(req, res, send, RECORDINGS, decodeURIComponent(url.pathname.slice(5)));
      }
      if (url.pathname.startsWith('/export/')) {
        return serveVideo(req, res, send, EXPORTS, decodeURIComponent(url.pathname.slice(8)));
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return send(200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), 'text/html; charset=utf-8');
      }

      send(404, { error: 'not found' });
    } catch (e) {
      send(500, { error: e.message || String(e) });
    }
  });

  return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve(server)));
}

function diskFree() {
  try {
    const st = fs.statfsSync ? fs.statfsSync(RECORDINGS) : null;
    if (!st) return null;
    return { freeGB: +(st.bavail * st.bsize / 1e9).toFixed(1) };
  } catch (e) { return null; }
}

module.exports = { start, openFile, closeFile, activeFiles, listRecordings, listSessions,
  appendEvent, readEvents, lanAddresses, RECORDINGS, EXPORTS };
