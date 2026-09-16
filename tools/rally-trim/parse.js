/* Reading the rally reel's own exports back in.

   The reel writes two things this tool can start from: the ffmpeg script
   (`cutScriptText`, index.html) and the JSON cut list (`rrExportJson`). Both
   carry what matters — where each point ENDED — but only implicitly, so this
   inverts the arithmetic in `rrSegments` to get it back.

     end   = tap - lag + tail            (index.html, rrSegments)
     start = max(prevEnd - lead, end - max), then the min and <0 clamps

   `start` is clamped four different ways and is the thing this whole tool
   exists to replace, so it is read only for reference. `end` is never
   clamped, which is why the point end comes back exactly:

     E = start + dur - tail              ball dead, in match time

   That is the one measured quantity in the whole cut list. */
'use strict';
const fs = require('fs');

const TUNE_KEYS = ['lag', 'dead', 'lead', 'tail', 'max', 'min'];
/* Mirrors RR_TUNE_DEF (index.html). Only used when a file does not say. */
const TUNE_DEF = { lag: 1.2, dead: 12, lead: 2, tail: 2, max: 30, min: 4 };

function parseTuning(text) {
  const out = Object.assign({}, TUNE_DEF);
  let found = false;
  for (const k of TUNE_KEYS) {
    const m = new RegExp('\\b' + k + '=(-?[\\d.]+)s?').exec(text);
    if (m && isFinite(+m[1])) { out[k] = +m[1]; found = true; }
  }
  return { tune: out, found };
}

/* The generated script, which is what most people will have to hand. */
function parseScript(text) {
  const segs = [];
  const re = /"\s*(-?[\d.]+)\s+(-?[\d.]+)\s*"\s*(?:#\s*(.*))?/g;
  let m;
  while ((m = re.exec(text))) {
    const start = +m[1], dur = +m[2];
    if (!isFinite(start) || !isFinite(dur)) continue;
    segs.push({ start, dur, label: (m[3] || '').trim() });
  }
  if (!segs.length) throw new Error('no SEG entries found — is this a rally reel cut script?');

  const { tune, found } = parseTuning(text);
  const title = (/^#\s*(.+?)\s*$/m.exec(text) || [, ''])[1];
  return { segs, tune, tuneFromFile: found, title, source: 'script' };
}

/* The JSON cut list is richer and says its own tuning, so prefer it. */
function parseJson(text) {
  const j = JSON.parse(text);
  if (!j || !Array.isArray(j.segments)) throw new Error('not a rally reel cut list (no .segments)');
  const tune = Object.assign({}, TUNE_DEF, j.tuning || {});
  const segs = j.segments.map(s => ({
    start: s.start,
    dur: s.duration != null ? s.duration : (s.end - s.start),
    end: s.end,
    label: [s.n + '.', 'set ' + s.set, 'game ' + s.game + ',', s.scoreBefore + ',', s.wonBy]
      .filter(Boolean).join(' '),
    meta: {
      set: s.set, game: s.game, gameOfMatch: s.gameOfMatch,
      scoreBefore: s.scoreBefore, wonBy: s.wonBy, tags: s.tags
    }
  }));
  const title = j.match ? [j.match.p1, 'vs', j.match.p2].filter(Boolean).join(' ') : '';
  return { segs, tune, tuneFromFile: !!j.tuning, title, source: 'json' };
}

/* Point ends in MATCH time, which is what the reel's timecodes are in.
   Aligning those to the file on disk is align.js's problem. */
function toPoints(parsed) {
  const { tune } = parsed;
  return parsed.segs.map((s, i) => {
    const end = s.end != null ? s.end : s.start + s.dur;
    return {
      n: i + 1,
      matchEnd: end - tune.tail,      // ball dead, match time
      reelStart: s.start,             // what the reel guessed, for comparison
      reelDur: s.dur,
      label: s.label,
      meta: s.meta || null
    };
  });
}

function load(file) {
  const text = fs.readFileSync(file, 'utf8');
  const parsed = /^\s*[[{]/.test(text) ? parseJson(text) : parseScript(text);
  parsed.points = toPoints(parsed);
  return parsed;
}

module.exports = { load, parseScript, parseJson, parseTuning, toPoints, TUNE_DEF, TUNE_KEYS };
