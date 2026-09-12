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
3. Tap it. A small panel appears in the corner of the screen showing
   progress; leave the tab open and awake until it says the file is ready —
   it takes exactly as long as the match did, because it's redrawing the
   real match at the real pace between points, not compressing time.
4. Tap **Download** (it also tries to save automatically). Drop the file
   onto your timeline over the camera footage, key out the green, and slide
   it until the first point lines up.

Works with no signal at all — nothing here talks to the network. It works
offline the same as it works at a court with full bars.

---

## What you get

A flat, solid green (`#00b140`) frame at 1920×1080, with a scoreboard drawn
in the bottom-left corner: both names, the running score, sets and games
won, a serve dot, and a small match clock. It's a simplified redraw of the
same information the live broadcast overlay shows — not a pixel-for-pixel
copy of it, because that page is HTML and CSS, and a video export has to be
drawn onto a canvas instead. Same data, plainer graphic.

**Green, not transparent.** A browser recording its own canvas cannot
reliably hand you a video with a real alpha channel — that support is
inconsistent across browsers, so rather than promise "transparent" and have
it silently not work on whatever's actually installed tonight, this is
honest about needing one keying step, same as any green-screen footage.
Any editor — Resolve included — keys out a flat color in a couple of clicks.

**The file format depends on your browser.** Chrome, Edge and Safari can
record straight to `.mp4` (H.264), which every editor opens without a
second thought — that's what you should get on most phones and laptops.
Firefox can only produce `.webm`, and DaVinci Resolve's support for that
container is inconsistent between versions — if you end up with a `.webm`
and Resolve won't import it, a free one-time conversion (VLC's
*Convert/Save*, or HandBrake) to `.mp4` fixes it. **Worth checking once
before the day it matters**, not mid-edit.

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

**Don't hit "Submit game" afterwards.** Same as scoreboard replay: this
briefly takes over the Point Tracker on your device to regenerate the
match, and the tracker knows it's a replay — it'll warn if you try to file
it again, but the right move is just not to.

**One export at a time, per device.** Starting a second one while the first
is still rendering is refused rather than silently breaking the first.
