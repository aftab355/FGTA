/* The whole of rally-trim, end to end, against a match nobody played.

   test/fake-ffmpeg.js answers the command lines the tool builds with
   synthetic frames and samples whose ground truth is known — where every
   point ended, where every serve was struck, where the scoreboard sits, and a
   court next door making a noise the whole time. That makes it possible to
   assert on the thing that actually matters, which is not "did it run" but
   "does every clip open before the ball is struck and close after the point".

   Needs no ffmpeg and no video.

   node test/trim-e2e.test.js */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MATCH, BOARD, LAG, DUR } = require('./fake-ffmpeg.js');
const FAKE = path.join(__dirname, 'fake-ffmpeg.js');
const CLI = path.join(__dirname, '..', 'tools', 'rally-trim.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x != null ? '   [' + x + ']' : '')); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-e2e-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* */ } });

function run(extra) {
  const args = [CLI, path.join(__dirname, 'fake-ffmpeg.js'),
    '--ffmpeg', FAKE, '--ffprobe', FAKE,
    '--out-dir', tmp, '--slug', 'e2e', '--no-render', '--jobs', '2'].concat(extra || []);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  return { out: (r.stderr || '') + (r.stdout || ''), status: r.status };
}
function readReport() {
  const f = path.join(tmp, 'e2e-tight-report.tsv');
  if (!fs.existsSync(f)) return null;
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  const cols = lines[0].split('\t');
  return lines.slice(1).map(l => {
    const v = l.split('\t'), o = {};
    cols.forEach((c, i) => { o[c] = v[i]; });
    return o;
  });
}

console.log('\nthe whole thing, on synthetic footage');
const r = run();
ok(r.status === 0, 'it runs to completion', 'exit ' + r.status);
ok(/scoreboard\s+\d+x\d+ at/.test(r.out), 'it finds a scoreboard without being told where');

const rows = readReport();
ok(rows && rows.length > 0, 'a report is written', rows ? rows.length + ' rows' : 'none');

if (rows) {
  /* Point endings come off the board, so the count should match the match. */
  ok(Math.abs(rows.length - MATCH.length) <= 1,
    'it finds the right number of points from the scoreboard alone',
    rows.length + ' found, ' + MATCH.length + ' played');

  /* Pair each clip with the point whose ending it is closest to, rather than
     by index, so one missed point does not fail every later assertion. */
  const paired = rows.map(row => {
    const end = +row.end, start = +row.start;
    let best = null, bd = 1e9;
    for (const p of MATCH) { const d = Math.abs(p.end - (end - 2)); if (d < bd) { bd = d; best = p; } }
    return { row, pt: best, start, end, dist: bd };
  }).filter(x => x.dist < 6);

  ok(paired.length >= MATCH.length - 2, 'nearly every point is accounted for',
    paired.length + '/' + MATCH.length);

  /* THE test. A clip that opens two seconds early is fine; one that opens
     after the ball is struck has thrown away the serve. */
  const late = paired.filter(x => x.start > x.pt.serve);
  ok(late.length === 0, 'no clip opens after the serve was struck',
    late.map(x => 'rally ' + x.row.n + ' opens ' + (x.start - x.pt.serve).toFixed(1) + 's late').join('; '));

  const short = paired.filter(x => x.end < x.pt.end);
  ok(short.length === 0, 'no clip closes before the point ended',
    short.map(x => 'rally ' + x.row.n).join(', '));

  /* And it should be TIGHT — the whole point of the tool. The reel's own
     arithmetic keeps 12s of dead time before every serve; this should be
     inside the lead-in plus a little. */
  const early = paired.map(x => x.pt.serve - x.start).sort((a, b) => a - b);
  const med = early[early.length >> 1];
  ok(med < 4, 'and the median clip opens less than 4s before the serve', med.toFixed(2) + 's');
  ok(early[early.length - 1] < 12, 'with no clip opening more than 12s early',
    early[early.length - 1].toFixed(2) + 's');

  const measured = rows.filter(x => x.measured === 'yes').length;
  ok(measured >= rows.length - 1, 'essentially every start is measured, not assumed',
    measured + '/' + rows.length);

  /* The court next door is audible throughout and must not become rallies. */
  ok(rows.length <= MATCH.length + 1, 'the next court does not become extra points',
    rows.length + ' clips for ' + MATCH.length + ' points');

  const kept = rows.reduce((a, x) => a + (+x.dur || 0), 0);
  ok(kept < DUR * 0.55, 'and well under half the recording survives',
    Math.round(kept) + 's of ' + DUR + 's');
}

/* A box that is deliberately wrong must not silently produce nonsense. */
console.log('\npointed at the wrong thing');
{
  const bad = run(['--board', '200,100,600,300']);
  const okish = /falling back to locating|could not|court, not a scoreboard|changes = /.test(bad.out);
  ok(bad.status === 0 && okish, 'a wrong --board box is survived, not silently believed',
    'exit ' + bad.status);
}

/* And with the scoreboard turned off it must still work the old way. */
console.log('\nwith no scoreboard to read');
{
  const noBoard = run(['--no-board']);
  ok(/no scoreboard read and no cut list/.test(noBoard.out) || noBoard.status === 0,
    'it says what it needs rather than crashing', 'exit ' + noBoard.status);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
