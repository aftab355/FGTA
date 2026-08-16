# Cutting a match down to the rallies

An hour of tennis is about twenty minutes of tennis. The rest is walking
back to the baseline, fetching balls off the next court, and towelling off.
The **rally reel** removes it — either by playing the match here and skipping
the gaps, or by handing you an `ffmpeg` script that cuts the real file.

---

## Why this isn't a computer-vision problem

Every app that does this treats it as one: track the ball, find the serve,
detect when the point ends. That's hard, it's wrong often enough to be
annoying, and it needs a GPU and your footage uploaded somewhere.

FGTA already has the answer written down. Somebody sat through the match
tapping **+ point** every time a rally finished — the ref, running the point
tracker. Tap *i* is where rally *i* ended, to about a second. The rally
before it started once the players had collected the ball and served again
after tap *i-1*. That's the whole edit.

So the cut is derived from data the app was already collecting. No model, no
upload, nothing to be wrong about when the ball goes behind a tree.

**What is measured:** every point ending, from the taps.
**What is assumed:** where the serve fell inside the gap between two taps.
That one is a slider, not a guess dressed up as a measurement.

Measured against simulated matches with realistic between-point routines, the
defaults keep **99.6% of the ball-in-play** while cutting about a third of the
runtime; on a group with a tighter routine it's 100% and a little more cut.
The failure mode is deliberately lopsided — a clip that opens two seconds
early is fine, one that opens after the serve is not.

---

## What you need

1. **The match was scored in the point tracker.** Not typed in afterwards —
   the reel needs the taps. A match reported through the ordinary form has no
   timings and gets no reel. For footage nobody reffed, use
   [Auto-cut](auto-cut.md), which finds the rallies by ear instead.
2. **`matches.rallies` exists.** One column, see
   [`rally-reel.sql`](rally-reel.sql). Without it everything still works, no
   match ever has timings, and the button never appears.
3. **A video, eventually.** Not required to *cut* — the cut list is exact
   without one — but required to *watch* the reel in the page.

Matches played before the column existed can't be recovered. The taps were
never written down. It starts with the next match somebody refs.

---

## Using it

Open any match from the archive, the feed, anywhere. If it was tracked
point-by-point there's a **🎬 Rally reel** button under the score.

### Watching

The player plays only the rallies, seeking past everything else. No
processing, no file, no upload — the video stays where it is on YouTube and
the player is simply told where to go next.

- **Filters** — all rallies, long rallies (the top quarter *for this match*,
  since a 12-second rally means different things in different company),
  pressure points, game winners, aces, or everything one player won.
- **The list** follows the reel while it plays; tap any row to jump.
- **Speed** — 1×, 1.5×, 2×.

### Sync

If the match was streamed with the app open, the sync is automatic: a YouTube
VOD's timeline starts when the stream started, and `/api/youtube` reports
that moment, so the offset between "how far into the match" and "how far into
the video" is one constant nobody has to line up by hand.

It lands within a second or two, not exactly — YouTube trims the head of a
stream, and phone clocks drift. So there's an **offset** control:

> Play a clip. If it opens late, nudge down. If it opens on the *previous*
> point, nudge up.

Admins get **save for everyone**, which writes the corrected offset back to
the match so nobody else has to redo it.

**No video attached?** Paste a YouTube link into the reel. If it's an
ordinary upload rather than an archived stream there's no stream-start to
read, so the reel assumes the video opens on the first ball and the offset
control covers the difference.

### Cut timing

Six numbers under **Cut timing**, saved per device — dial them in once
against your own footage and every match after that cuts correctly.

| | what it is |
|---|---|
| **Tap lag** | how long after the ball is dead the ref actually taps |
| **Dead time** | ball dead → next serve: fetch the ball, walk back, bounce it |
| **Lead-in** | kept before the serve, so a clip opens on the toss |
| **Tail** | kept after the point, for the reaction |
| **Max clip** | the cap that stops a changeover being served up as a 90-second rally |
| **Min clip** | so a double fault is still watchable |

**Dead time is the only one that matters.** If clips open after the ball has
been struck, take a second off it. If they all open on somebody wandering
back to the baseline, add one. The rest is taste.

---

## Exports

The browser works out the edit. The machine holding the original file
performs it — a phone should not be re-encoding an hour of tennis, and it
doesn't have the camera original anyway.

### `⬇ ffmpeg script`

A bash script with every rally as a start/duration pair, commented with the
set, game, score and winner. Needs `ffmpeg` and `awk`; on Windows run it from
Git Bash or WSL.

```bash
bash fgta-alice-vs-bob-cut.sh  my-recording.mp4  rallies.mp4
```

Each rally is extracted on its own and the pieces are joined. It re-encodes
rather than stream-copying, because a copy can only cut on keyframes — which
in practice means several extra seconds of walking about at the head of every
clip.

If the timecodes are for the YouTube VOD but you're cutting the camera
original, the two differ by a constant:

```bash
OFFSET=-12.5 bash fgta-alice-vs-bob-cut.sh camera-original.mp4
```

### `⬇ cut list (JSON)`

The same segments with their context — set, game, score before the point, who
won it, tags — for feeding something else: a Premiere/Resolve import script,
a highlight picker, your own tooling.

### `⬇ YouTube chapters`

Paste into the video description and YouTube turns them into chapter markers.
One chapter per **game**, not per point: YouTube requires chapters ten
seconds apart and rejects the whole list if any pair is closer, and points
inside a game routinely are. Games are minutes apart and are what anyone
actually wants to jump to.

---

## What this deliberately doesn't do

**Work out the score from the video.** Reading a scoreline off footage with no
human input isn't solved — not by apps with funding and a team on it — and
pretending otherwise here would produce something confidently wrong. The
score comes from the ref, who was going to be there anyway.

**Track the ball.** A TrackNet/YOLO pass over the footage is a real thing and
the code for it is open source, but inference wants a GPU and the footage
uploaded to it. It also wouldn't improve the cut: the taps already mark the
point endings more reliably than a ball tracker would, and the one unknown —
the serve inside the gap — is a slider that takes ten seconds to set.

**Render anything in the browser.** Watching costs nothing because nothing is
produced; cutting produces a file, and that happens on a machine with the
file already on it.
