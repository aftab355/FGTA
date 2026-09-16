# rally-trim — taking the dead time back out of a reel cut

The [rally reel](rally-reel.md) cuts a match from the umpire's taps, and the
taps are exact about one thing: **where every point ended**. They say nothing
at all about where a point *started*, so the reel assumes a fixed gap — `dead`,
12 seconds by default — and keeps everything after it.

That assumption is the dead weight. This tool measures the start instead.

```bash
node tools/rally-trim.js  fgta-alice-vs-bob-cut.sh  match.mp4  --dry-run --proof
```

---

## What the reel is actually doing

From `rrSegments` in `index.html`:

```js
const end   = tap - tune.lag + tune.tail;
const serve = prev - tune.lag + tune.dead;     // prev = the PREVIOUS tap
let start   = Math.max(serve - tune.lead, end - tune.max);
```

`end` is measured. `start` is arithmetic. On a real 154-rally cut list that
came out of the reel at the defaults:

| | |
|---|---|
| clips whose start is pure arithmetic | **113 of 154** — each exactly `dead - lead - tail` = 8.00s after the previous clip ended |
| clips pinned at the `max` cap | **40**, each grabbing 30s backwards from the point's end regardless of how long the rally was |
| mean clip | **16.0s** |
| ball in play, club singles | **about 5–8s** |

So most of a reel clip is the dead time the tool assumed, not the dead time
that happened. Real between-point time is nothing like constant — eight seconds
after a quick point, thirty after the ball goes to the back fence — and no
single number fits both. Setting `dead` higher only trades one error for the
other: clips that open after the serve, which is the failure that actually
ruins a cut.

## What this does instead

Keep the taps for the endings, where they are unbeatable. Find the serve by
ear, per point, in the window between one point ending and the next.

The detector is not reimplemented. It is the **AC-CORE** region of
`index.html` — the same strike detection [auto-cut](auto-cut.md) uses — pulled
out by `test/extract.js` exactly as `test/floor.test.js` drives it, so this
tool cannot drift from what the app ships. ffmpeg only supplies the samples.

The search runs **backward from the point ending**, which is the whole trick:

1. group the strikes inside the point's window by `maxGap`
2. take the group the rally ended on
3. keep absorbing earlier groups while the gap is under `faultGap`
4. the serve is the first **hard** strike in what is left

Step 3 is what **keeps faults, lets and second serves**: a fault and its second
serve are five to twelve seconds apart, ordinary dead time is longer, and the
window cannot reach back past the previous point anyway. Step 4 is what stops
the clip opening on a ball bounce — bounces are real transients and the
detector is right to find them, but a bounce is never as hard as a serve. That
is the same reasoning `acCluster` uses to decide what counts as a rally,
applied to picking the first strike rather than to keeping the run.

**A point it cannot hear falls back to the reel's arithmetic and is labelled.**
A guessed start that is not marked as a guess is the thing worth avoiding, so
`measured=NO` appears in the report and the fallback keeps the reel's own `max`
cap rather than this tool's more generous one.

## The recording is usually not the match

The reel's timecodes are match time — seconds from the first ball. The file on
disk often is not. Footage handed over with the set breaks taken out is
**shorter than the match, by an amount that changes partway through**.

`rrVideoSec` cannot express that. It is affine — one `base` plus one `drift`
for the whole match — and the exported script has the same single `OFFSET`.
Nudge it to fix the third set and you break the first.

So the offset is recovered here, and it is allowed to **step**. What makes that
tractable is that an excision is a removed *break*, and a break is a long gap
between taps: the candidate step locations are known in advance, and only the
amount removed at each has to be measured. What makes it reliable is that a
step is fitted to the **relative spacing of the next several point endings**,
not to one instant — matching a sequence is far more discriminating, and it is
what stops the search locking onto a neighbouring court.

The report prints what it found:

```
splices found (time removed from the recording before you got it):
  after rally  34  4:36 removed   (tap gap was 5:07)
  after rally  95  3:04 removed   (tap gap was 3:34)
```

### One number this deliberately does not report

