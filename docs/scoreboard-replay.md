# A burnt-in scoreboard with no OBS and no laptop

For whoever has three phones and no laptop: one filming, one for whoever's
watching, one for the ref running the point tracker as normal. No streaming,
no YouTube, no latency to fight — just a video file and a live match.

**If you don't already use OBS, you probably want
[scoreboard export](scoreboard-export.md) instead** — one click, a
downloadable video file, no screen recorder or second device needed. This
page is for compositing live inside OBS specifically; export is the simpler
default for everyone else.

The gap that leaves is the scoreboard. [The live setup](youtube-live.md) can
only burn one into the picture via OBS's Browser Source, which needs a
laptop. This is the phone-only alternative: score the match natively, film it
natively, and generate the scoreboard as its own clip afterwards, to line up
against the footage in an editor.

---

## The idea

The point tracker already has everything a scoreboard needs — every point
already went in as a tap, stamped with when it landed (see
[the rally reel](rally-reel.md), which runs on the same data). **Scoreboard
replay** feeds those same taps back through the tracker, at the same gaps
they actually happened, so it produces the exact match again — pt_sync and
all, the same thing a live scoreboard runs on. Nothing about how a point is
scored is reimplemented; it's the same code path the ref's own taps went
through the first time.

What comes out the other end is `overlay.html`, unchanged, showing the score
climb in real time over however long the match took. Record that, and you
have a scoreboard-only clip the same length as the match, to drop onto your
footage's timeline and slide until it lines up — no timestamps to match by
hand, because both clips started at "the first point" and run at the same
speed.

---

## At the court

1. **Film normally.** Any camera app. No streaming, no RTMP, no YouTube
   account needed for this path.
2. **Ref normally.** Open the Point Tracker, score the match point by point,
   same as always.
3. **Report the match** the normal way once it's done, so it's scored, then
   the recording is yours to do whatever you want with.

That's the whole routine — nothing new happens during the match.

---

## Afterwards, to get the scoreboard clip

1. Find the match — the archive, the feed, wherever match cards show up.
   If it was tracked point-by-point there's a **🖥️ Scoreboard replay** button
   under the score, next to 🎬 Rally reel.
2. Tap it. This clears whatever the tracker on this device is currently
   doing (it asks first if something's mid-match) and opens a broadcast
   session — same one the live setup uses — then starts feeding the match's
   points back through it at their real gaps.
3. A toast names the overlay URL and how long the replay will run: point a
   screen recorder — or OBS, **Start Recording** rather than *Start
   Streaming* — at that URL and start it now.
   - **Using OBS:** add the URL as a Browser Source as usual — background
     stays transparent, so recording it captures scoreboard-shaped alpha.
   - **Using an ordinary screen recorder** (QuickTime, the Windows/Android
     built-ins, anything without an alpha channel): add `&bg=green` (or any
     color — a name or a hex triplet) to the URL first. A plain recorder
     shows whatever's actually on screen, and transparent-on-screen is just
     your desktop, not something you can key out. `green` gives you a flat
     color to key in Resolve instead.
4. Let it run. It takes exactly as long as the match did — a 40-minute match
   is a 40-minute recording. Nothing to babysit; walk away and come back.
5. Import both files into Resolve, stack the scoreboard clip over the
   camera one, and slide it until the first point lines up. Chroma-key out
   the green if you used one. Done — no offset control, no timestamps,
   because both clips run at the same real speed from the same starting
   point.

---

## What it gets right and what it doesn't

**The score is exact.** It's the same tap sequence that scored the real
match, replayed through the same code.

**The serving dot is exact too**, not guessed — the first point's server and
end are read back off the recorded rally, and the tracker's own alternation
rules (see `docs/scoring.md`) reproduce every point after that.

**Don't hit "Submit game" afterwards.** The match this drives was already
filed when it was actually played. Submitting again would file it a second
time under a new id; the tracker warns before letting that happen, but the
right move is just not to.

**Only for matches tracked point by point.** Same requirement as the rally
reel — a match reported through the plain form has no timings, so there's
nothing to replay. A match filmed but never reffed live has no path here;
this isn't computer vision.

**It runs at 1×, always**, on purpose — that's what makes "just slide it
until it lines up" work without a sync step. If you want to *watch* the
match sped up or filtered down to rallies, that's what the rally reel is
for; this is only ever the export.
