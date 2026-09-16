#!/usr/bin/env node
/* rally-trim — cut a match down to the tennis, from the scoreboard on it.

   The rally reel knows exactly where every point ENDED, because somebody
   tapped it, and has no measurement at all of where any point STARTED — so it
   assumes a fixed 12 seconds of dead time and keeps everything after it. That
   assumption is the dead weight.

   Two measurements replace it:

     the scoreboard   every change in the burnt-in plate is a scored point,
                      timestamped in the timeline of the file you actually
                      have. No alignment, no offset, no splice problem.
     the soundtrack   the serve, found by working backward from that ending
                      through the strikes the app's own detector hears.

   One decode pass over the file feeds both, plus the motion tensor the
   picture pass needs, spread across however many cores are going.

     node tools/rally-trim.js <video> [cut-list] [options]

   The cut list is optional and supplies labels only — set, game, score,
   winner. The cut itself comes off the picture and the sound. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const parse = require('./rally-trim/parse.js');
const audioMod = require('./rally-trim/audio.js');
const decode = require('./rally-trim/decode.js');
const boardMod = require('./rally-trim/board.js');
const alignMod = require('./rally-trim/align.js');
const serveMod = require('./rally-trim/serve.js');
const motionMod = require('./rally-trim/motion.js');
const renderMod = require('./rally-trim/render.js');
const emit = require('./rally-trim/emit.js');

const USAGE = `
rally-trim — measure where each point started, instead of assuming it

  node tools/rally-trim.js <video> [cut-list] [options]

  <video>      the recording, with the scoreboard burnt into it
  [cut-list]   optional: the rally reel's .sh or .json, for labels

Board
  --board x,y,w,h  the scoreboard's box, if you would rather say than have it found
  --board-preview  write PNG crops of what it found and stop. Do this first.
  --no-board       ignore the scoreboard; locate the taps by ear instead

Cut
  --no-motion      skip the picture pass (faster; worse next to a busy court)
  --fault-gap N    earlier strikes within N seconds are a fault or a let (14)
  --max-clip N     safety rail on clip length (45)
  --lead N         seconds kept before the serve      --tail N   after the point
  --sens N         strike threshold; higher is fussier (1.2)
  --board-lag N    ref's reaction, subtracted from each board change (from tuning)

Output
  --check          say whether this machine can run it, and what is missing
  --render         encode the cut (default). --no-render for scripts only
  --proof          also render the proof reel: a couple of seconds around
                   every clip's opening, to check the whole cut in minutes
  --x264           force libx264 instead of a hardware encoder
  --out-dir D      where to write        --slug S   basename for the outputs
  --dry-run        work it out and report, write nothing
  --jobs N         parallel decoders (default: half your cores)
  --ffmpeg P       path to ffmpeg        --ffprobe P  path to ffprobe
`;

function fail(msg) { process.stderr.write('rally-trim: ' + msg + '\n'); process.exit(1); }
function say(msg) { process.stderr.write(msg + '\n'); }

/* Worth being able to ask BEFORE pointing this at an eight-gigabyte file and
   finding out twenty seconds later that ffprobe is missing. */
const INSTALL = [
  '  macOS           brew install ffmpeg',
  '  Debian/Ubuntu   sudo apt install ffmpeg',
  '  Fedora          sudo dnf install ffmpeg',
  '  Windows         winget install Gyan.FFmpeg     (then run this from Git Bash or WSL)',
  '  Node            https://nodejs.org  — any version 18 or newer'
];

