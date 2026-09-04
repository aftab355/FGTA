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

### What blocked it, and no longer does

**The point tracker did not know who was serving.** `ptDefaultState` had no
server field; `ptPoint(side)` just incremented. The Predict tab said so out
loud — *"service is assumed to alternate starting with player 1"* — because
the data had never carried it.

That is now built. `PT.server` is who serves the first point of the current
game, it rotates in `ptCloseGame`, `ptServerNow()` resolves the tiebreak's
different rotation, `ptServeCourt()` gives deuce or ad, every point in
`PT.rallies` carries `sv` and `ct`, the scorecard draws a serving dot and so
does the [broadcast overlay](../overlay.html), which never had one because
nothing upstream knew.

`test/serve.test.js` plays a scripted match through the shipped tracker and
checks the result against the rules — including the one that looks like a bug
and is not: **a tiebreak occupies a rotation slot, so the games either side of
it are served by the same player.** The first version of that test filtered
the tiebreak out and then demanded the remaining games alternate, which fails
on correct behaviour.

So route B's foundation exists.

### Which end the serve came from, from the picture

Built and measured. `serveEnd` is +1 for the end nearest the camera, -1 for
the far end, exported per clip. It took three attempts and the two dead ends
are the same mistake in different clothes:

1. **Near-share at contact against near-share over the clip.** Perspective
   puts the near player's share near the ceiling all rally, so a near serve
   can push it up barely at all while a far serve pulls it down a long way.
   Every clip came back "far"; three of six were right by accident.
2. **Each end against its own baseline** — how much busier is the near end
   during the serve than during the rest of its own rally, versus the same
   question of the far end. Right idea, but the far end was a *mean over its
   cells*, and a player at the far baseline is about two cells wide, so they
   were buried under twenty cells of background and the far signal vanished.
3. **Each end as the mean of its busiest few cells.** A distant player
   concentrates what motion they make. This works.

The decision is then made **across the recording, not clip by clip**, because
zero is not the boundary and there is no reason it should be: a far serve
stills the near player, who is large, which is an enormous change; a near
serve stills the far player, who was contributing little either way. Measured,
far serves land around -1 to -2 and near ones within 0.05 of zero. The camera
geometry does not change through a recording, so that asymmetry is a constant
offset and the shifts come out bimodal — the split is the widest gap in the
sorted values. A recording with no gap wide enough (every serve from one end,
or a camera that cannot tell) returns "don't know" rather than a coin flip.

`test/serve-vision.test.js` asks this of a real decoded video with a court in
perspective: six rallies, ends near/near/far/far/near/far, **6 of 6 correct**,
split found at -0.5 with a gap of 0.9 either side.

### From serve ends back to games

The camera is on a tripod and never moves, which settles the question above:
**a fixed camera cannot see the server nearest it every game.** Ends change
after every odd game while the serve changes every game, so the serving end
moves in pairs — near, near, far, far — a period of four that runs unbroken
through set boundaries. (A set ending on an odd game total changes ends
immediately; one ending on an even total changes after game one of the next
set. That is the same rule saying the same thing, so the pattern never
stutters.)

Which gives the one structural fact everything else hangs off:

> **Every run of consecutive same-end rallies is exactly two games.**

Splitting a run of *n* rallies into two games is then arithmetic, because a
game cannot be any length it likes. It ends at 4, 5, 6, 8, 10, 12 … points
and never at 7 or 9 — three-all is deuce, so the game runs to 5-3 at eight
points rather than 5-2 at seven. A run of 8 can only be 4+4; a run of 9 can
only be 4+5 or 5+4.

`scFrame()` does this, and `test/score-frame.test.js` measures it over 200
simulated matches — 33,218 points, 5,586 games:

| | |
|---|---|
| game boundaries located | **2,185 of 5,386 (41%)** |
| boundaries claimed that were not real | **0** |
| tiebreaks spotted | **145 of 145** |
| runs left unexplained | **0** |

**Read that honestly.** Forty-one per cent is essentially *every pair
boundary* and almost nothing else: the split inside a pair is pinned only 195
times in 2,880 runs — about 7%, the cases that come to exactly 8 and can only
be 4+4. What the ends buy is the skeleton, with zero false positives. They do
not buy the individual games.

Two things it had to be taught, both found by measurement rather than
reasoning:

- **A tiebreak looks like nothing else and contaminates both neighbours.**
  Inside one the serve moves every two points while the ends change every six,
  so the end alternates in twos — a burst of very short runs where the rest of
  a match gives runs of eight to twelve. That burst is the signature. Its
  first point also shares an end with the two games before it and its last can
  share one with the game after, so both neighbouring runs have tiebreak
  points glued to a real game and are set aside rather than counted.
- **The last run of a match can be one game, not two.** A final run of 8
  reads as 4+4 and equally as one game of 8 — deuce, then 5-3. Both are real,
  so the last run is only certain when one of them is. Assuming a pair
  regardless was worth exactly three wrong boundaries in two thousand, every
  one of them the last game of a match.

### And then it was built

