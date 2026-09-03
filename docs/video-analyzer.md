# Watching the picture, not just listening

**Matches → Auto-cut**, on a video file. The audio pass finds the candidate
rallies; this one looks at each candidate and asks whether anything actually
happened on your court while those strikes were heard.

[Auto-cut](auto-cut.md) ends with a section called *The one it can't do*:

> An adjacent court in use sounds exactly like your court. There is no
> audio-only fix — the strikes are identical.

That is still true. This is the fix that isn't audio-only. A rally on the
next court is, from your camera, **a completely still frame with a
soundtrack**, and that asymmetry is cheap to measure.

---

## What this is not

It is not a ball tracker, and the distinction matters because "video analysis
of a racket sport" usually means exactly that.

A tennis ball crossing a court at 25 m/s, filmed on a phone at 30fps, is a
four-pixel smear when it is visible at all. Everything people want from ball
tracking — where it bounced, whether it was in, **who won the point** — needs
sub-frame bounce localisation from several calibrated cameras. That is what
Hawk-Eye is, and it is not a thing one phone on a fence can be talked into
doing. Anything claiming otherwise from a single consumer camera is either
running in a fixed studio rig or is wrong.

So this doesn't look for the ball. It looks for **people**, at a resolution
where a person is a large obvious blob and the ball does not exist:
96 × 54 grayscale, on a 16 × 9 grid of cells. That is enough to answer the
one question audio genuinely cannot, and no more.

