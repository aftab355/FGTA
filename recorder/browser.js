/* Drives a headless Chromium running the real FGTA page.

   The recorder deliberately does NOT reimplement the signalling protocol. It
   loads the same page the phones load and calls the same ptWatch() they do, so
   join codes, multi-angle discovery, host-hello, reconnection and every future
   change to that protocol come along for free. All this file adds on top is a
   MediaRecorder per angle, writing to disk through the local server.

   Recording each angle's own remoteStream (rather than the viewer mix bus the
   phone app uses) is the whole point: the phone records what one person is
   watching, this records every camera at once, each to its own file, complete
   with the burnt-in scoreboard and the host's audio. */
const { chromium } = require('playwright');

const LAUNCH_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  /* headless Chromium will happily stop decoding video nobody is looking at.
     A MediaRecorder counts as a consumer, but these keep the page out of the
     background-throttling paths that would starve it anyway. */
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

class Recorder {
  constructor({ port, appUrl, onLog, openFile, closeFile, onEvent }) {
    this.port = port;
    this.appUrl = appUrl;
    this.log = onLog || (() => {});
    this.openFile = openFile;
    this.closeFile = closeFile;
    this.onEvent = onEvent || (() => {});
    this.auto = false;
    this.state = { connected: false, code: null, angles: [], watching: false, error: null };
    this.failures = 0;
    this.relaunching = false;
    this.closing = false;
    this._needRelaunch = false;
    this._lastLive = '';
  }

  async launch() {
    await this._boot();
    /* One interval for the life of the process — a relaunch reuses it rather
       than stacking a second poller on top. */
    if (!this.poll) this.poll = setInterval(() => this.tick().catch(e => this._tickFailed(e)), 1500);
  }

  async _boot() {
    /* Prefer the Chrome already installed on this machine, and only fall back
       to Playwright's own Chromium. The difference is codecs: Playwright ships
       the open-source build, which has no H.264/AAC, so the best MP4 it can
       write is VP9-in-MP4 — a file that claims to be an MP4 and then refuses
       to open in Windows Media Player, iMovie, Premiere or on a phone. Real
       Chrome has the licensed codecs and produces an MP4 that plays anywhere.
       See pickMime in installRecordingLayer, which checks for H.264 rather
       than trusting the container name. */
    try {
      this.browser = await chromium.launch({ headless: true, channel: 'chrome', args: LAUNCH_ARGS });
      this.realChrome = true;
      this.log('using the Chrome installed on this PC');
    } catch (e) {
      this.browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
      this.realChrome = false;
      this.log('Chrome not found — using the bundled browser (WebM only; install Chrome for MP4)');
    }
    this.ctx = await this.browser.newContext();
    this.page = await this.ctx.newPage();

    this.page.on('pageerror', e => this.log('page error: ' + e.message));
    this.page.on('console', m => { if (m.type() === 'error') this.log('console: ' + m.text().slice(0, 200)); });

    /* A headless tab running several MediaRecorders is exactly the kind of
       thing that gets killed by the OS or crashes its renderer, and nothing
       here used to notice: the poll below swallowed the resulting errors and
       the recorder sat for hours reporting itself connected while doing
       nothing at all. Flag it and let tick() rebuild the browser. */
    this.page.on('crash', () => { if (!this.closing) { this.log('the browser tab crashed'); this._needRelaunch = true; } });
    this.page.on('close', () => { if (!this.closing) this._needRelaunch = true; });
    this.browser.on('disconnected', () => { if (!this.closing) this._needRelaunch = true; });

    await this.page.exposeFunction('__recStart', (code, label, ext) => this.openFile(code, label, ext));
    await this.page.exposeFunction('__recStop', id => this.closeFile(id));
    await this.page.exposeFunction('__recLog', msg => this.log(msg));
    await this.page.exposeFunction('__recEvent', (code, ev) => this.onEvent(code, ev));

    await this.page.goto(`http://127.0.0.1:${this.port}/app`, { waitUntil: 'load', timeout: 60000 });

    /* the page has to finish booting its Supabase client before ptWatch can
       open a channel — that is the only thing worth waiting on */
    await this.page.waitForFunction(
      () => typeof sb !== 'undefined' && sb && typeof sb.channel === 'function',
      null, { timeout: 45000 }
    );
    await this.page.evaluate(() => {
      try { setMyDisplayName('PC recorder'); } catch (e) {}
      /* Auto-record reads the app's live-match directory, which the page only
         joins during boot — and boot can stop short of that if anything
         earlier in it throws. ptDirInit is idempotent, so calling it here
         costs nothing and stops auto-record from silently watching an empty
         list forever when it does. */
      try { ptDirInit(); } catch (e) {}
    });

    const fmt = await this.probeMime();
    this.state.format = fmt.ext;
    this.log(fmt.mime
      ? `recording format: ${fmt.ext.toUpperCase()} (${fmt.mime}) — verified by a test recording`
      : 'no working recording format found on this browser');

    await this.installRecordingLayer();
    this.log('browser ready');
    this.state.connected = true;
    this.state.error = null;
    this.failures = 0;
  }