The 41% figure above is what the serve ends give you **on their own**. Adding
the two things that were always going to be needed — the final scoreline, and
the fact that people take longer between games than between points — closes
most of the rest.

**A correction first.** The note above says every run of same-end rallies is
exactly two games. That is very nearly true and it is not true, and the
exception is not rare. Ends change after every odd game *of a set*, so a set
finishing on an odd game total changes ends at the end of it **and** again
after game one of the next — two flips one game apart. Measured over sixty
matches: 348 runs of two games, 27 of three, 16 of one, every odd one sitting
on a set that ended 6-1, 6-3, 7-5. Assuming pairs regardless left most matches
a game short and refusing to reconstruct at all.

So the pairs assumption is gone. The scoreline says how many games each set
had; with who served first that fixes the server and end of **every** game
deterministically, which says how many games each observed run must contain —
two usually, one or three where the sets say so.

Then, per run, the rally count divides into that many legal game lengths.
Where more than one division is legal, the longest pause decides: people
collect balls and walk back between games, and the clip timings already record
that.

Who won each game is the one bit per game that no camera supplies. It comes
from enumerating every ordering that finishes the set exactly as the scoreline
says, and weighting each by how likely these two players were to produce it —
using **each game's length**, not a flat hold rate. A game won to love is four
points in a row and says a great deal; a game that went to deuce was close by
definition and says almost nothing.

### Measured, over 200 simulated matches

| | |
|---|---|
| game lengths | **2,077 of 2,077 — 100%** |
| game winners | 1,799 of 2,077 — **87%** |
| the scoreboard at any given rally | 76% |
| games a person has to correct | **3.1 per match**, out of ~23 |
| matches needing a note | **0** |

87% is close to the ceiling for what is measurable, and it is worth saying why
rather than promising to improve it. Per game, the length gives a posterior of
about 0.74 (a deuce game) to 0.89 (a love game), and the set score then forces
the count exactly. The missing information — who won each *point* — is not on
the recording and no arithmetic recovers it.

So instead of pretending, it says which games it doubts. The confidence per
game is a proper marginal over every valid ordering, and **checking the five
least confident games catches 76% of the mistakes**. That is the difference
between reading twenty-three games and reading five.

### What it will not do

**It does not invent points.** Games and sets come back exactly once the games
are confirmed; the point score comes back only for a game won to love, where
four points and one winner leaves 15-0 30-0 40-0 as the only reading.
Everywhere else the burnt-in board shows *which point of the game* it is —
which the rally count does give exactly — rather than a plausible-looking
30-15 that nobody measured.

**Tiebreaks are reported, not reconstructed.** Inside one the serve moves
every two points while the ends change every six, so the end alternates in
twos and the run structure the whole method rests on does not hold. The burst
is unmistakable and both its neighbours are flagged with it.

### Using it

**Matches → Auto-cut**, on a video, after the picture pass has found the serve
ends. Type the final score, the two names, and who served first from which
end. It fills in the games, marks the ones it is least sure of, and any game
is one tap to hand to the other player.

Then **▶ render the video here** burns the board into the picture.

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

## Where this ended up

Route B, built. The server and the court ends are in the point tracker, the
serving end is measured from the picture, and the reconstruction turns those
into games — 100% of the lengths, 87% of the winners, and a list of which ones
to check. The scoreboard is burnt into the exported video.

Route A — reading a scoreboard that is physically in shot — remains the better
answer *if you have a board*, because it needs no confirmation from anybody. It
was not built because there is no board in this footage.

Route C is still the one to skip.

## The sport is tennis, and that helps more than it sounds

An earlier draft of this hedged about what the rules were. They are the ones
the tracker already hard-codes: games to 6, win by 2, tiebreak to 7 at 6-6.
That removes the biggest unknown from both routes, and it hands route B a
constraint I had underrated.

**The serve court alternates every single point.** Deuce court, ad court,
deuce court — from the first point of a game to the last, and through a
tiebreak too. So the server's lateral position at the moment of serve is a
per-*point* observable, not a per-game one, and it is a large, slow, obvious
thing to see: a person standing still in one half of the baseline.

Read off a video, that gives you:

- **Where the games end**, because the pattern resets to the deuce court and
  the serve moves to the other end of the court.
- **How many points each game contained** — the parity sequence counts them
  for you.
- **A checksum.** Games can only end after 4, 5, 6, 8, 10, 12 … points. Never
  7, never 9: 3-3 is deuce, so the game runs to 5-3 at eight points, not 5-2
  at seven. Any reading that produces a seven-point game is a misread, and it
  says so without needing a second opinion.

Which leaves exactly one bit per game — did the server hold, or get broken —
and that bit is what the final scoreline and the hold-rate priors are for.

**Ends changes** land in the same bucket: after every odd game, so they are
another independent count of where the game boundaries are.

## Still unknown

Nothing about the rules. What is unknown is the footage: whether the camera
sees enough of the baseline, from enough of an angle, to tell which half of
it the server is standing in. That is the measurement route B lives or dies
on, and unlike everything above it cannot be settled from a rulebook.
