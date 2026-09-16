# rally-trim — cutting a match down to the tennis, from the scoreboard on it

The [rally reel](rally-reel.md) knows exactly where every point **ended**,
because somebody tapped it, and has no measurement at all of where any point
**started** — so it assumes a fixed gap and keeps everything after it. That
assumption is the dead weight.

```bash
node tools/rally-trim.js --check                            # once, per machine
node tools/rally-trim.js match.mp4 --board-preview          # check the box
node tools/rally-trim.js match.mp4 --proof                  # cut it
```

One command, one decode of the file, an .mp4 at the end of it.

## Start here

**This is not the Auto-cut tab.** That tab is for footage nobody reffed, it
works by ear alone, and on a big file it plays the recording through at 4× —
which is where "about 15 minutes left" comes from. Nothing in this tool runs in
the browser, and the app is unchanged by it.

1. **`--check`** — says whether `ffmpeg`, `ffprobe` and Node are present, how
   many cores it will use, and which encoder it will render with. Worth running
   before pointing anything at an eight-gigabyte file. It prints install lines
   for whatever is missing and exits non-zero, so it works as a precondition.

2. **`--board-preview`** — writes PNG crops of the scoreboard it found, taken
   from five points across the match. Each should be a readable scoreboard and
   nothing else. This is the one manual step and it is not a formality: if the
   box is wrong, everything downstream is wrong in a way that still looks
   plausible. If it grabbed the wrong thing, say where it is:
   `--board x,y,w,h`.

3. **The cut.** `--proof` also writes a reel of a couple of seconds around every
   clip's opening, which is how you check the whole thing in about five minutes.
   Add `--dry-run` to see the report without encoding anything.

### Do I need the cut list?

**No.** The scoreboard is enough on its own — point endings come off the plate
and the serve off the soundtrack, neither of which needs the taps. The cut list
only supplies labels: set, game, score before the point, who won it.

If you want those labels, export it from the match itself — **Archive → the
match → 🎬 Rally reel → ⬇ ffmpeg script** — and pass it as the second argument:

```bash
node tools/rally-trim.js match.mp4 fgta-alice-vs-bob-cut.sh --proof
```

The tool compares the number of board changes against the number of points in
the list and says so if they disagree, rather than zipping them together and
mislabelling everything after the first discrepancy.

### Long recordings

The soundtrack is decoded to 16 kHz mono and held once — 230 MB per hour of
recording. An earlier version held it three times over, which was fine for the
90-minute match it was written against and about 2.8 GB for a four-hour one.
The file's own size does not matter much; its *duration* does.

---

## What the reel is actually doing

From `rrSegments` in `index.html`:

```js
const end   = tap - tune.lag + tune.tail;
const serve = prev - tune.lag + tune.dead;     // prev = the PREVIOUS tap
let start   = Math.max(serve - tune.lead, end - tune.max);
```

`end` is measured. `start` is arithmetic. On a real 154-rally cut list at the
defaults:

| | |
|---|---|
| clips whose start is pure arithmetic | **113 of 154** — each exactly `dead - lead - tail` = 8.00s after the previous clip ended |
| clips pinned at the `max` cap | **40**, grabbing 30s backwards however long the rally was |
| mean clip | **16.0s** |
| ball in play, club singles | **about 5–8s** |

Raising `dead` only trades one error for the other: real between-point time is
eight seconds after a quick point and thirty after the ball goes to the back
fence, and clips that open *after* the serve are the failure that ruins a cut.

## The scoreboard settles the endings

If the plate is burnt into the footage, every change in it is a scored point —
already timestamped in the timeline of the file you have. That is worth more
than it sounds. It means **no alignment**: no offset to nudge, and no problem
when set breaks were cut out before you got the file, which a single `OFFSET`
cannot express at all.

It works because of what the scoreboard export does *not* draw.
`sbxDrawFrame` has no clock — *"There is deliberately no match clock here any
more"* (`index.html:13807`) — and `overlay.html:287` states the general rule:
*"The clock is the only thing that moves on its own; everything else changes
only when a point is scored."*