  /* Rebuild the browser from scratch after a crash. Auto-record picks the
     match back up on the next tick; a manual watch is restored by hand since
     nothing else would. */
  async relaunch() {
    if (this.relaunching || this.closing) return;
    this.relaunching = true;
    this._needRelaunch = false;
    const wasWatching = this.state.watching ? this.state.code : null;
    this.log('restarting the browser…');
    try { await this.browser.close(); } catch (e) {}
    this.page = null;
    try {
      await this._boot();
      this.log('browser restarted' + (this.auto ? ' — auto-record still on' : ''));
      if (wasWatching && !this.auto) {
        try { await this.watch(wasWatching); } catch (e) { this.log('could not rejoin ' + wasWatching + ': ' + e.message); }
      }
    } catch (e) {
      this.log('restart failed: ' + e.message + ' — will try again shortly');
      this._needRelaunch = true;
    } finally {
      this.relaunching = false;
    }
  }

  /* Never silently. A recorder that has stopped working has to say so, both
     in the log and in the status the dashboard renders, or the first anybody
     hears about it is a match that was never recorded. */
  _tickFailed(e) {
    const msg = (e && e.message) || String(e);
    this.failures++;
    this.state.connected = false;
    this.state.error = msg;
    if (this.failures === 1 || this.failures % 40 === 0) this.log(`poll failed (${this.failures}x): ${msg}`);
    const fatal = /Target closed|Target crashed|has been closed|Session closed|Execution context was destroyed|Protocol error/i.test(msg);
    if (fatal || this.failures >= 5) this.relaunch();
  }

