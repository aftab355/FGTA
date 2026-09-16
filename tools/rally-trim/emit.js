/* What comes out: a cut script, a report, and a way to check the result
   without watching the whole thing.

   The cut script is deliberately the same shape `cutScriptText` (index.html)
   writes, so it is a drop-in replacement for the one the reel exported —
   including the shell quoting, which is there for a reason: the source
   filename is interpolated into the script, and `$(…)` inside double quotes
   expands. Times are already in the timeline of the file you have, so OFFSET
   stays 0. */
'use strict';
const fs = require('fs');

function shComment(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '').slice(0, 200);
}
function shQuote(s) {
  return "'" + String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/'/g, "'\\''") + "'";
}
/* The slug lands unquoted in OUT="${2:-<slug>-tight.mp4}", so it has to be
   inert on its own. It is only ever a filename stem, so reducing it to the
   characters a filename wants costs nothing and closes the hole. */
function slugSafe(s) {
  const out = String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'rally-trim';
}
function clock(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}

function cutScript(job) {
  return [
    '#!/usr/bin/env bash',
    '#',
    ...job.notes.map(l => '# ' + shComment(l)),
    '#',
    '# Usage:  bash ' + slugSafe(job.slug) + '-tight-cut.sh  <source-file>  [output-file]',
    '# Needs:  ffmpeg and awk on PATH. On Windows, run it from Git Bash or WSL.',
    '',
    'set -euo pipefail',
    '',
    'DEFAULT_SRC=' + shQuote(job.defaultSrc || 'match.mp4'),
    'SRC="${1:-$DEFAULT_SRC}"',
    'OUT="${2:-' + slugSafe(job.slug) + '-tight.mp4}"',
    'OFFSET="${OFFSET:-0}"        # already in the source file\'s own timeline',
    '',
    '# start duration   (one line per rally, in order)',
    'SEG=(',
    ...job.segments.map(s => `  "${s.start.toFixed(2)} ${s.dur.toFixed(2)}"   # ${shComment(s.label)}`),
    ')',
    '',
    'WORK="$(mktemp -d)"',
    'trap \'rm -rf "$WORK"\' EXIT',
    '',
    '# Each rally is extracted on its own. -ss before -i seeks fast; the re-encode',
    '# is what makes the cut land on the frame asked for rather than on the nearest',
    '# keyframe, which with -c copy can be several seconds of walking about.',
    'i=0',
    'for s in "${SEG[@]}"; do',
    '  set -- $s',
    '  i=$((i+1))',
    '  printf "rally %d/%d\\n" "$i" "${#SEG[@]}"',
    '  START="$(awk -v a="$1" -v b="$OFFSET" \'BEGIN{printf "%.2f", a+b}\')"',
    '  ffmpeg -nostdin -loglevel error -y \\',
    '    -ss "$START" -i "$SRC" -t "$2" \\',
    '    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \\',
    '    -c:a aac -b:a 160k -ac 2 -ar 48000 \\',
    '    "$WORK/$(printf "%04d" $i).mp4"',
    '  printf "file \'%s\'\\n" "$WORK/$(printf "%04d" $i).mp4" >> "$WORK/list.txt"',
    'done',
    '',
    '# Same codec and sample rate throughout, so joining them is a copy.',
    'ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$WORK/list.txt" -c copy "$OUT"',
    'printf "\\n%s\\n" "wrote $OUT"'
  ].join('\n') + '\n';
}

/* One decode and one encode instead of 154 of each, and no join points for the
   audio to drift across. Long filter string, but ffmpeg is fine with it. */
function singlePassScript(job) {
  const terms = job.segments.map(s =>
    `between(t,${s.start.toFixed(3)},${(s.start + s.dur).toFixed(3)})`).join('+');
  return [
    '#!/usr/bin/env bash',
    '#',
    ...job.notes.map(l => '# ' + shComment(l)),
    '#',
    '# One pass: select the kept ranges and restamp, rather than cutting and',
    '# concatenating. Slower to start (it reads the whole file) but there are no',
    '# join points, so the audio cannot drift across them.',
    '',
    'set -euo pipefail',
    /* Single-quoted, for the same reason cutScript does it: this is the one
       piece of caller text that lands in the script itself, and inside double
       quotes $( ) expands. */
    'DEFAULT_SRC=' + shQuote(job.defaultSrc || 'match.mp4'),
    'SRC="${1:-$DEFAULT_SRC}"',
    'OUT="${2:-' + slugSafe(job.slug) + '-tight.mp4}"',
    '',
    'ffmpeg -nostdin -y -i "$SRC" \\',
    `  -vf "select='${terms}',setpts=N/FRAME_RATE/TB" \\`,
    `  -af "aselect='${terms}',asetpts=N/SR/TB" \\`,
    '  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \\',
    '  -c:a aac -b:a 160k -ac 2 -ar 48000 \\',
    '  "$OUT"',
    'printf "\\n%s\\n" "wrote $OUT"'
  ].join('\n') + '\n';
}

/* The fastest way to check 154 boundaries: a couple of seconds around each
   clip's opening, back to back. If a clip opens after the ball is struck you
   will hear it immediately, and you will have checked the whole match in about
   five minutes instead of thirty. */