**There is no OCR here, and that is the point.** `docs/scoring.md` designs a
scoreboard *reader* — binarise, connected components, cluster this recording's
glyphs, majority-vote, reject illegal successors — and costs it at "300–400
lines and a day". That is the right design for *what does it say*. This asks
*when did it change*, which is a frame difference over a small crop: faster,
and indifferent to the font, the position and the scale — which matters,
because a plate composited in Resolve is not where the export put it.

Two guards, both self-calibrating:

- **Anything changing faster than a scoreline is thrown out.** A point ends at
  most about three times a minute; a drawn clock ticks at 1/s and a patch of
  court moves at the frame rate. This is what lets a *loose* crop still work —
  the court that strayed into the box disqualifies itself. On the test fixture
  a box twice the right size still returns exactly the real changes and
  nothing else.
- **A fade is not a point.** Every cell changing at once is a cut or the
  overlay appearing, not a score.

Aimed at the court by mistake, it says so rather than reporting hundreds of
points.

### Finding the plate

Detected, not assumed, because Resolve may have moved it. A burnt-in graphic is
the one thing in frame that is **sharp** and **bursty** — strong edges, and
changing in only a few percent of frames. Players are neither; grass and fence
have nothing like the edge energy of text on a solid plate.

That "bursty" took a second attempt and the first one is worth recording: mean
frame difference is the obvious statistic and it is wrong, because the part of
a scoreboard worth finding is the part that *changes*. A digit flipping 0→15
moves by the full contrast of the graphic, scores like a player on a mean, and
gets thrown out with them — leaving the detector clinging to whichever corner
of the plate never updates. *How often* a pixel changes separates them cleanly.

**Check it once, with `--board-preview`**, which writes PNG crops from five
points in the match. Each should be a readable scoreboard and nothing else. If
not, say where it is: `--board x,y,w,h`.

## The serve still has to be heard

The scoreboard cannot help with this — it marks endings, not beginnings. So the
serve is found by working **backward** from the ending the board just gave:

1. group the strikes inside this point's window by `maxGap`
2. take the group the rally ended on
3. keep absorbing earlier groups while the gap is under `faultGap`
4. the serve is the first **hard** strike in what is left

Step 3 keeps faults, lets and second serves — a fault and its second serve are
five to twelve seconds apart, ordinary dead time is longer, and the window
cannot reach back past the previous point anyway. Step 4 stops the clip opening
on a ball bounce; bounces are real transients and the detector is right to find
them, but a bounce is never as hard as a serve. That is `acCluster`'s own rule,
applied to picking the first strike rather than to keeping the run.

The detector is not reimplemented — **AC-CORE** and **AV-CORE** are pulled out
of `index.html` by `test/extract.js`, the way `test/floor.test.js` and
`test/vision-core.test.js` already drive them, so this cannot drift from what
the app ships. Only AV-SCAN is replaced, by ffmpeg, because it is browser-only
by construction.

**Points nobody heard** get one more chance before falling back to arithmetic:
the picture is asked when *both ends of the court* got busy. Much weaker than
hearing the strike — the dead time between points is not still, people walk
back and towel off — which is why it wants both ends rather than any motion at
all, and why the report labels those points `via=motion` so they can be
checked. Anything still unmeasured falls back to the reel's arithmetic and is
labelled `via=assumed`. A guessed start that is not marked as a guess is the
thing worth avoiding.

### The court next door

Audio alone cannot solve this and [auto-cut](auto-cut.md) says so outright.
Working backward from a known ending helps, but a neighbour's rally close
enough to look like a fault still pulls the start with it. So the picture is
checked, reusing `avROI`, `avSeries` and `avApply` unchanged;
`test/tensors.js` already has an `'adjacent'` scenario built for exactly this.

Measured on a simulated match with a busy neighbouring court throughout:

| | kept | median serve error | 90th | opens **after** the serve |
|---|---|---|---|---|
| by ear alone | 38:12 | 0.00s | 9.74s | **0** |
| with the picture | **33:29** | 0.00s | **0.40s** | **0** |

