# Exporting a scoreboard as a video file

The simplest of the three ways to get a scoreboard onto footage that was
filmed with no OBS and no live stream: click a button, get a video file, drop
it on your timeline. No screen recorder, no second device, no OBS.

If you'd rather composite live in OBS instead of exporting a file, see
[scoreboard replay](scoreboard-replay.md) — same underlying data, different
delivery. This page is the one to use if all you have is a browser.

---

## Using it

1. Track the match in the Point Tracker as normal, point by point, and
   submit it.
2. Find it in the archive/feed. Under the score, next to 🎬 Rally reel, is
   **⬇ Export scoreboard video**.
3. Tap it. A small panel appears in the corner showing a percentage and a
   rough time remaining. On any browser that can encode video — nearly all
   of them — **a whole match renders in a minute or two**, not in the time
   the match took: it is re-simulated instantly and the frames are encoded
   as fast as the machine can manage (a phone with a hardware encoder does
   it in seconds; the slowest thing measured, a software VP9 encoder with
   no GPU at all, did an hour-long match in a bit over two minutes). The
   video's own timeline still runs at the match's real pace; only the
   waiting is skipped.
4. Tap **Download** (it also tries to save automatically). Drop the file
   onto your timeline over the camera footage, key out the green, and slide
   it until the first point lines up.

Works with no signal at all — nothing here talks to the network. The two
muxers it needs live in [`vendor/`](../vendor/README.md) and are precached
by the service worker, so it works offline the same as it works at a court
with full bars.

Exporting is **non-destructive**: it borrows the Point Tracker to replay the
match, then puts back whatever was in it, untouched — including a match
you're part-way through tracking. Nothing is saved over, nothing is spoken
or buzzed, no set celebrations fire, and if a broadcast session is open on
this device the replayed points don't go out over it.

---

## What you get

A flat, solid green (`#00b140`) frame at 1920×1080 with a scoreboard drawn
in the bottom-left corner: both names, the running score, sets and games
won, a serve dot, and which game of which set it is. It's a simplified
redraw of the same information the live broadcast overlay shows — not a
pixel-for-pixel copy of it, because that page is HTML and CSS, and a video
export has to be drawn onto a canvas instead. Same data, plainer graphic.

Four frames a second, with a keyframe every two seconds. Four is plenty for
a scoreboard (nothing on it moves between points) and it's what keeps a
90-minute export down to tens of megabytes rather than gigabytes; the
keyframes are what let an editor scrub through it without decoding from the
start of the match.

**Green, not transparent.** A browser recording its own canvas cannot
reliably hand you a video with a real alpha channel — that support is
inconsistent across browsers, so rather than promise "transparent" and have
it silently not work on whatever's actually installed tonight, this is
honest about needing one keying step, same as any green-screen footage.
Any editor — Resolve included — keys out a flat color in a couple of clicks.

### The file you get depends on what your browser can encode

| what the browser has | what you get | how long it takes |
|---|---|---|
| an H.264 encoder (most Chrome, Edge, Safari) | `.mp4` | seconds to a couple of minutes |
| no H.264, but WebCodecs (Chromium on Linux, some others) | `.webm`, VP9 or VP8 | the same |
| no WebCodecs at all | `.webm` or `.mp4`, recorded in real time | **as long as the match** |

The first two are the same fast path and differ only in container. H.264 is
a licensing question, not a capability one — a browser without it will still
encode VP9 in software many times faster than real time, which is why a
missing H.264 encoder no longer drops you onto the slow path.

DaVinci Resolve's support for `.webm` is inconsistent between versions — if
you end up with one and Resolve won't import it, a free one-time conversion
(VLC's *Convert/Save*, or HandBrake) to `.mp4` fixes it. **Worth checking
once before the day it matters**, not mid-edit.

The real-time path is the last resort, and it now says so before it starts:
it tells you how many minutes it will take and asks before committing you to
sitting there. It keeps the screen awake where the browser allows it, and
the Point Tracker is unusable until it finishes.

---

## What it doesn't do

**No CV, no guessing.** Exactly the same rule as the rally reel and
scoreboard replay: it's driven entirely by the ref's own taps, stamped with
when they landed. A match reported through the plain form, with no
point-by-point timings, has nothing to export.

**Doesn't touch anything live.** Unlike scoreboard replay (which opens a
broadcast session so OBS can pick it up), this never talks to Supabase at
all — it's a local redraw and a local recording, start to finish. Nothing
else on the site sees it happen.

**One export at a time, per device.** Starting a second one while the first
is still rendering is refused rather than silently breaking the first.

**No clock on the board.** It was drawn from the wall clock at the moment
each frame was encoded rather than from the time the frame represents, which
made it meaningless as soon as rendering stopped taking as long as the
match. Real broadcasts don't run a live stopwatch either, so it's gone
rather than half-right.

---

## Checking it yourself

`node test/scoreboard-export.test.js` plays a 90-minute match through the
real tracker, exports it, and checks the file that comes out: that it took
the fast path, that it runs as long as the match did, that it has keyframes
and seeks quickly, that the scoreboard in a frame sampled from the middle of
the file is the score that instant of the match actually held — and that the
tracker, its undo history and its saved draft are exactly as they were
before. Pass a number to use a shorter match (`node test/scoreboard-export.test.js 15`).
It needs playwright and a chromium build; see `test/playwright.js`.