function proofScript(job, before, after) {
  const b = before == null ? 0.8 : before, a = after == null ? 1.2 : after;
  const terms = job.segments.map(s =>
    `between(t,${Math.max(0, s.start - b).toFixed(3)},${(s.start + a).toFixed(3)})`).join('+');
  return [
    '#!/usr/bin/env bash',
    '#',
    '# Proof reel: ' + b + 's before to ' + a + 's after each clip\'s opening, in order.',
    '# Every one should open BEFORE the serve is struck. If any opens after it,',
    '# the serve for that rally was found late — check that rally in the report.',
    '',
    'set -euo pipefail',
    'DEFAULT_SRC=' + shQuote(job.defaultSrc || 'match.mp4'),
    'SRC="${1:-$DEFAULT_SRC}"',
    'OUT="${2:-' + slugSafe(job.slug) + '-proof.mp4}"',
    '',
    'ffmpeg -nostdin -y -i "$SRC" \\',
    `  -vf "select='${terms}',setpts=N/FRAME_RATE/TB" \\`,
    `  -af "aselect='${terms}',asetpts=N/SR/TB" \\`,
    '  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \\',
    '  -c:a aac -b:a 160k -ac 2 -ar 48000 \\',
    '  "$OUT"',
    'printf "\\n%s\\n" "wrote $OUT"'
  ].join('\n') + '\n';
}

const COLS = ['n', 'start', 'end', 'dur', 'used', 'measured', 'via', 'aligned', 'strikes', 'faults',
  'serve', 'videoEnd', 'residual', 'courtRatio', 'conf', 'reelStart', 'reelDur', 'saved', 'label', 'note'];

function report(recs) {
  const num = v => v == null || !isFinite(v) ? '' : (Math.round(v * 100) / 100).toFixed(2);
  const lines = [COLS.join('\t')];
  for (const r of recs) {
    lines.push([
      r.n, num(r.start), num(r.end), num(r.dur),
      r.dropped ? 'DROPPED' : 'yes',
      r.measured ? 'yes' : 'NO', r.via || '', r.aligned ? 'yes' : 'NO',
      r.strikes, r.faults, num(r.serve), num(r.videoEnd), num(r.residual),
      num(r.courtRatio), num(r.conf), num(r.reelStart), num(r.reelDur), num(r.saved),
      String(r.label || '').replace(/\t/g, ' '),
      String(r.note || '').replace(/\t/g, ' ')
    ].join('\t'));
  }
  return lines.join('\n') + '\n';
}

function summary(all, aligned, audio) {
  const recs = all.filter(r => !r.dropped);
  const dropped = all.length - recs.length;
  const kept = recs.reduce((a, r) => a + r.dur, 0);
  const reel = recs.reduce((a, r) => a + (r.reelDur || 0), 0);
  const via = k => recs.filter(r => r.via === k).length;
  const board = aligned.source === 'board';
  const L = [];

  L.push(`rallies            ${recs.length}`);
  L.push(`kept               ${clock(kept)}` +
    (reel ? `   (reel was ${clock(reel)}, ${clock(reel - kept)} removed)` : ''));
  L.push(`mean clip          ${(kept / Math.max(1, recs.length)).toFixed(1)}s` +
    (reel ? `   (reel ${(reel / Math.max(1, recs.length)).toFixed(1)}s)` : ''));

  /* Where each START came from, which is the number to read: the tool exists
     to stop these being assumed. */
  L.push(`starts             ${via('audio')} heard, ${via('motion')} from the picture, ` +
    `${via('assumed')} assumed`);
  if (dropped) L.push(`dropped            ${dropped}   — see the report; these are NOT in the cut`);

  if (audio) {
    L.push(`strikes            ${audio.hits.length}  (${audio.perMin.toFixed(1)}/min — a real singles match runs 15-25)`);
    if (audio.split) L.push(`strike floor       ${audio.split.chosen}${audio.split.applied ? '' : ', not applied'}`);
  }

  /* Where the ENDINGS came from. On the board route there is no alignment to
     report and nothing assumed about ball flight — the plate changed when the
     ref tapped, in this file's own timeline. */
  if (board) {
    L.push(`point endings      read off the scoreboard, in this file's own timeline`);
    if (aligned.expected != null) {
      L.push(`                   ${aligned.points.length} changes against the cut list's ${aligned.expected} points` +
        (aligned.mismatch ? `  — ${Math.abs(aligned.mismatch)} ${aligned.mismatch > 0 ? 'more' : 'fewer'}, so labels may be off` : ', which agree'));
    }
  } else {
    const unaligned = recs.filter(r => !r.aligned).length;
    L.push(`point endings      from the taps, located by ear`);
    L.push(`points located     ${recs.length - unaligned} of ${recs.length}` +
      (unaligned ? `   (${unaligned} could not be found in the file)` : ''));
    L.push(`alignment spread   ${aligned.spread == null ? 'n/a' : aligned.spread.toFixed(2) + 's'} median residual` +
      (aligned.spread != null && aligned.spread > 1.5 ? '   — loose; check the proof reel carefully' : ''));
    L.push(`ball flight        ${(aligned.endPad || 0).toFixed(2)}s assumed between the last strike and the ball being dead`);
    if (aligned.splices.length) {
      L.push('');
      L.push('splices found (time removed from the recording before you got it):');
      let tot = 0;
      for (const sp of aligned.splices) {
        tot += sp.removed;
        L.push(`  after rally ${String(sp.afterRally).padStart(3)}  ${clock(sp.removed)} removed   (tap gap was ${clock(sp.gap)})`);
      }
      L.push(`  total ${clock(tot)}`);
    } else {
      L.push(`splices            none found — the file looks like one continuous take`);
    }
  }
  return L.join('\n');
}

function write(file, text) { fs.writeFileSync(file, text); return file; }

module.exports = { slugSafe, cutScript, singlePassScript, proofScript, report, summary, write, clock, shComment, shQuote, COLS };
