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

const RECORDINGS = path.join(__dirname, 'recordings');
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `${safeName(code, 'match')}__${safeName(label, 'angle')}__${stamp}.${ext || 'webm'}`;
  const full = path.join(RECORDINGS, name);
  const id = name;
  writers.set(id, { stream: fs.createWriteStream(full), bytes: 0, path: full, name, started: Date.now(), open: true });
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

      if (url.pathname.startsWith('/rec/')) {
        const name = path.basename(decodeURIComponent(url.pathname.slice(5)));
        const full = path.join(RECORDINGS, name);
        if (!full.startsWith(RECORDINGS) || !fs.existsSync(full)) return send(404, { error: 'not found' });
        const st = fs.statSync(full);
        res.writeHead(200, {
          'Content-Type': name.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
          'Content-Length': st.size,
          'Content-Disposition': `inline; filename="${name}"`,
          'Accept-Ranges': 'none',
        });
        return fs.createReadStream(full).pipe(res);
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

module.exports = { start, openFile, closeFile, activeFiles, listRecordings, lanAddresses, RECORDINGS };