function check(o) {
  const caps = decode.capabilities(o);
  const major = parseInt(process.versions.node, 10);
  let ok = true;

  say('node           ' + process.version + (major >= 18 ? '' : '   — too old, needs 18 or newer'));
  if (major < 18) ok = false;

  if (!caps.ok) {
    say('ffmpeg         NOT FOUND');
    ok = false;
  } else {
    say('ffmpeg         ' + caps.version);
    say('cores          ' + caps.cores + '   (will use ' + Math.max(1, Math.floor(caps.cores / 2)) + ' decoders)');
    const enc = renderMod.pickEncoder(caps, o);
    say('encoder        ' + enc.name + (enc.hw ? '   (hardware — the render will be quick)'
      : '   (software — the render is the slow part; nothing to fix, just slower)'));
  }

  /* ffprobe is a separate binary and is separately missable. */
  const probe = require('child_process').spawnSync(o.ffprobe || 'ffprobe',
    ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { say('ffprobe        NOT FOUND'); ok = false; }
  else say('ffprobe        ' + ((/ffprobe version (\S+)/.exec(probe.stdout || '') || [, '?'])[1]));

  if (!ok) {
    say('\nSomething is missing. Install it with whichever of these fits:');
    for (const l of INSTALL) say(l);
    say('\nffmpeg and ffprobe ship together — if one is missing, install the pair.');
  } else {
    say('\nGood to go. Next:  node tools/rally-trim.js <your-video> --board-preview');
  }
  return ok;
}

function args(argv) {
  const o = { _: [], motion: true, board: true, render: true };
  const num = (k, v) => { if (!isFinite(+v)) fail(`--${k} needs a number`); return +v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE); process.exit(0); }
    else if (a === '--check') o.check = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--proof') o.proof = true;
    else if (a === '--render') o.render = true;
    else if (a === '--no-render') o.render = false;
    else if (a === '--x264') o.x264 = true;
    else if (a === '--no-motion') o.motion = false;
    else if (a === '--no-board') o.board = false;
    else if (a === '--board-preview') o.boardPreview = true;
    else if (a === '--board') o.boardBox = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--slug') o.slug = argv[++i];
    else if (a === '--ffmpeg') o.ffmpeg = argv[++i];
    else if (a === '--ffprobe') o.ffprobe = argv[++i];
    else if (a === '--jobs') o.jobs = num('jobs', argv[++i]);
    else if (a === '--fault-gap') o.faultGap = num('fault-gap', argv[++i]);
    else if (a === '--max-clip') o.maxClip = num('max-clip', argv[++i]);
    else if (a === '--lead') o.lead = num('lead', argv[++i]);
    else if (a === '--tail') o.tail = num('tail', argv[++i]);
    else if (a === '--sens') o.sens = num('sens', argv[++i]);
    else if (a === '--board-lag') o.boardLag = num('board-lag', argv[++i]);
    else if (a === '--court-frac') o.courtFrac = num('court-frac', argv[++i]);
    else if (a[0] === '-') fail('unknown option ' + a);
    else o._.push(a);
  }
  return o;
}

function parseBox(s, info) {
  const p = String(s).split(/[,x: ]+/).map(Number);
  if (p.length !== 4 || p.some(v => !isFinite(v))) fail('--board wants x,y,w,h in pixels');
  const [x, y, w, h] = p;
  if (x + w > info.width || y + h > info.height) fail('--board box falls outside the ' + info.width + 'x' + info.height + ' frame');
  return { x, y, w, h };
}