against a reel cut of 50:17. The last column is the one that matters, and the
failure is deliberately lopsided: a clip that opens two seconds early is fine,
one that opens after the serve is not.

## Speed

One decode of the file, split across cores, feeding everything:

```
[0:v]split=2[b][m];
[b]crop=BOARD,fps=4,scale=...   -> the scoreboard
[m]fps=10,scale=96:54           -> the AV-CORE motion tensor
```

The audio comes off its own concurrent `-vn` pass rather than the same slices,
because chunking it would put a seam in the RMS envelope every few minutes and
`-vn` demuxing is cheap enough that there is nothing to win.

The render is one pass — `select` plus `setpts`, so one decode and one encode
with no join points for the audio to drift across — on whatever encoder the
machine has. `h264_nvenc`, `h264_videotoolbox` and `h264_qsv` are tried in that
order, and an ffmpeg that merely *lists* one without a usable device falls back
to `libx264` rather than failing the run. `--x264` forces it.

`--jobs` sets the decoders; the default is half your cores, because ffmpeg
threads its own decode and oversubscribing makes it slower, not faster.

## Why there is no cloud API in here

Not principle — speed. Uploading an hour and a half of video takes longer than
decoding it locally, and *did these pixels change* is a frame difference, not
something a model is better at. A vision API would genuinely help if the
scoreboard were an unknown third-party one whose digits had to be read; that is
not this case, and reading digits is not needed anyway.

## Outputs

| | |
|---|---|
| `<slug>-tight.mp4` | the cut. `--no-render` if you would rather run it later |
| `<slug>-tight-report.tsv` | one row per rally: where the start came from (`audio` / `motion` / `assumed`), strikes, faults, court ratio, and what it saved against the reel |
| `<slug>-tight-cut.sh` | the same shape the reel's `cutScriptText` writes, so it is a drop-in. `OFFSET` stays 0 |
| `<slug>-proof.mp4` | with `--proof` |

**`--proof` is the check worth doing.** A couple of seconds around every clip's
opening, back to back: every one should open before the ball is struck, and you
will have checked 154 boundaries in about five minutes instead of thirty.

## Options

```
--board x,y,w,h  the scoreboard's box, if you would rather say than have it found
--board-preview  write PNG crops of what it found and stop
--no-board       ignore the scoreboard; locate the taps by ear instead
--no-motion      skip the picture pass
--fault-gap N    earlier strikes within N seconds are a fault or a let (14)
--max-clip N     safety rail on clip length (45)
--sens N         strike threshold; higher is fussier (1.2)
--board-lag N    ref's reaction, subtracted from each board change
--proof / --no-render / --x264 / --dry-run / --jobs N
```

`--sens` is the one to reach for, and the strikes-per-minute figure says which
way: a real singles match runs 15–25. Far below and it is missing the ball; far
above and it is hearing the next court, the wind or a crowd.

## Without a scoreboard

`--no-board`, or footage with no plate on it, falls back to v1's route: locate
the taps by ear, matching the *relative spacing* of several point endings
against the audio, with an offset that is allowed to **step** at the long tap
gaps where an excision must be. It reports the splices it found and the spread
of its residuals, and marks as `unaligned` any stretch it could not place
rather than guessing. That path needs the reel's cut list; the scoreboard path
does not, and treats the cut list as labels only.

## Tests

```bash
node test/trim.test.js       # the parts
node test/trim-e2e.test.js   # the whole thing
```

Neither needs ffmpeg or a video. The first drives serve-finding, alignment and
the board reader with synthetic ground truth — a fault, bounces before the
serve, a neighbouring court at two distances, a spliced recording, a ticking
clock that must be excluded, a fade that is not two extra points, and a crop
aimed at the court, which must refuse rather than report hundreds of points.

The second runs the real CLI against `test/fake-ffmpeg.js`, an ffmpeg that
answers the command lines the tool builds with synthetic frames and samples
from a match whose every serve and ending is known. That is what covers the
wiring — the filter graph, the chunk boundaries, the board file the workers
stage on disk — and it asserts the thing that matters: **no clip opens after
the serve was struck.**
