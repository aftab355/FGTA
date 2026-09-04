# Automating the scoreboard

Where this could actually go, what each route costs, and which one I'd build.
Nothing here is implemented yet.

---

## Restating the problem, because the obvious version is the hard one

"Automatic scoring" sounds like *work out who won each point*. That framing is
the one that doesn't work, and [the video analyzer's
notes](video-analyzer.md#who-won-the-point) say why: the last player to touch
the ball wins the point if it was a winner and loses it if it went out. Same
visual event, opposite outcomes. One camera cannot separate them.

But **the score is not sixty independent guesses.** It is a state machine with
very few reachable states, and auto-cut already knows exactly where every
rally started and ended. That makes it a constraint problem, and constraint
problems are much easier than classification problems. What follows is three
ways to exploit that, in the order I'd try them.

---

## A. Read the scoreboard that is already there

**If a scoreboard is visible in shot, stop inferring and just read it.** This
is by a distance the best route, and the only one that produces a score
without a person confirming it.

How it would work:

1. **One interaction, once per recording.** Pause on any frame, drag a box
   round the scoreboard. That is the whole setup — no calibration, no
   training.
2. The picture pass already walks the video and pulls frames. Add a crop of
   that box to what it keeps.
3. **Segment the digits.** Binarise, connected components, size-normalise.
   For an LED/segment board, read the segments directly; for printed or
   flip-card digits, cluster the glyphs *observed in this recording* into
   groups and match against the cluster centres. Either way there is no font
   to know in advance and no model to ship.
4. **Then the part that makes it work.** Do not read one frame — read a
   thousand frames of the same number. The score is stable for a minute at a
   time and changes rarely, so:
   - take the majority reading over each stable interval, and
   - reject any new reading that is not a **legal successor** of the one
     before it under the sport's rules.

   Per-frame OCR at 90% is not good enough for anything. Per-*state* OCR, with
   a hundred frames voting and illegal transitions thrown out, is a different
   proposition entirely — and a transition that keeps failing the legality
   check is a flag to raise, not a silent error.

**What it gives you:** a score timeline. Cross it against auto-cut's rally
boundaries and you have who won every point, exactly, plus the game and set
structure for free.

**Cost:** in-browser, no dependencies, no ML. Call it 300–400 lines and a day.
The risks are ordinary vision risks — glare, motion blur if the board is
hand-held, a board that goes out of frame when the camera moves — and they are
all visible in the review pass rather than silent.

**This is the one I'd build.** It needs one thing to be true: a scoreboard
in shot.

---

## B. No scoreboard — observe the structure, don't guess the winners

If there is no board, do not go after who won. Go after what is easy to see
*and* heavily constrained by the rules.

### What is easy to see

- **Which side served.** A rally's first strike comes from one side, and the
  picture pass already splits the court into halves and tracks motion in each.
  It computes `lastSide` today; `firstSide` is the same measurement at the
  other end of the clip and costs nothing.
- **Ends changes.** Players swap halves at fixed intervals. Two large blobs
  trading places is about the most unambiguous thing in the whole recording —
  slow, huge, and impossible to confuse with a rally.
- **The long gaps.** Auto-cut already knows where the dead time is; the long
  ones are changeovers and set breaks.

### Why that is worth more than it sounds

Serve rotation is **deterministic given the score**. So a sequence of observed
serve sides is not a weak signal about who won — it is a *check* on every
candidate point-winner sequence. Same for ends changes. Which means:

- Observed serve sides → where the game boundaries are → how many points each
  game contained.
- Points per game plus who served → for each game, only two possibilities:
  the server held, or was broken.
- The final scoreline — one thing the players always know — cuts that down
  again.
- And the ladder **already models serve-point win rates** (the Predict tab's
  hierarchical point → game → set → match recursion, and the DR figure beside
  it), so the remaining candidates can be ranked by how likely each is for
  these two players rather than left as a coin flip.

### What that actually buys

Not zero input. **Roughly one confirmation per game instead of one tap per
point** — order ten instead of order sixty — with the reconstruction proposed
and the human agreeing or correcting.

I want to be blunt about why it stops there. This feeds Elo. A plausible
reconstruction that is quietly wrong is worse than asking for ten taps,
because it is wrong *and* it looks right. The value here is removing tedium
under supervision, not removing the supervisor.

### What blocks it today

**The point tracker does not know who is serving.** `ptDefaultState` has no
server field; `ptPoint(side)` just increments. The Predict tab says so out
loud — *"service is assumed to alternate starting with player 1"* — because
the data has never carried it.

So route B's first deliverable is not vision at all. It is **adding a server
to the scoring state machine**: a field on `PT`, rotated on `ptCloseGame`,
recorded per point in `ptLogRally` alongside `w`/`s`/`g`/`b`, shown on the
scorecard and on the [broadcast overlay](../overlay.html). That is worth doing
on its own merits — every real scoreboard shows who is serving, and it turns
the Predict tab's serve/return split from an assumption into a measurement.
It also happens to be the thing route B needs to check its own work against.

---

## C. Classify who won each rally directly

The obvious approach, and the one to skip. Winner and unforced error are the
same event from one camera. Everything that separates them — where the ball
bounced, whether it was in — is what Hawk-Eye needs six calibrated cameras
for. `lastSide` is exported as a hint precisely because it is not more than
one.

---

## Live vs. afterwards

These are different problems and the easy one is the second.

The [overlay](../overlay.html) already puts a live score on the stream, driven
by whoever is reffing in the point tracker over Supabase Realtime. Automating
*that* means replacing the ref's taps in real time — no lookahead, no final
scoreline to constrain against, no second pass. Every constraint route B
leans on is a constraint from the future.

Reconstructing a score **after the match** has all of it available at once.
That is where automation is achievable, and it is also where the demand
actually is: matches nobody reffed.

---

## Recommendation

1. **Is there a scoreboard in shot?** If yes, build A. It is the only route
   that ends with a score nobody had to confirm, and it is the least code.
2. **If not,** build the server field in the point tracker first. It is small,
   it is useful on its own, it fixes a stated assumption in the Predict tab,
   and it is the foundation route B needs.
3. **Then** `firstSide` and ends-change detection in the picture pass, and a
   reconstructor that proposes a scoreline for a human to confirm a game at a
   time.
4. **Never** C.

## Still unknown

The rules. Route A needs them for the legal-successor check, route B needs
them for the rotation. Points to a game, games to a match, serve rotation,
deuce or golden point, ends-change interval, singles or doubles. The existing
tracker hard-codes classic tennis — games to 6, win by 2, tiebreak to 7 at
6-6 — which is very likely not what a board tennis match is.
