#!/usr/bin/env node
/* rally-trim — take the dead time out of a rally reel cut.

   The reel knows exactly where every point ENDED, because somebody tapped it.
   It has no idea where any point STARTED, so it assumes a fixed 12 seconds of
   dead time and keeps everything after that. This measures the start instead,
   using the strike detector the app already ships, and keeps the taps for the
   ends where they are unbeatable.

     node tools/rally-trim.js  <cut-list>  <video>  [options]

   `cut-list` is either the reel's ffmpeg script or its JSON cut list.

   Nothing is uploaded and nothing is re-encoded here — this works out the
   edit and writes a script that performs it, the same division of labour the
   rest of the repo uses. */
'use strict';
const fs = require('fs');
const path = require('path');

const parse = require('./rally-trim/parse.js');
const audio = require('./rally-trim/audio.js');
const alignMod = require('./rally-trim/align.js');
const serveMod = require('./rally-trim/serve.js');
const motionMod = require('./rally-trim/motion.js');
const emit = require('./rally-trim/emit.js');

const USAGE = `
rally-trim — measure where each point started, instead of assuming it

  node tools/rally-trim.js <cut-list> <video> [options]

  <cut-list>   the rally reel's ffmpeg script or its JSON cut list
  <video>      the recording those timecodes refer to

Options
  --out-dir D      where to write (default: alongside the cut list)
  --slug S         basename for the outputs (default: from the cut list)
  --dry-run        work out the edit and report, write nothing
  --proof          also write a proof reel script: a couple of seconds around
                   every clip's opening, back to back, to check the cut fast
  --single-pass    also write a one-decode/one-encode render script
  --no-motion      skip the picture pass (faster; worse next to a busy court)
  --fault-gap N    earlier strikes within N seconds are a fault or a let (14)
  --max-clip N     safety rail on clip length (45)
  --lead N         seconds kept before the serve (from the cut list's tuning)
  --tail N         seconds kept after the point (from the cut list's tuning)
  --sens N         strike threshold; higher is fussier (1.2)
  --tol N          how far a point may sit from where it was predicted (5)
  --court-frac N   how much on-court motion a serve needs (0.15)
  --ffmpeg P       path to ffmpeg      --ffprobe P   path to ffprobe
`;

function args(argv) {
  const o = { _: [], motion: true };
  const num = (k, v) => { if (!isFinite(+v)) fail(`--${k} needs a number`); return +v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE); process.exit(0); }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--proof') o.proof = true;
    else if (a === '--single-pass') o.singlePass = true;
    else if (a === '--no-motion') o.motion = false;
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--slug') o.slug = argv[++i];
    else if (a === '--ffmpeg') o.ffmpeg = argv[++i];
    else if (a === '--ffprobe') o.ffprobe = argv[++i];
    else if (a === '--fault-gap') o.faultGap = num('fault-gap', argv[++i]);
    else if (a === '--max-clip') o.maxClip = num('max-clip', argv[++i]);
    else if (a === '--lead') o.lead = num('lead', argv[++i]);
    else if (a === '--tail') o.tail = num('tail', argv[++i]);
    else if (a === '--sens') o.sens = num('sens', argv[++i]);
    else if (a === '--tol') o.tol = num('tol', argv[++i]);
    else if (a === '--court-frac') o.courtFrac = num('court-frac', argv[++i]);
    else if (a[0] === '-') fail('unknown option ' + a);
    else o._.push(a);
  }
  return o;
}

function fail(msg) { process.stderr.write('rally-trim: ' + msg + '\n'); process.exit(1); }
function say(msg) { process.stderr.write(msg + '\n'); }