  /* Decides the recording format by trying each candidate for real: record a
     moving canvas plus a tone for a second, and keep the first one that
     actually produces a sensible number of bytes.

     MP4 (H.264 + AAC) is preferred because it plays in Windows Media Player,
     on a phone and in any editor, where WebM often does not. But it is only
     worth having if it works: a browser without licensed codecs will either
     write VP9 inside an MP4 — a file whose name lies about what it is — or,
     as measured on one Chromium build, claim H.264 support and then emit
     essentially nothing. Both failures are invisible to isTypeSupported and
     both destroy a match recording, so neither is decided by asking. */
  async probeMime() {
    const res = await this.page.evaluate(async (allowMp4) => {
      /* MP4 is only ever offered to a real Chrome. The bundled browser was
         measured passing this very probe on a canvas and then writing a
         near-empty file from an actual WebRTC stream, so on that build MP4 is
         not a format choice, it is a way to lose a match. */
      const CANDIDATES = (allowMp4 ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=avc1',
      ] : []).concat([
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]);
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      let n = 0;
      // real motion, or an encoder can compress a static frame down to nothing
      const draw = () => { n++; ctx.fillStyle = `hsl(${n * 7 % 360},80%,50%)`; ctx.fillRect(0, 0, 320, 180); };
      draw();
      const timer = setInterval(draw, 33);
      const stream = canvas.captureStream(30);
      // the real thing records audio too, so probe with audio present
      let ac = null;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
        const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination();
        osc.connect(dest); osc.start();
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      } catch (e) {}
      const tried = [];
      let win = null;
      for (const mime of CANDIDATES) {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) { tried.push(mime + ' → unsupported'); continue; }
        let bytes = 0;
        try {
          const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1000000 });
          r.ondataavailable = e => { if (e.data) bytes += e.data.size; };
          r.start(200);
          await new Promise(res => setTimeout(res, 1000));
          await new Promise(res => { r.onstop = res; try { r.stop(); } catch (e) { res(); } });
        } catch (e) { tried.push(mime + ' → threw'); continue; }
        tried.push(`${mime} → ${bytes} bytes`);
        if (bytes > 3000) { win = mime; break; }      // anything less is a broken encoder, not a small file
      }
      clearInterval(timer);
      try { if (ac) ac.close(); } catch (e) {}
      stream.getTracks().forEach(t => t.stop());
      window.__fgtaMime = win || '';
      /* what the watchdog drops back to if the chosen format turns out not to
         work against a real stream — see the recorder watchdog below */
      window.__fgtaWebm = ['video/webm;codecs=vp8,opus', 'video/webm'].find(m =>
        window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      return { mime: win || '', tried };
    }, !!this.realChrome);
    res.tried.forEach(t => this.log('  format probe: ' + t));
    return { mime: res.mime, ext: res.mime.includes('mp4') ? 'mp4' : 'webm' };
  }

  /* Runs inside the page. Watches PTStream for angles and keeps exactly one
     MediaRecorder alive per angle, starting when an angle goes live and
     stopping when it disappears. */
  async installRecordingLayer() {
    await this.page.evaluate(() => {
      if (window.__fgtaRec) return;
      const R = window.__fgtaRec = { recs: {}, files: {}, bytes: {}, notes: [] };

      /* The format is decided once at startup by actually recording a second of
         video and weighing the result — see probeMime. isTypeSupported is not
         trustworthy here: builds exist that answer yes to H.264, construct a
         MediaRecorder happily, and then emit a nearly empty file. Finding that
         out at the end of somebody's match is not acceptable, so the recorder
         finds out on its own time instead. */
      const pickMime = () => window.__fgtaMime || '';

      /* PTStream is a top-level `let` in the app, which puts it in the script's
         lexical scope and NOT on window — window.PTStream is permanently
         undefined. Unqualified lookup is what actually reaches it. */
      const stream = () => (typeof PTStream !== 'undefined' ? PTStream : null);

      R.sync = async () => {
        const S = stream();
        const live = new Set();

        if (S && S.role === 'viewer') {
          for (const hostId of (S.angleOrder || [])) {
            const a = S.angles[hostId];
            if (!a || !a.remoteStream || a.status !== 'live') continue;
            live.add(hostId);
            if (R.recs[hostId]) continue;
            const mime = pickMime();
            const ext = mime.includes('mp4') ? 'mp4' : 'webm';
            const id = await window.__recStart(S.code, a.label || ('angle-' + hostId), ext);
            let rec;
            try {
              rec = new MediaRecorder(a.remoteStream, {
                ...(mime ? { mimeType: mime } : {}),
                videoBitsPerSecond: 6000000,      // this machine has the disk and the bandwidth
                audioBitsPerSecond: 160000,
              });
            } catch (e) {
              window.__recLog('could not start recorder for ' + hostId + ': ' + e.message);
              window.__recStop(id);
              continue;
            }
            R.bytes[hostId] = 0;
            /* Uploads are in flight when the recorder stops, and MediaRecorder
               emits one last chunk on its way out. Closing the file the moment
               onstop fires meant those arrived at a server that had already
               finished with them — the "410 (Gone)" in the log — and the tail
               of the recording went in the bin. Track them and close only once
               they have all landed. */
            const pending = [];
            rec.ondataavailable = e => {
              if (!e.data || !e.data.size) return;
              R.bytes[hostId] += e.data.size;
              const p = fetch('/api/chunk?f=' + encodeURIComponent(id), { method: 'POST', body: e.data })
                .catch(() => {});     // server gone: nothing left to do, the file is already flushed
              pending.push(p);
              if (pending.length > 400) pending.splice(0, pending.length - 400);
            };
            /* A MediaRecorder can start, report itself healthy and produce
               nothing — measured on a browser whose H.264 encoder accepted a
               canvas but not a WebRTC stream. Nothing about that is visible
               until you open the file, so check that bytes are actually
               arriving and drop to WebM for the rest of the session if they
               are not. Losing a few seconds beats losing the match. */
            setTimeout(() => {
              if (R.recs[hostId] !== rec) return;               // already replaced or finished
              if (R.bytes[hostId] > 3000) return;               // data is flowing, nothing to do
              if (!window.__fgtaWebm || mime === window.__fgtaWebm) return;
              window.__recLog(`"${mime}" produced no data from the live stream — switching to WebM`);
              window.__fgtaMime = window.__fgtaWebm;
              try { rec.stop(); } catch (e) {}
              delete R.recs[hostId];                            // sync() reopens it in the new format
              delete R.files[hostId];
            }, 8000);
            rec.onerror = e => window.__recLog('recorder error: ' + (e && e.error && e.error.message));
            rec.onstop = async () => {
              try { await Promise.allSettled(pending); } catch (e) {}
              window.__recStop(id);
            };
            rec.start(2000);
            R.recs[hostId] = rec;
            R.files[hostId] = id;
            window.__recLog('recording angle "' + (a.label || hostId) + '" -> ' + id);
          }
        }

        // an angle that went away (host stopped, or the whole watch ended) closes its file
        for (const hostId of Object.keys(R.recs)) {
          if (live.has(hostId)) continue;
          try { R.recs[hostId].stop(); } catch (e) {}
          delete R.recs[hostId];
          delete R.files[hostId];
        }
      };

      /* ---- the match log ----
         Alongside the pictures, write down what the score did and when. The
         host mirrors its match state to every viewer (the pt_sync broadcast),
         this recorder is a viewer, so the score arrives here for free — and an
         hour later it is the difference between a highlight clipper that knows
         a set point from an ordinary rally and one that only knows how loud
         the court was.

         Nothing is inferred that the payload does not carry: it holds raw
         point counts, not who is serving, so there is no "break point" here.
         Game, set, match, aces and match/set point are all it can honestly
         say, and all it needs to. */
      R.lastPT = null;
      R.watchScore = () => {
        const S = stream();
        if (!S || S.role !== 'viewer' || !S.remotePT) { R.lastPT = null; return; }
        const P = S.remotePT, prev = R.lastPT;
        R.lastPT = P;
        if (!prev) return;
        const nameOf = side => (side === 'a' ? (P.a || 'player 1') : (P.b || 'player 2'));
        const out = [];
        if ((P.acesA || 0) > (prev.acesA || 0)) out.push({ kind: 'ace', label: 'ace by ' + nameOf('a') });
        if ((P.acesB || 0) > (prev.acesB || 0)) out.push({ kind: 'ace', label: 'ace by ' + nameOf('b') });
        if (P.winner && !prev.winner) out.push({ kind: 'match', label: 'match won by ' + P.winner });
        else if ((P.setsA || 0) > (prev.setsA || 0)) out.push({ kind: 'set', label: 'set to ' + nameOf('a') });
        else if ((P.setsB || 0) > (prev.setsB || 0)) out.push({ kind: 'set', label: 'set to ' + nameOf('b') });
        else if ((P.gamesA || 0) > (prev.gamesA || 0)) out.push({ kind: 'game', label: 'game to ' + nameOf('a') });
        else if ((P.gamesB || 0) > (prev.gamesB || 0)) out.push({ kind: 'game', label: 'game to ' + nameOf('b') });
        /* Reaching match point is worth marking on its own — the point that
           follows it is the one people want back, whichever way it goes. */
        try {
          for (const side of ['a', 'b']) {
            const now = window.ptIsMatchPoint && window.ptIsMatchPoint(side, P);
            const was = window.ptIsMatchPoint && window.ptIsMatchPoint(side, prev);
            if (now && !was) out.push({ kind: 'tension', label: 'match point, ' + nameOf(side) });
          }
        } catch (e) {}
        if ((P.streakCount || 0) >= 4 && (P.streakCount || 0) > (prev.streakCount || 0))
          out.push({ kind: 'streak', label: P.streakCount + ' in a row, ' + nameOf(P.streakSide) });
        for (const ev of out) window.__recEvent(S.code, { ...ev, t: Date.now() });
      };

      R.timer = setInterval(() => {
        R.sync().catch(() => {});
        try { R.watchScore(); } catch (e) {}
      }, 1000);
    });
  }

  async tick() {
    if (this.relaunching) return;
    if (this._needRelaunch) return this.relaunch();
    if (!this.page) return;
    const s = await this.page.evaluate(() => {
      const S = (typeof PTStream !== 'undefined' ? PTStream : null);   // see installRecordingLayer
      /* The directory's Realtime socket drops over a long session and used to
         stay dead, which left auto-record permanently blind — the page heals
         itself now, and this is the belt-and-braces poke for a deployment
         that predates that fix. */
      try { if (typeof ptDirEnsure === 'function') ptDirEnsure(); } catch (e) {}
      const dir = (() => { try { return ptActiveStreams(); } catch (e) { return []; } })();
      return {
        watching: !!(S && S.role === 'viewer'),
        code: S ? S.code : null,
        status: S ? S.status : null,
        angles: S && S.angleOrder ? S.angleOrder.map(h => ({
          id: h,
          label: (S.angles[h] || {}).label || h,
          status: (S.angles[h] || {}).status || '?',
          recording: !!(window.__fgtaRec && window.__fgtaRec.recs[h]),
        })) : [],
        live: dir.map(d => ({ code: d.code, label: d.label, angles: d.angles || 1 })),
      };
    });
    this.state = { ...this.state, ...s, connected: true, error: null, lastTickAt: Date.now() };
    this.failures = 0;

    /* Say what the directory can see, so "it never noticed my match" is
       answerable from the log afterwards instead of being invisible. */
    const seen = s.live.map(l => l.code).sort().join(',');
    if (seen !== this._lastLive) {
      this._lastLive = seen;
      this.log(seen ? 'live now: ' + s.live.map(l => `${l.code} (${l.angles} angle${l.angles === 1 ? '' : 's'})`).join(', ')
                    : 'no matches live');
    }

    /* auto mode: pick up whatever is live without anybody touching the PC */
    if (this.auto && !s.watching && s.live.length) {
      this.log('auto: joining ' + s.live[0].code);
      await this.watch(s.live[0].code);
    }
    /* the match ended — let go so auto mode can pick up the next one */
    if (s.watching && s.angles.length === 0) {
      this._emptySince = this._emptySince || Date.now();
      if (Date.now() - this._emptySince > 20000) {
        this.log('no angles left for 20s — leaving ' + s.code);
        await this.stop();
      }
    } else {
      this._emptySince = null;
    }
  }

  async watch(code) {
    if (!this.page) throw new Error('browser not ready');
    this._emptySince = null;
    await this.page.evaluate(async c => {
      if (typeof PTStream !== 'undefined' && PTStream) { try { ptStopWatching(); } catch (e) {} }
      await new Promise(r => setTimeout(r, 250));
      ptWatch(c);
    }, code);
    this.log('joining ' + code);
  }

  async stop() {
    if (!this.page) return;
    await this.page.evaluate(async () => {
      if (window.__fgtaRec) {
        for (const h of Object.keys(window.__fgtaRec.recs)) {
          try { window.__fgtaRec.recs[h].stop(); } catch (e) {}
          delete window.__fgtaRec.recs[h];
        }
      }
      try { if (typeof PTStream !== 'undefined' && PTStream) ptStopWatching(); } catch (e) {}
    });
    this._emptySince = null;
    this.log('stopped');
  }

  setAuto(on) { this.auto = on; this.log('auto-record ' + (on ? 'on' : 'off')); }

  status() { return { ...this.state, auto: this.auto }; }

  async close() {
    this.closing = true;
    if (this.poll) clearInterval(this.poll);
    try { await this.stop(); } catch (e) {}
    try { await this.browser.close(); } catch (e) {}
  }
}

module.exports = { Recorder };