**It does not score the match.** See [Who won the point](#who-won-the-point).

---

## What it measures

The scan produces one coarse map per sample — how much each of 144 cells
changed since the last sample — and every judgement is made from those.

**Where the court is.** Not by finding lines. Over a scan that only ever
looked inside candidate rallies, the busiest cells *are* the players, so
their blobs are the court. Two things stop that being naive:

- Blobs are grown by flood fill and only the ones connected to the busiest
  one — or comparable to it *and sharing its rows* — are kept. An early
  version took a bounding box over every busy cell, and a tree swaying in the
  corner of frame stretched the "court" across the whole picture, quietly
  re-admitting all the motion the court was drawn to exclude.
- The row-overlap rule exists because of a more ordinary case: one player in
  white and one in a dark shirt. Against a green court the white one produces
  roughly three times the frame difference, so a rule based on blob size
  alone decides their opponent is scenery and collapses the court onto one
  half. Two people playing each other stand on the same ground; a tree, a
  fence, a road behind the court do not.

**The midline** then splits the court's own motion mass in half, rather than
sitting at the middle of the frame, because the camera is never centred.

Then, per clip:

| | what it asks | what it can do |
|---|---|---|
| **A** | how much busier the court is than the rest of the frame | convict |
| **B** | were *both* halves of it busy at once | convict |
| **C** | does the movement line up with the strikes better than with deliberately wrong lags | acquit only |

A and B are combined into the score. **A alone can never clear the bar** —
one busy side of the court and one idle one is never enough on its own,
however busy that side is, because that is what somebody walking back to
serve looks like, and after the next court over it is the most common thing
audio gets wrong.

C is a bonus and never a penalty. The first version of it asked "does motion
spike at each strike?", which scores a genuine thirty-second rally near zero
— the motion in a real rally is high *continuously*, not in spikes — and
threw it away. What it measures now is whether the correlation between the
strike train and the motion is better at lag zero than at four deliberately
wrong lags. Uniform motion correlates equally badly at every lag, so the term
politely abstains, which is what it should do.

### The number that took three attempts

How much motion is "enough"? Both obvious answers are wrong, and both are
written into the code so they don't come back.

**Self-normalising** — score each clip against the recording's own 90th
percentile, exactly the trick the audio detector uses on transients. Correct
on real footage. Catastrophic on the file this pass exists for: if nothing of
yours is on camera, the 90th percentile is itself noise, every clip scores
full marks against it, and the pass confirms all the junk it was built to
catch.

**An absolute floor** in mean-absolute-difference units. This fails for a
duller reason — the number is meaningless without fixing the interval it is
measured over. Sampled every 100 ms a real rally scored 1.9; sampled every
290 ms the *same rally* scored 6.2, because things had moved further between
frames. Any fixed floor is secretly a claim about frame timing, camera
distance and lens.

What is actually invariant is not how much the picture changed but **where**.
Noise — sensor grain, compression blocking, grass, a flickering floodlight —
is spread evenly over the frame. Two people playing are not. So the measure
is a **ratio**: how many times busier the court is than everything outside
it. Dimensionless, survives any camera distance, exposure or frame interval,
and needs no calibration against footage nobody has seen.

### Camera shake

Handheld footage is the normal case and without compensation every frame of
it reads as wall-to-wall motion, which makes the whole pass worthless. The
camera's own movement is estimated from 1-D projection profiles — a column
sum and a row sum — because a handheld phone translates, and translation is
exactly what those see. About 1,700 operations a frame instead of 400,000 for
a 2-D search. It does not correct rotation or zoom and does not pretend to.

---

## When it refuses to act

Three safety valves, all of which suppress the *drops* rather than the
analysis, because a confident wrong drop is much worse than a shrug.

1. **No clip anywhere looks like it happened on a visible court** → the pass
   reports itself blind and drops nothing. Judged on the best clip in the
   file, not the typical one: in any real recording at least a few candidates
   are genuinely your match, so if not one of them scores, the camera is too
   far back, too dark, or pointed elsewhere. Using the *median* instead would
   call a file blind precisely when most candidates are junk — which is the
   file this pass is most useful on.
2. **No clip anywhere shows both halves busy** → the camera probably cannot
   see both players (parked behind one baseline, the far one a handful of
   pixels). B is then measuring the framing rather than the tennis, so it is
   switched off and its weight moves to A. The panel says so. The cost is
   real: with one half of the court effectively invisible, a player walking
   back can no longer be told from a player playing.
3. **A clip falls outside the stretch that was watched** — because the audio
   sliders moved after the scan — → it is marked `?` and never dropped, with
   a re-scan button.

And nothing is ever deleted. Everything lands in the same review list you
were already going to read, one tap from undone, and a clip you put back
stays back through any number of retunes.

---

## Using it

It runs by itself when you drop a video in, after the audio pass has
something to check. There is a **skip** button, and an on/off switch under
*Detection settings* that is remembered.

**Only the candidate rallies get watched**, padded by two seconds either side
and merged — not the whole recording. One consequence, and it is not
negotiable: **the picture can throw a candidate out, but it can never find a
rally the audio missed**, because it never looks where the audio heard
nothing. If rallies are being missed, that is a *Sensitivity* problem on the
audio side.

The video is **played fast** rather than decoded frame by frame, at a rate
chosen from how much footage there is. Speed costs temporal resolution — the
browser presents fewer frames the faster you play — so the achieved sample
spacing is measured after every window and the rate corrected if it is worse
than asked for. Frames that arrived too far apart to be trusted are counted
and reported.

Two sliders, both instant, because the frames were measured once and only the
verdicts are recomputed:

- **Court vs. frame** — the ratio above. *Real rallies being pre-dropped
  means lower it; the next court's rallies surviving means raise it.* Every
  clip's own figure is on its badge, so read them off before deciding.
- **Keep above** — the confidence bar.

Each clip in the list carries its score. Hover it for the reason and the
measured ratio.

---

## Who won the point

The export includes `lastSide` per clip: which half of the court was still
moving as the clip ended, from −1 (left of the midline) to +1 (right).

**That is a hint, and it is not a score.** The last player to touch the ball
wins the point if it was a winner and loses it if it went out or into the
net. Same visual event, opposite outcomes — the ambiguity is not a gap in the
implementation, it is the thing that makes automatic scoring from one camera
hard. `lastSide` is exported because it is free and because somebody tapping
a winner per rally can use it as a pre-selected default. Nothing in the app
treats it as a result.

If you want a real score, ref the match in the point tracker. Two taps a
point, and you get an exact cut ([rally reel](rally-reel.md)) and the score
rather than a guess at both.

---

## What it is measured against

Two suites, neither of which is real footage.

```bash
node test/vision-core.test.js     # no dependencies
node test/make-fixture.js         # ~1 min, needs playwright + chromium
node test/vision-video.test.js
```

**`vision-core.test.js`** runs the judgement over synthetic motion tensors
with known answers — a mixed match, a tree in shot, thirty-second rallies, a
camera behind one player, a locked-off wide shot, and a recording where every
single candidate is the next court over. Then the mixed case again across 24
random seeds: 192 verdicts, no misclassifications, worst real rally 1.00,
best junk clip 0.67, threshold 0.70. Every scenario in that file is something
the detector got wrong at some point.

**`vision-video.test.js`** feeds a real webm — synthetic match, real
soundtrack, camera shake, sensor noise, players talking through the dead time
— into `acLoad()` in the shipped `index.html` and checks the result against
the plan it was built from. The audio hears all four candidates including the
one with an empty court behind it; the picture scores the three real rallies
0.90–0.95 and the next-court clip 0.32, and drops it.

Both suites read the code **out of `index.html`** between the `AV-CORE`
sentinels rather than from a copy, so they cannot drift from what ships. Move
a sentinel and they throw.

**Synthetic footage is not real footage.** Those numbers say the method is
sound and the safety valves fire; they say nothing about your camera, your
court or your light. That is why every threshold is on a slider, why each
clip shows the number it was judged on, and why the output is still a review
list.

---

## What it will get wrong

- **A camera far enough back that the players barely register.** The ratio
  shrinks and real rallies get pre-dropped. Safety valve 1 catches the
  extreme; the middle of that range is the main false-drop mode. Lower
  *Court vs. frame*.
- **Someone walking through the shot on both sides of the midline** during a
  next-court rally. Looks like tennis to every test here.
- **Doubles**, and any framing where four people fill the court: the court
  ROI is most of the frame, so there is less "outside" to be busier than.
- **Panning or zooming.** Shake compensation handles translation only.
- **Your own rally that both players stood still for.** There isn't one, but
  a clip padded so heavily that it is mostly dead time can dilute itself.
- **Nothing about who won, ever.** See above.