async function main() {
  const o = args(process.argv.slice(2));
  if (o._.length < 2) { process.stdout.write(USAGE); process.exit(o._.length ? 1 : 0); }
  const [cutFile, video] = o._;
  for (const f of [cutFile, video]) if (!fs.existsSync(f)) fail('no such file: ' + f);

  /* ---- the cut list ---- */
  let list;
  try { list = parse.load(cutFile); }
  catch (e) { fail('could not read ' + cutFile + ': ' + e.message); }
  const tune = Object.assign({}, list.tune);
  if (o.lead != null) tune.lead = o.lead;
  if (o.tail != null) tune.tail = o.tail;
  const slug = o.slug || path.basename(cutFile).replace(/\.(sh|json)$/i, '').replace(/-cut(list)?$/i, '');
  const outDir = o.outDir || path.dirname(path.resolve(cutFile));

  const span = list.points.length ? list.points[list.points.length - 1].matchEnd : 0;
  say(`cut list       ${list.points.length} points, match spans ${emit.clock(span)} (${list.source})`);
  say(`tuning         ` + parse.TUNE_KEYS.map(k => `${k}=${tune[k]}`).join(' ') +
      (list.tuneFromFile ? '' : '   [not stated in the file — assumed]'));

  let dur = null;
  try { dur = audio.ffprobeDuration(video, o.ffprobe); } catch (e) { /* reported below */ }
  if (dur) {
    say(`recording      ${emit.clock(dur)}`);
    if (span - dur > 30) say(`               ${emit.clock(span - dur)} shorter than the match — expecting excisions`);
  }

  /* ---- strikes ---- */
  say('\nlistening for strikes…');
  let a;
  try {
    a = await audio.strikesFrom(video, { ffmpeg: o.ffmpeg, acTune: o.sens != null ? { sens: o.sens } : null });
  } catch (e) { fail(e.message); }
  say(`               ${a.hits.length} strikes, ${a.runs.length} runs, ${a.perMin.toFixed(1)}/min`);
  if (a.perMin < 8) say('               that is low for tennis — try --sens lower if points come back unmeasured');
  if (a.perMin > 40) say('               that is high — the next court, wind or a crowd. Try --sens higher');

  /* ---- alignment ---- */
  say('locating the match in the recording…');
  const aligned = alignMod.align(list.points, a.runs, { tol: o.tol });
  if (aligned.failed) fail('no strikes were detected at all — nothing to align to');
  say(`               ${aligned.matched} of ${list.points.length} points located, ` +
      `${aligned.splices.length} splice${aligned.splices.length === 1 ? '' : 's'}, ` +
      `residual spread ${aligned.spread == null ? 'n/a' : aligned.spread.toFixed(2) + 's'}`);
  if (!aligned.matched) fail('could not locate a single point in this recording — ' +
    'is this the right file, and does it have usable sound?');

  /* ---- serves: once by ear, then again with the picture ---- */
  const ac = a.opt;
  const sOpt = { faultGap: o.faultGap, maxClip: o.maxClip };
  say('finding the serves…');
  let recs = serveMod.findServes(aligned, a.hits, tune, ac, sOpt);

  let scan = null, gate = null;
  if (o.motion) {
    say('watching the picture (is it your court?)…');
    try {
      scan = await motionMod.scan(video, recs.map(r => ({ start: r.start, end: r.end })),
        { ffmpeg: o.ffmpeg, duration: dur, courtFrac: o.courtFrac });
    } catch (e) { say('               picture pass failed (' + e.message + ') — carrying on by ear'); }
    if (scan) {
      gate = motionMod.makeGate(scan, { courtFrac: o.courtFrac });
      say(`               ${scan.n} frames over ${scan.windows.length} windows, ` +
          `court is ${scan.roi.cellCount} cells${scan.roi.empty ? ' — could not find one, so the gate is blind' : ''}`);
      if (scan.roi.empty) {
        say('               nothing distinguishes your court from the rest of the frame;');
        say('               ignoring the picture rather than cutting on a signal that means nothing');
      } else {
        recs = serveMod.findServes(aligned, a.hits, tune, ac, Object.assign({}, sOpt, { gate }));
        /* The shipped per-clip verdict, for the report only. Nothing is
           dropped on it here: avApply pre-drops in the app's review list,
           where a wrong call is one tap to undo, and this has no review list
           to undo it in. */
        const usable = recs.filter(r => !r.dropped);
        const v = motionMod.verdicts(scan, usable, a.hits.map(h => h.t));
        if (v && v.per) {
          usable.forEach((r, i) => { if (v.per[i]) r.conf = v.per[i].conf; });
          say(`               picture confidence: best ${(v.best || 0).toFixed(2)}` +
              (v.inconclusive ? ' — inconclusive, so treat the court ratios as weak evidence' : ''));
        } else if (v && v.error) {
          say('               per-clip verdict unavailable (' + v.error + ')');
        }
      }
    } else {
      say('               no usable picture — carrying on by ear alone');
    }
  }

  /* ---- out ---- */
  const cut = recs.filter(r => !r.dropped);
  const kept = cut.reduce((x, r) => x + r.dur, 0);
  const reel = cut.reduce((x, r) => x + (r.reelDur || 0), 0);
  say('\n' + emit.summary(recs, aligned, a) + '\n');

  const notes = [
    list.title || slug,
    `${cut.length} rallies · ${emit.clock(kept)} of tennis, trimmed from the reel's ${emit.clock(reel)}`,
    `Serve found by ear per point; point endings from the umpire's taps. ` +
      `Tuning: ` + parse.TUNE_KEYS.map(k => `${k}=${tune[k]}s`).join(' ') +
      ` faultGap=${(sOpt.faultGap == null ? serveMod.DEF.faultGap : sOpt.faultGap)}s`,
    `Times are in ${path.basename(video)}'s own timeline — leave OFFSET at 0.`
  ];
  const job = {
    slug, defaultSrc: path.basename(video), notes,
    segments: cut.map(r => ({ start: r.start, dur: r.dur, label: r.label }))
  };

  if (o.dryRun) { say('dry run — nothing written'); return; }
  const wrote = [];
  wrote.push(emit.write(path.join(outDir, slug + '-tight-cut.sh'), emit.cutScript(job)));
  wrote.push(emit.write(path.join(outDir, slug + '-tight-report.tsv'), emit.report(recs)));
  if (o.singlePass) wrote.push(emit.write(path.join(outDir, slug + '-tight-onepass.sh'), emit.singlePassScript(job)));
  if (o.proof) wrote.push(emit.write(path.join(outDir, slug + '-proof.sh'), emit.proofScript(job)));
  for (const f of wrote) say('wrote ' + f);
  say('\nCheck the report before you render. Rallies with measured=NO kept the');
  say('reel\'s assumed dead time; rallies with aligned=NO were not found in the file.');
  if (o.proof) say('Then: bash ' + slug + '-proof.sh ' + path.basename(video));
}

main().catch(e => fail(e && e.stack ? e.stack : String(e)));
