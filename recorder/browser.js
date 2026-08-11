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
  constructor({ port, appUrl, onLog, openFile, closeFile }) {
    this.port = port;
    this.appUrl = appUrl;
    this.log = onLog || (() => {});
    this.openFile = openFile;
    this.closeFile = closeFile;
    this.auto = false;
    this.state = { connected: false, code: null, angles: [], watching: false, error: null };
  }

  async launch() {
    this.browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    this.ctx = await this.browser.newContext();
    this.page = await this.ctx.newPage();

    this.page.on('pageerror', e => this.log('page error: ' + e.message));
    this.page.on('console', m => { if (m.type() === 'error') this.log('console: ' + m.text().slice(0, 200)); });

    await this.page.exposeFunction('__recStart', (code, label, ext) => this.openFile(code, label, ext));
    await this.page.exposeFunction('__recStop', id => this.closeFile(id));
    await this.page.exposeFunction('__recLog', msg => this.log(msg));

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

    await this.installRecordingLayer();
    this.log('browser ready');
    this.state.connected = true;

    this.poll = setInterval(() => this.tick().catch(() => {}), 1500);
  }

  /* Runs inside the page. Watches PTStream for angles and keeps exactly one
     MediaRecorder alive per angle, starting when an angle goes live and
     stopping when it disappears. */
  async installRecordingLayer() {
    await this.page.evaluate(() => {
      if (window.__fgtaRec) return;
      const R = window.__fgtaRec = { recs: {}, files: {}, notes: [] };

      const pickMime = () => ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

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
            rec.ondataavailable = async e => {
              if (!e.data || !e.data.size) return;
              try { await fetch('/api/chunk?f=' + encodeURIComponent(id), { method: 'POST', body: e.data }); }
              catch (err) { /* server gone; the next chunk will fail too and the file is already flushed */ }
            };
            rec.onerror = e => window.__recLog('recorder error: ' + (e && e.error && e.error.message));
            rec.onstop = () => window.__recStop(id);
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

      R.timer = setInterval(() => { R.sync().catch(() => {}); }, 1000);
    });
  }

  async tick() {
    if (!this.page) return;
    const s = await this.page.evaluate(() => {
      const S = (typeof PTStream !== 'undefined' ? PTStream : null);   // see installRecordingLayer
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
    this.state = { ...this.state, ...s, connected: true };

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
    if (this.poll) clearInterval(this.poll);
    try { await this.stop(); } catch (e) {}
    try { await this.browser.close(); } catch (e) {}
  }
}

module.exports = { Recorder };