/* A PNG of the crop at a few moments, so a wrong box is one glance to spot. */
function previewCrops(file, box, times, dir, opt) {
  const { spawnSync } = require('child_process');
  const out = [];
  times.forEach((t, i) => {
    const f = path.join(dir, 'board-' + String(i + 1).padStart(2, '0') + '.png');
    const r = spawnSync(opt.ffmpeg || 'ffmpeg', ['-nostdin', '-loglevel', 'error', '-y',
      '-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
      '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=iw*3:ih*3:flags=neighbor`, f]);
    if (!r.error && r.status === 0) out.push(f);
  });
  return out;
}

async function main() {
  const t0 = Date.now();
  const o = args(process.argv.slice(2));
  if (o.check) { process.exit(check(o) ? 0 : 1); }
  if (!o._.length) { process.stdout.write(USAGE); process.exit(0); }
  const video = o._[0];
  const cutFile = o._[1] || null;
  if (!fs.existsSync(video)) fail('no such file: ' + video);
  if (cutFile && !fs.existsSync(cutFile)) fail('no such file: ' + cutFile);

  const caps = decode.capabilities(o);
  if (!caps.ok) fail(caps.reason);
  const jobs = Math.max(1, o.jobs || Math.max(1, Math.floor(caps.cores / 2)));
  say(`ffmpeg         ${caps.version}   ${caps.cores} cores, ${jobs} decoders` +
      (caps.encoders.length ? `, encoders: ${caps.encoders.join(', ')}` : ', software encode only'));

  let info;
  try { info = decode.info(video, o); } catch (e) { fail(e.message); }
  if (!info.duration) fail('could not read a duration from ' + video);
  say(`recording      ${emit.clock(info.duration)}, ${info.width}x${info.height} @ ${info.fps.toFixed(2)}fps`);

  /* ---- the cut list, for labels ---- */
  let list = null, tune = Object.assign({}, parse.TUNE_DEF);
  if (cutFile) {
    try { list = parse.load(cutFile); } catch (e) { fail('could not read ' + cutFile + ': ' + e.message); }
    tune = Object.assign({}, list.tune);
    say(`cut list       ${list.points.length} points, match spans ${emit.clock(list.points[list.points.length - 1].matchEnd)}`);
  } else {
    say('cut list       none given — labels will just be point numbers');
  }
  if (o.lead != null) tune.lead = o.lead;
  if (o.tail != null) tune.tail = o.tail;

  const slug = o.slug || (cutFile
    ? path.basename(cutFile).replace(/\.(sh|json)$/i, '').replace(/-cut(list)?$/i, '')
    : path.basename(video).replace(/\.[^.]+$/, ''));
  const outDir = o.outDir || path.dirname(path.resolve(cutFile || video));

  /* ---- find the scoreboard ---- */
  let box = null;
  if (o.board) {
    if (o.boardBox) {
      box = parseBox(o.boardBox, info);
      say(`scoreboard     ${box.w}x${box.h} at ${box.x},${box.y} (given)`);
    } else {
      say('looking for the scoreboard…');
      let pf;
      try { pf = await decode.probeFrames(video, o); } catch (e) { fail(e.message); }
      const det = boardMod.detect(pf.frames, pf.w, pf.h, {});
      if (!det.box) {
        say('               ' + (det.reason || 'not found') + ' — falling back to locating the taps by ear');
        o.board = false;
      } else {
        box = boardMod.scaleBox(det.box, pf.w, pf.h, info.width, info.height);
        say(`scoreboard     ${box.w}x${box.h} at ${box.x},${box.y}  (from ${pf.n} keyframes, score ${det.score.toFixed(2)})`);
        say('               check it with --board-preview if anything below looks wrong');
      }
    }
  }
  if (o.boardPreview) {
    if (!box) fail('no scoreboard box to preview');
    const dir = o.outDir || process.cwd();
    const times = [0.2, 0.35, 0.5, 0.65, 0.8].map(f => info.duration * f);
    const files = previewCrops(video, box, times, dir, o);
    if (!files.length) fail('could not write preview crops');
    for (const f of files) say('wrote ' + f);
    say('\nEach should be a readable scoreboard and nothing else. If not, pass the');
    say('right box yourself:  --board x,y,w,h');
    return;
  }

  /* ---- one decode pass, plus the audio alongside it ---- */
  const tmp = decode.mkTmp();
  let recs, aligned, a, scan = null, boardEvents = null;
  try {
    const chunks = decode.chunksOf(info.duration, jobs);
    say(`\ndecoding       ${chunks.length} slices in parallel${box ? ', scoreboard + motion' : ', motion only'}…`);

    const state = chunks.map(() => ({ prev: null, cells: [], times: [] }));
    const AVC = motionMod.AV_CELLS;
    const onGrid = (buf, t, chunk) => {
      const st = state[chunk.i];
      const cur = Buffer.from(buf);                    // the source buffer is reused
      if (st.prev) {
        const row = new Float64Array(AVC);
        motionMod.cellRow(st.prev, cur, row, 0);
        st.cells.push(row); st.times.push(t);
      }
      st.prev = cur;
    };

    /* The duration lets the decoder size its buffer once instead of doubling
       its way there, which on a long recording is the difference between one
       copy of the track and several. */
    const audioP = audioMod.decode(video, Object.assign({}, o, { duration: info.duration }))
      .catch(e => ({ error: e }));
    const done = await decode.pool(chunks, jobs, c => decode.decodeChunk(video, c, box, Object.assign({ tmp }, o), onGrid));
    const dec = await audioP;
    if (dec.error) fail(dec.error.message);
    say(`               done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

    /* ---- the scoreboard's story ---- */
    if (box) {
      const all = [];
      for (let i = 0; i < done.length; i++) {
        const f = done[i].boardFile;
        if (!f || !fs.existsSync(f)) continue;
        const buf = fs.readFileSync(f);
        const per = box.outW * box.outH, n = Math.floor(buf.length / per);
        const frames = [];
        for (let k = 0; k < n; k++) frames.push(buf.subarray(k * per, (k + 1) * per));
        const ch = boardMod.changes(frames, box.outW, box.outH, decode.BOARD_FPS, {
          t0: chunks[i].start, guardHead: i === 0, guardTail: i === done.length - 1
        });
        if (ch.reason && !ch.events.length) say(`               slice ${i}: ${ch.reason}`);
        all.push.apply(all, ch.events);
        fs.unlinkSync(f);
      }
      all.sort((x, y) => x.t - y.t);
      /* a change straddling a slice boundary can be seen twice */
      boardEvents = all.filter((e, i) => i === 0 || e.t - all[i - 1].t > boardMod.DEF.debounce);
      say(`scoreboard     ${boardEvents.length} changes = ${boardEvents.length} points` +
          (list ? `   (cut list says ${list.points.length})` : ''));
      if (!boardEvents.length) {
        say('               nothing changed in that box — falling back to locating by ear');
        boardEvents = null;
      }
    }

    /* ---- strikes ---- */
    a = audioMod.analyse(dec.samples, dec.sr, o.sens != null ? { sens: o.sens } : null);
    a.seconds = dec.seconds;
    say(`strikes        ${a.hits.length} in ${a.runs.length} runs, ${a.perMin.toFixed(1)}/min` +
        (a.perMin < 8 ? '   — low for tennis; try --sens lower' :
         a.perMin > 40 ? '   — high; the next court, wind or a crowd. Try --sens higher' : ''));

    /* ---- point endings ---- */
    if (boardEvents) {
      const lag = o.boardLag != null ? o.boardLag : tune.lag;
      aligned = alignMod.fromBoard(boardEvents, list && list.points, { lag });
      if (aligned.mismatch) {
        say(`               ${Math.abs(aligned.mismatch)} ${aligned.mismatch > 0 ? 'more' : 'fewer'} ` +
            'changes than the cut list has points — labels past that point may be off by one');
      }
    } else {
      if (!list) fail('no scoreboard read and no cut list given — nothing to anchor the cut to');
      say('locating the taps by ear…');
      aligned = alignMod.align(list.points, a.runs, {});
      if (aligned.failed || !aligned.matched) fail('could not locate the match in this recording');
      say(`               ${aligned.matched}/${list.points.length} located, ${aligned.splices.length} splices, ` +
          `spread ${aligned.spread == null ? 'n/a' : aligned.spread.toFixed(2) + 's'}`);
    }

    /* ---- the picture ---- */
    let gate = null, rise = null;
    if (o.motion) {
      const cells = [], times = [];
      for (const st of state) { cells.push.apply(cells, st.cells); times.push.apply(times, st.times); }
      const idx = times.map((t, i) => i).sort((x, y) => times[x] - times[y]);
      const n = idx.length;
      if (n > 32) {
        const grid = new Float64Array(n * AVC), T = new Float64Array(n);
        for (let k = 0; k < n; k++) { grid.set(cells[idx[k]], k * AVC); T[k] = times[idx[k]]; }
        scan = motionMod.fromTensor(grid, n, T);
        gate = motionMod.makeGate(scan, { courtFrac: o.courtFrac });
        rise = motionMod.makeRise(scan, {});
        say(`picture        ${n} samples, court is ${scan.roi.cellCount} cells` +
            (scan.roi.empty ? ' — none found, so the gate is blind' : ''));
        if (scan.roi.empty) { gate = null; rise = null; }
      } else say('picture        too few samples to be worth reading');
    }

    /* ---- the serves ---- */
    recs = serveMod.findServes(aligned, a.hits, tune, a.opt,
      { faultGap: o.faultGap, maxClip: o.maxClip, gate, rise });
  } finally {
    decode.rmTmp(tmp);
  }

  /* ---- out ---- */
  const cut = recs.filter(r => !r.dropped);
  const kept = cut.reduce((x, r) => x + r.dur, 0);
  const reel = cut.reduce((x, r) => x + (r.reelDur || 0), 0);
  say('\n' + emit.summary(recs, aligned, a) + '\n');

  const notes = [
    (list && list.title) || slug,
    `${cut.length} rallies · ${emit.clock(kept)} of tennis` + (reel ? `, trimmed from the reel's ${emit.clock(reel)}` : ''),
    (boardEvents ? 'Point endings read off the burnt-in scoreboard; ' : 'Point endings from the umpire\'s taps; ') +
      'serve found by ear. Tuning: ' + parse.TUNE_KEYS.map(k => `${k}=${tune[k]}s`).join(' '),
    `Times are in ${path.basename(video)}'s own timeline — leave OFFSET at 0.`
  ];
  const job = { slug, defaultSrc: path.basename(video), notes,
    segments: cut.map(r => ({ start: r.start, dur: r.dur, label: r.label })) };

  if (o.dryRun) { say('dry run — nothing written'); return; }
  const wrote = [];
  wrote.push(emit.write(path.join(outDir, slug + '-tight-cut.sh'), emit.cutScript(job)));
  wrote.push(emit.write(path.join(outDir, slug + '-tight-report.tsv'), emit.report(recs)));
  for (const f of wrote) say('wrote ' + f);

  if (o.render && cut.length) {
    const out = path.join(outDir, slug + '-tight.mp4');
    say('\nrendering…');
    const r = await renderMod.render(video, out, job.segments, caps, o, say);
    if (!r.ok) say('render failed: ' + String(r.err || '').split('\n').slice(-3).join(' '));
    else say(`wrote ${out}   (${r.seconds.toFixed(0)}s)`);
  }
  if (o.proof && cut.length) {
    const out = path.join(outDir, slug + '-proof.mp4');
    say('rendering the proof reel…');
    const r = await renderMod.proof(video, out, job.segments, caps, o, say);
    if (!r.ok) say('proof render failed: ' + String(r.err || '').split('\n').slice(-3).join(' '));
    else say(`wrote ${out}   (${r.seconds.toFixed(0)}s) — every clip should open BEFORE the serve`);
  }

  say(`\ntotal ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  say('Rallies with measured=NO in the report kept the reel\'s assumed dead time;');
  say('via=motion means the microphone missed it and the picture was used instead.');
}

main().catch(e => fail(e && e.stack ? e.stack : String(e)));