A tap marks the ball going dead; the anchor in the audio is the last *strike*,
one ball flight earlier. That difference cannot be measured from taps —
a recording shifted by 0.8s and a ball that flies for 0.8s produce identical
data, and the ref's reaction and any mis-set `lag` are mixed into it too. So
the flight is an explicit assumption (`endPad`, 0.8s) rather than a measurement
dressed up as one. What *is* measured, and is the number to read, is the
**spread of the residuals** — how consistently the taps line up once the offset
is found. Loose residuals mean check the proof reel carefully.

## The court next door

Audio alone cannot solve this and [auto-cut](auto-cut.md) says so: an adjacent
court sounds exactly like yours. Working backward from a known ending helps —
a neighbour's rally cannot drag the start with it unless it is close enough to
look like a fault — but "close enough" happens often on a busy afternoon.

So the picture is checked, using the same reasoning the app's
[video analyser](video-analyzer.md) uses: a rally on the next court is, from
your camera, a still frame with a soundtrack. `avROI`, `avSeries` and `avApply`
are pulled out of `index.html` unchanged; only the **scan** is replaced, because
AV-SCAN is browser-only by construction and ffmpeg has to stand in for it. The
tensor contract is the one `test/tensors.js` already builds, including its
`'adjacent'` scenario.

Measured on a simulated match with a busy neighbouring court throughout:

| | kept | median error | 90th | worst | opens **after** the serve |
|---|---|---|---|---|---|
| by ear alone | 38:12 | 0.00s | 9.74s | 16.61s | **0** |
| with the picture | **33:29** | 0.00s | **0.40s** | 5.86s | **0** |

against a reel cut of 50:17. The last column is the one that matters, and the
failure is deliberately lopsided: a clip that opens two seconds early is fine,
one that opens after the serve is not.

Camera shake is **not** compensated — AV-SCAN searches for it, this assumes a
camera that is not moving. On handheld footage use `--no-motion`, and consider
`--fault-gap 8` to make up some of the difference by ear.

## Checking it without watching it

`--proof` writes a reel of a couple of seconds either side of **every clip's
opening**, back to back. Every one should open before the ball is struck. It is
the fastest way to check 154 boundaries — about five minutes instead of thirty
— and it is worth doing before committing to a render.

`--dry-run` works the whole edit out and writes nothing.

## Outputs

| | |
|---|---|
| `<slug>-tight-cut.sh` | the same shape the reel's `cutScriptText` writes, so it is a drop-in. Times are already in your file's timeline, so `OFFSET` stays 0 |
| `<slug>-tight-report.tsv` | one row per rally: measured or guessed, aligned or not, strikes found, serve, residual, court ratio, and what it saved against the reel |
| `<slug>-proof.sh` | with `--proof` |
| `<slug>-tight-onepass.sh` | with `--single-pass`: one decode and one encode instead of 154 of each, and no join points for the audio to drift across |

## Options

```
--dry-run        work it out and report, write nothing
--proof          also write the proof reel script
--single-pass    also write a one-decode/one-encode render script
--no-motion      skip the picture pass
--fault-gap N    earlier strikes within N seconds are a fault or a let (14)
--max-clip N     safety rail on clip length (45)
--sens N         strike threshold; higher is fussier (1.2)
--tol N          how far a point may sit from where it was predicted (5)
--court-frac N   how much on-court motion a serve needs (0.15)
```

`--sens` is the one to reach for, and the strikes-per-minute figure in the
report says which way: a real singles match runs 15–25. Far below and it is
missing the ball; far above and it is hearing the next court, the wind or a
crowd.

## What it does not do

**Work without taps.** This refines a reel cut. Footage nobody reffed has no
point endings to anchor to — use [auto-cut](auto-cut.md), which finds rallies
by ear from scratch.

**Read the scoreboard.** Nothing in the repo reads pixels off a scoreboard;
`docs/scoring.md` designs it and says plainly that none of it is built.

**Render anything.** It works out the edit and writes a script that performs
it, the same division of labour as the rest of the repo.

## Tests

```bash
node test/trim.test.js
```

No video and no ffmpeg needed. Serve-finding and alignment run against
synthetic strike trains with known ground truth — including a fault, bounces
before the serve, a neighbouring court at two different distances, a spliced
recording with a known excision, and a stretch nobody recorded, which must come
back reported rather than guessed at. The picture case reuses
`test/tensors.js`.
