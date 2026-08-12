#!/usr/bin/env node
/* FGTA match recorder.

   Joins a live match as a silent viewer and writes every camera angle to this
   machine, one file per angle. Nothing is uploaded, nothing touches the
   phones' storage, and the phones do not have to stay in the app for the
   recording to keep going.

   Start it, open the address it prints (from this PC or from your phone on the
   same wifi), and either type a code or leave auto-record on. */
const fs = require('fs');
const path = require('path');
const srv = require('./server');
const ffmpeg = require('./ffmpeg');
const { Recorder } = require('./browser');

const PORT = Number(process.env.FGTA_PORT || 8910);
const APP_URL = process.env.FGTA_APP_URL || 'https://fgta.netlify.app/index.html';
const CACHE = path.join(__dirname, '.app-cache.html');
/* The highlight judge is the deployed site's own /api/highlight function —
   the same one the live stream asks before it auto-replays something. Pointing
   at it rather than at Anthropic directly means the recorder ships with no API
   key, no account setup and no way to run up a bill; if it cannot be reached
   the clipper falls back to its own heuristics (see exports.js). */
const HIGHLIGHT_URL = process.env.FGTA_HIGHLIGHT_URL || (() => {
  try { return new URL('/api/highlight', APP_URL).toString(); }
  catch (e) { return 'https://fgta.netlify.app/api/highlight'; }
})();

/* The dashboard's log is a 300-line ring buffer that dies with the process,
   which is no help at all the morning after: by the time anybody looks, the
   evidence for why a match went unrecorded is either scrolled off or gone
   with the restart that "fixed" it. Mirror every line to a file, kept small
   enough to never be a disk problem. */
const LOG_FILE = path.join(__dirname, 'recorder.log');
const LOG_MAX = 5 * 1024 * 1024;
try {
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX) {
    fs.renameSync(LOG_FILE, LOG_FILE + '.1');       // one generation back is plenty
  }
} catch (e) {}

const logLines = [];
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch (e) {}
}

/* The page is fetched once at startup so the recorder always runs whatever is
   deployed, then cached so a dropped connection at kickoff is not fatal. */
async function loadApp() {
  try {
    const res = await fetch(APP_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    if (!/renderPTStream|ptWatch/.test(html)) throw new Error('that URL does not look like the FGTA app');
    fs.writeFileSync(CACHE, html);
    log(`loaded app from ${APP_URL} (${(html.length / 1024).toFixed(0)} KB)`);
    return html;
  } catch (e) {
    if (fs.existsSync(CACHE)) {
      log(`could not fetch the app (${e.message}) — using the cached copy`);
      return fs.readFileSync(CACHE, 'utf8');
    }
    throw new Error(`Could not load the FGTA app from ${APP_URL}: ${e.message}`);
  }
}

(async () => {
  console.log('\n  FGTA recorder\n  =============');
  const html = await loadApp();

  const rec = new Recorder({
    port: PORT,
    appUrl: APP_URL,
    onLog: log,
    openFile: (code, label, ext) => srv.openFile(code, label, ext),
    closeFile: id => srv.closeFile(id),
    onEvent: (code, ev) => { srv.appendEvent(code, ev); log(`${code}: ${ev.label || ev.kind}`); },
  });

  await srv.start({
    port: PORT,
    appHtml: () => html,
    control: {
      status: () => ({ ...rec.status(), log: logLines.slice(-60) }),
      watch: c => rec.watch(c),
      stop: () => rec.stop(),
      setAuto: v => rec.setAuto(v),
      log,
      highlightEndpoint: () => HIGHLIGHT_URL,
    },
  });

  console.log(`\n  Dashboard:  http://localhost:${PORT}`);
  for (const ip of srv.lanAddresses()) console.log(`  From phone: http://${ip}:${PORT}`);
  console.log(`  Saving to:  ${srv.RECORDINGS}`);
  console.log(`  Log file:   ${LOG_FILE}\n`);

  /* Recording never needs ffmpeg; combining angles into one file and cutting
     highlights do. Say which it is at startup rather than at the moment
     somebody presses the button. */
  const f = ffmpeg.probe();
  log(f.ok
    ? `ffmpeg ${f.version} — ${f.source}${f.hw ? `, encoding on the GPU (${f.hw})` : ', encoding on the CPU'}`
    : 'no ffmpeg found — recording works as normal; combining and highlights are unavailable');

  log('starting browser…');
  await rec.launch();
  rec.setAuto(true);        // on by default: leave the PC alone and it records whatever goes live

  const bye = async () => { log('shutting down'); await rec.close(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
})().catch(e => {
  console.error('\n  Failed to start:', e.message, '\n');
  process.exit(1);
});
