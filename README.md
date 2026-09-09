# Handoff: FGTA Tennis Ladder App

## Overview
FGTA is a competitive tennis ladder web app for a friend group: report/track 1v1 and doubles matches, run tournaments, browse Elo-style rankings and analytics, watch matches live on YouTube, log casual sessions, and manage a shared calendar. It runs against Supabase (Postgres + Realtime) for data and live features, plus the free Open-Meteo API for ambient weather theming.

## About the Design Files
The bundled file (index.html) is a **working HTML/CSS/vanilla-JS prototype**, not production code to copy as-is. It was built as a single-file app directly against Supabase's JS client, with no build step, no component framework, and all styling inline/in one <style> block. Treat it as a **design and behavior reference**: recreate the same screens, interactions, and visual language in the target codebase's actual stack (React/Vue/native/etc., whichever the project already uses — or the most sensible choice if starting fresh). Reuse its logic (Elo/Glicko math, calendar aggregation, tilt/hover effects, etc.) as the source of truth for *what* to build, not the file structure for *how*.

## Fidelity
**High-fidelity.** Colors, spacing, typography, copy, and interaction timings in the HTML are final — implement them pixel-for-pixel using the target codebase's own component/styling system (design tokens below map directly to whatever token system exists there, e.g. Tailwind config, CSS-in-JS theme, etc.).

## Screens / Views
The app is a single page with a top nav (desktop) / bottom nav + "More" sheet (mobile) switching between full-page views. All views live in the DOM simultaneously and are toggled via display:none — recreate as routed screens or a tab-based state machine, whichever the target app already uses.

### 1. Ladder (Home tab / default view)
- **Purpose**: The season standings table — rank, player, rating, W-L record, peak rating.
- **Layout**: Two-column layout on desktop (>=1080px): main column (ladder table, admin queue) + side column (feed/moments); single column stacked on mobile.
- **Components**:
  - Ranked row (.row): rank number (gold/silver/bronze gradient badges for top 3), avatar, name, W-L record, rating (underlined in accent pink), peak rating in gold.
  - Header row: uppercase, JetBrains Mono, small caps style, dark-on-light inverted (ink background, bg-color text).
  - Pending-match approval queue (admin only): each row has Approve/Reject mini-buttons.
  - **"Goes to" (admin only)**: every queue row — and every approved result row, on the ladder page and in the Matches archive — carries a destination picker: the ladder, or any event. The ref chooses where a tracked game is filed when they submit it (see Point Tracker), but the ref can be wrong, so the admin gets the last word from the same row as Approve. It writes the same fields the ref's picker does (`tournament_id`, plus `round` when the pair is an unplayed fixture in that event's draw), so a re-filed game is indistinguishable from one submitted correctly; moving a game back to the ladder clears the round with it. Editable on approved games too, not just pending ones — standings recompute from scratch on every render, so re-filing a game that already went through corrects the ladder on the next paint instead of needing it rejected and re-entered. Every move is written to the admin audit log with where it came from and where it went.
- **Content**: Standings are computed live from the matches table (Elo, start rating 500, and a K that depends on the player — see below).

#### Dynamic K — how far one result is allowed to move a rating

K is the step size of the Elo update, and one constant has to serve a player with three games and a player with sixty at once, so it is always wrong for one of them. High enough to place a newcomer quickly is high enough to let a single off-day knock a settled player down two rungs; low enough to hold the top of the ladder still is low enough that a newcomer spends a dozen mismatched games climbing out of the middle of the table. So K is no longer one number. `matchKPair()` sizes it per player, from how much the ladder actually knows about them:

- **Games played** (`DYNK_STEPS`): 64 for the first five games, 48 to ten, 40 to twenty, 32 to thirty, 24 to fifty, then 20 (`DYNK_SETTLED_K`). A new player finds their level in a handful of games instead of a season.
- **Time away** (`DYNK_RUST`): 90+ days since that player's last game lifts their K by a quarter, 180+ by a half, capped at `DYNK_RUST_CAP` (48). A rating three months old is a guess, and the first games back re-price it rather than defending a stale number.
- **Match format** (`formatReliability()`): K scales with how many games the match actually contained against a straight-sets best-of-3 (`DYNK_FULL_GAMES` = 12), floored at 0.6. One short set is a weaker signal than a full match and counts for less. No recorded scoreline means no penalty.

The per-player number is clamped to `[DYNK_MIN, DYNK_MAX]` = [12, 64], and the existing margin-of-victory multiplier then scales the match on top, as it always has. The clamp deliberately sits *inside* the margin multiplier: outside it, a big upset bonus shoves both sides against the ceiling and hands a newcomer and a veteran the same K in exactly the games where they should differ most.

**The two sides of a game now move by different amounts.** That is the entire point — a newcomer's placement swing must not drag the settled player they beat around with them — and it means the rating pool is no longer strictly zero-sum. The drift is not hidden: `computeStandings()` accumulates it into `ELO_DRIFT`, and the Lab's data audit reports the pool against `START x players + ELO_DRIFT`, so accounted-for drift reads as healthy and anything beyond it still reads as the bug it would be.

**What it deliberately does not touch.** Games created before `DYNK_START` (2026-08-29) keep the flat K=32 — the same date-gate pattern `MOV_START` and `BLOWOUT_FLOOR_START` use, so replaying the history recorded so far produces the ratings it has always produced, to the point. Games filed under an event (`tournament_id`) also keep the flat K, before and after that date, so no draw, event page, cup standing or exhibition changes meaning after the fact; they still count toward a player's experience for later ladder games. Multi-game Monte Carlo (season sims, forward projections) models a settled field and stays on the flat K, while the single-game "what would this result do" projections — the head-to-head table, the pre-match briefing, matchmaking, leverage and the route-to-#1 planner — use each player's live K via `playerLiveK()`, because that is what they would actually play for.

**Where it surfaces.** The top bar reads `live · K 20-64 · start 500` (`taglineText()`); a profile carries a *K next game* stat; a match modal shows the K each side actually played for beside the margin badge, and only once the two can differ; the head-to-head projection names both players' K under the table; and Help explains the whole thing in a line.

### 2. Home / Feed
Social feed: post composer, "moments" horizontal scroller, presence bar ("N on court" + stacked avatars when others are active), live activity ticker, "on this day" callback box, comments.

**YouTube links play in place.** Paste a link into a post, a match comment, a reply or a DM and it renders as a player instead of a URL — no extra field, no upload, and old posts pick it up too, since the link is read out of the body text (`socialBody()`). Unlisted videos work exactly like public ones; only Private doesn't. What lands in the card is a thumbnail and a play button until somebody clicks, so a feed of forty posts is forty images rather than forty YouTube players. Up to three videos per post; a fourth link stays as plain text rather than vanishing. While a video is playing, updates arriving from other people wait behind a "new activity — tap to refresh" pill instead of rebuilding the list out from under it.

### 3. Matches (Point Tracker / Archive / Rivalries) — subtabs
- **Point Tracker**: Enter player 1 / player 2 names → "Start tracking" begins a live point-by-point 1v1. Best-of-3, games to 6 win-by-2, tiebreak to 7 at 6-6. Plain incrementing point counts (0,1,2,3…), not tennis scoring. Every tap is undo/redo-able; nothing writes to the ladder until final Submit. Every tap is also **timestamped**, which is the whole basis of the rally reel described under Archive below — the ref pressing a button when a point ends is a more reliable record of where the rally finished than tracking the ball would be, and it was already happening.
  - Live celebrations: 8-8 in a game triggers a full-screen rainbow/confetti overlay; a game win shows a gold banner with the game number; a set win shows a flame overlay.
  - **Submit toward**: a tracked game files to the ladder by default, but a "Submit toward" picker on both the setup screen and the wrap-up lets the ref file it under any unfinished event instead — the FF Cup leads the list while it's on. Picking an event sets `matches.tournament_id`, the same field the admin tournament screens write, so the event page and the draw pick the game up with nothing new downstream. Whether the game *also* moves Elo is `tournamentCountsElo()` — the event's own `counts_elo` flag — rather than a second switch, so the two can never disagree: an exhibition cup files the result and leaves ratings alone. It does not leave the *app* alone — the note under the picker says so, because an exhibition still counts toward form, head-to-head, the records and every model (see **What an event counts for**). When the two players are an unplayed fixture in that event's draw, the round is attached too and the result slots straight into the bracket on approval. The choice is remembered between matches (a ref working a cup reffs the whole cup) and frozen onto the match at start, so resuming a draft can't re-file it under a target picked for a later game.
  - "Ref mode" pill badge next to the section title.
  - Built-in livestream panel: the match is broadcast from **a phone streaming
    app (Larix, Streamlabs, Prism) or OBS to YouTube Live**, and the app embeds
    the resulting stream (YouTube IFrame API) with the FGTA layer wrapped
    around it — live chat, ref-mode scoring from any device, a live-match
    directory, and fullscreen with chat/ref drawers over the picture. Any
    number of viewers, no relay, and the VOD stays on YouTube for free once
    the match ends.
    - **Nothing has to be set up to go live.** Point the phone app at YouTube
      and the site finds the broadcast on its own within a poll: a red **LIVE
      NOW** strip appears at the top of every view (`.live-mount`, rendered by
      `renderLiveMarquee()`), one tap from the picture, with no scoring, no
      session code and nobody's phone that has to stay on the page. The poll
      runs from wherever you are in the app rather than only the Point
      Tracker, and costs no extra quota — the answer is cached in the function
      and again at the CDN.
    - "Set up a broadcast" is the checklist for a *scored* stream: it mints a
      session code, hands over the app/OBS settings, and then **links itself**
      to the broadcast YouTube publishes — deliberately only one that started
      after the panel was opened, that nobody else is announcing, and that is
      the only candidate; anything else is a tap or a pasted link, and a
      deliberate unlink is never overruled. Nothing about the stream itself is
      controlled from the browser — camera, mic, framing, zoom and filters are
      all the streaming app's job now.
    - **Three ways the video survives**, described in full in
      `docs/youtube-live.md`: YouTube's own VOD (checked for real when the
      broadcast is closed); a `stream_log` table every client writes to, so a
      match stays findable after `/api/youtube`'s 25-upload window has moved
      on and so unlisted streams are recorded at all (`docs/streams.sql`,
      entirely optional — without it the app just has a shorter memory); and
      the local recording the streaming app makes on the phone while it
      streams, which is the copy that survives the upload dropping.
    - **The scoreboard overlay** (`overlay.html?code=XXXXX`) is an OBS Browser
      Source: a transparent page rendering the same score bug the old stream
      composited on-device, driven live off the ref's taps over Supabase
      Realtime. Because OBS composites it before encoding, it is always in
      step with the picture regardless of YouTube's latency.
    - An optional in-page score bug over the player covers streams with no
      burnt-in scoreboard, and watching a VOD back with the score. It is
      delayed by an adjustable amount (default 10s) to match YouTube's
      latency, since Realtime would otherwise announce a point before you see
      it.
    - `/api/youtube` (a Netlify function holding the API key) answers "what is
      live on the channel right now", cached and quota-conscious; see
      `docs/youtube-live.md` for the full setup and the quota arithmetic. When
      Google doesn't answer at all — quota gone, a 500, a DNS wobble — it
      serves the last answer it actually confirmed (up to six hours) marked as
      such, retrying a transient 5xx once first, so the listing doesn't empty
      out mid-match; the client backs off its polling on repeated failures and
      re-asks the moment the tab comes back to the foreground.
  - Live score "bug" overlay and a Match Point tension banner when the score is close.
- **Archive**: past-match history, editable "fix a game" flow that lets you flip a game's recorded winner if the point math still supports it, CSV export. Each match card also has **AI commentary** and **AI roast** buttons, backed by `/api/ai` (a Netlify function holding the Anthropic key — same pattern as `/api/youtube`); needs `ANTHROPIC_API_KEY` set on the deploy, and says so plainly instead of looking broken if it isn't.
  - **Rally reel** — any match scored point-by-point can be played back with
    the standing around removed. Cutting a recording down to the rallies is
    normally posed as a computer-vision problem; it isn't one here, because
    the ref already tapped a button every time a point ended and those taps
    are an exact record of where each rally finished. The one thing nobody
    recorded — where the serve fell inside the gap between two taps — is a
    slider rather than a guess dressed up as a measurement.
    - **Watching costs nothing.** The player is seeked past the dead time, so
      there is no render, no file and no upload; the video stays on YouTube.
      Filters (long rallies, pressure points, game winners, aces, per player),
      a jump list that follows playback, and 1×/1.5×/2×.
    - **The sync is automatic.** A VOD's timeline starts when the stream
      started and `/api/youtube` reports that instant, so the match clock and
      the video clock differ by one constant. It lands within a second or two,
      and an offset control covers the rest — admins can save a corrected
      offset back to the match for everyone.
    - **The real cut happens elsewhere.** Exports an `ffmpeg` script (one
      re-encoded segment per rally, joined — a stream copy could only cut on
      keyframes), a JSON cut list, and YouTube chapter markers. A phone should
      not be transcoding an hour of tennis and does not have the camera
      original anyway.
    - Needs one column — `matches.rallies` — see **`docs/rally-reel.sql`**.
      Without it nothing breaks: submits drop the field and retry, no match
      ever has timings, and the button simply never appears. The full workflow
      is in **`docs/rally-reel.md`**.
- **Rivalries**: pick two players to see head-to-head history, rating swing, and trend; a "fiercest rivalries" leaderboard by games played.
- **Auto-cut**: the rally reel above needs the umpire's taps, so it only exists for matches somebody scored in the app. This is the same edit for footage nobody reffed — drop in a clip or a whole recording and it finds the rallies itself.
  - **It listens rather than watches.** A court is full of motion that isn't a rally, but a struck ball is a loud broadband click and almost nothing else on a court is — and a rally isn't one click, it's a *run* of them about a second apart with silence either side. Dead time contains no strikes at all. Difference the samples → RMS envelope → rising edge of its log (level-independent, so mic distance stops mattering) → peak-pick against a local threshold and two absolute floors → group → require one properly struck ball in the group.
  - **Measured** on synthetic matches with known ground truth across six conditions (near mic, windy, distant mic, players talking, players bouncing the ball before serving, all at once): every rally found, 0–1 false positives per 20 minutes, 54–57% of the runtime cut, ~200ms of analysis per hour. Real footage isn't synthetic footage, which is why every threshold is on a slider and the output is a **review list** with keep/drop rather than a finished file.
  - **The limit it can't engineer away**: an adjacent court in use sounds exactly like yours. The panel reports strikes-per-minute (a real singles match runs 15–25) so a bad result is obvious before you review it.
  - **Nothing is uploaded** — the file is read and decoded in the browser; there is no server here that could receive a video. Past ~1.2GB a tab can't hold the decode, so it hands over a one-line ffmpeg command to extract just the audio, which shares a clock with the video and cuts identically.
  - Exports the same ffmpeg script and JSON cut list as the reel, from the same generator. See **`docs/auto-cut.md`**.

### 4. Predict
Forecast / Live & sims / Fixtures subtabs — win-probability model, Monte Carlo match simulation, and a "Rating Galaxy" force-directed canvas visualization (players as nodes sized by rating, rivalries as glowing links).

### 5. Analytics
Overview / Rating models / Validation / Story & records subtabs — 18 advanced stats: Clutch Factor, time-of-day performance splits, nemesis detection, redemption tracking, record book, rookie board, vibe tagging, team Elo, Glicko-2, a Markov point-transition model, Dominance Ratio, recency-weighted Elo, workload (ACWR), umpire ratings, and more. Charts are inline SVG line/bar charts with a shared JetBrains Mono axis-label style.

### 6. Court
Live local weather (Open-Meteo, Toronto) driving ambient theming: background tint + a subtle canvas particle overlay (rain streaks, snow, fog, twinkling stars) behind the app, gated off on mobile for performance.

Below the home court's busyness chart sits **Other courts in the city** — every one of Toronto's 173 tennis locations, each timed from the clubhouse at 47 Thorncliffe Park Dr. A row carries the site (court count, lights, winter play, club operator if any, address) on the left, its transit and drive times in the mono face on the right, and two Google Maps links that recompute both routes live with current traffic. Filter chips cut the list to the shortlist worth travelling to (public · lit · 3+ courts, 37 sites), lit courts, winter play, or club-operated courts; a sort control switches between transit time, drive time, and court count; the search box reaches past the active filter so a park you can picture never comes back empty. Our own court is flagged in the list and matched by street address.

The data is embedded in the page (`NEARBY` in the Court section of the script) — no request, no key. Sources and their limits:

- **Courts** — City of Toronto Open Data, *Tennis Courts Facilities* (Parks, Forestry & Recreation asset register), pulled 2026-08-27. `Lights = Yes` means lights are installed; it does not promise they are on, free, or scheduled. Coordinates are one point per park, usually the centroid rather than the court gate, so allow a couple of minutes of walk error.
- **Drive times** — free-flow OSRM routing on the OpenStreetMap road network. No traffic model, so anything over ~15 minutes is a best case, not an expected time.
- **Transit times** — live TTC + GO GTFS through Transitous (MOTIS), baselined on a Saturday 10:00 a.m. departure, door-to-door including walking and waiting. Only computed for the sites worth travelling to (the shortlist plus club courts inside a 12-minute drive); everywhere else shows an em dash and sinks to the bottom of a transit sort.

### 7. Events
Tournament creation (admin) and bracket/format display; round-robin, knockout, hybrid and **Robin+** supported. Upcoming tournaments show a countdown; admins can go live, edit schedule, or delete a tournament.

#### Robin+ — the group-into-bracket format
The default format, and the only one with a full interactive flow rather than a bare "add a game" form. Everyone plays **exactly two** group games, the top 4 qualify, and those 4 go straight into semis → final. It is an **exhibition by default — Robin+ games never touch Elo**. The FF Cup runs under it, so the cup is an exhibition too. Exhibition means *no Elo*, and nothing more than that: cup games count toward form, streaks, head-to-head, rivalries, the records and every predictive model in the app. See **What an event counts for** below.

- **The ring.** Two games each means the group is a 2-regular graph, i.e. a ring: sit the field in a circle and each player plays their two neighbours. N players, N games, no byes, nobody sits out. It's drawn as an SVG circle in the event panel — edges light up as games are played, and the next game pulses.
- **The draw is searched, not shuffled.** `rpSolve()` scores candidate rings on three competing objectives and refines them with 2-opt (a tournament draw is a travelling-salesman problem where "distance" is how bad a matchup would be): **closeness** (Elo-expectation, superlinear so one blowout costs more than two mild mismatches), **fair draw** (the spread of average-opponent-rating across the field — with only two games, drawing the two strongest players eliminates you by luck rather than form, so this is penalised directly), and **freshness** (recency-weighted rematch penalty, ~45-day half-life). Seeded from a rating "snake" plus 28 random restarts. A "Why this draw?" panel shows the numbers.
- **Order of play** is sequenced separately so nobody plays back-to-back where the ring allows it, with the closest matchup held back for last.
- **Exactly four is a different group.** With four in the field there are four bracket seats, so nobody can be cut and a ring would be four dead games. The group becomes a **double round robin** instead — everyone plays everyone twice, 12 games, six each, split into two legs with the sides swapped — and the table *seeds* the bracket (#1 v #4, #2 v #3) rather than trimming it. A group loss costs you the top seed and the easiest semi, not your place. There is nothing to draw here (every pairing happens regardless), so `rpSolveDrr()` only solves the order of play; the opening one or two games can be pinned by hand.
- **The return leg can be shortened.** Twelve games need twelve days, and events run late. `rpTrimOptions()` offers to cut leg 2 down — to two games a player, or one — while **leg 1 is never touched**, so every pairing has still been played at least once. The one hard rule is that everyone comes out on the *same* number of games, or the table is comparing players who played different amounts of tennis: that makes the surviving return games a k-regular graph on the field, which at four players means the games that come off are a pair with no player in common. All the ways to do that are enumerated and scored on the same three objectives the ring uses, and the admin picks — games already played are pinned automatically and can never be dropped, and any fixture can be pinned by hand (the one the players have their hearts set on). Round keys never move, so recorded results and calendar days stay attached to their fixtures; what comes off is remembered in `state.trim`, days included, so **Put the return leg back** restores it exactly. The group picture, the standings note and the "why this schedule?" panel all read the shortened schedule rather than assuming a full one — including a **draw spread** that reads 0 for a complete double round robin and rises as a shortening tilts someone's opponents.
- **The cut.** Ranked on points → head-to-head → game difference → games won → strength of opposition → ladder rating. A group game can be drawn, so the table is ordered on **points — a win is 1, a draw is ½** — not on wins: ranking on wins alone made a draw worth exactly what a loss is worth, so an unbeaten 2-0-1 sat level with a 2-1-0 and got sent to a decider against them. The record column reads **W-L-D** and always prints all three numbers, so a draw can never read as a loss (or hide behind a column the row above it doesn't have). Anything results can settle *is* settled on results; **anything still level across the 4th/5th line plays a 1v1 decider for the spot** rather than being broken on a tiebreak column. `rpPlayoffPlan()` picks the decider shape from the arithmetic: 2 level for 1 spot → one game; 5 level for 4 → the bottom two play; 3 level for 1 → a mini knockout with a bye to the better seed; and (vanishingly rare) 5+ level for 2 → the same ring format run among the tied.
- **Bracket** seeds #1 v #4 and #2 v #3, with an optional 3rd-place game, then crowns the champion.
- Admins record results by tapping a fixture; every stage is derived from the `matches` rows, so undoing or editing a result months later re-resolves the whole event.

#### The forecast — who actually wins this thing
Between "here is the table" and "here is the draw" sat the only question anyone was actually asking, and in this format it is genuinely hard to answer by eye: qualifying is not winning, the group sets the *seeding* as well as the cut, and drawing the #1 seed in a semi can cost more than finishing third instead of second. So the event page plays the rest of the tournament out — **4,000 simulated tournaments from where this one actually stands** — and reports, per player, how often they qualify, take the #1 seed, reach the final and lift it.

- **Every result on record is kept.** A forecast that re-imagines played games is not a forecast of this event. Group games are replayed as results (points *and* game difference, both sides of the row's orientation); knockout games are replayed as a name, which is all a knockout game is, and is what stops a semi-final reported by the loser from advancing the wrong player.
- **Strength is the live ladder power rating** — `predictiveRating()`, the same Elo + form + peak-gap + reliability + scouting-prior blend every other forecast in the app runs on, so the cup page and the ladder's own odds can never disagree about who is better. Cup results feed it through form: the event is an exhibition to the *ladder*, not to the models.
- **It runs the real rules, not a simplified copy.** Every simulated result goes back through the same `rpQualification()` the live table uses — the same points → head-to-head → game difference → games won → strength-of-opposition ordering, the same cut, the same 1v1 decider when the line is level — and then the same #1 v #4 bracket. That is what `rpRealResult()` is for: the engine reads results through an accessor, so a simulation can hand it imagined ones and get the format's own answer back. Change the format and the forecast changes with it, because there is only one implementation of it.
- **Margins are read off the event's own scorelines.** Game difference only ever breaks a tie, but ties at the qualification line are exactly what this format is built around, so guessing the margin badly changes who qualifies. A group playing 10-point breakers and a group playing full sets produce very different numbers and neither is wrong; with fewer than three scorelines it falls back to the league, then to a plain default. Draws are sampled at the league's own observed rate, which is usually zero — inventing a draw rate would invent qualification scenarios that cannot happen.
- **What tonight is worth.** The next unplayed group fixture gets its own line: the rest of the event is simulated twice more with that one result pinned each way, and the gap between the two **title** odds is what the players are actually playing for. Title, not qualification — qualifying is not the prize.
- Deterministic and cached. The seed is fixed and the result is keyed on the field, the draw and every result on record, so re-rendering the page (or scrolling away and back) reuses the numbers rather than re-rolling them. It computes off the paint — about 50 ms for a five-player field including both swing runs — so the event page never stalls waiting for it. Hidden at the setup stage (nothing to play out) and once a champion is crowned (nothing left to guess).

**Hybrid events get the same panel, computed exactly.** A hybrid is four games and the shape is known from the start — top 3 off the ladder, a 4v5 play-in, semis, final — so there is nothing to sample: `hybridForecast()` walks every path through the bracket and weights it, which makes the numbers the exact ones the model implies rather than an approximation of them. Round-robin and straight knockout have no fixture list to play out, so they get no forecast.

#### What an event counts for
One flag used to answer two different questions. `counts_elo` decided what a game was worth on the ladder, and because every stat and every model read the same filter, it also quietly decided whether the game had *happened*. So the FF Cup — three weeks of the year's best-attended tennis — produced no form, no streaks, no head-to-head, no rivalries, nothing in the records and no data for a single one of the predictive models.

The two questions are now asked separately:

| | `countsForElo(m)` | `countsForAnalysis(m)` |
|---|---|---|
| asks | does this move the ladder? | did this happen? |
| set by | the event's `counts_elo` | the event's `counts_stats` (optional, defaults true) |
| drives | standings, the rating timeline, #1 reigns, the dynamic K, `ratingSeries()`, and the two tools that rewrite ladder history (butterfly, alternate timelines) | form, streaks, head-to-head, rivalries, records, activity, league stats, fixtures, strength of schedule, league health, player of the week, the galaxy map — and the models: Glicko, Glicko-2, recency Elo, Bradley-Terry, bootstrap, PageRank and all three prediction logs |

The line between them is *"is this the ladder's own rating?"*. The narrow filter has to reproduce the ladder to the point, or a profile and a chart of the same player disagree. Everything else moved to the wide one, because a cup game is a real game between two real players and dropping it makes every stat and every model worse. One consequence worth knowing: the three prediction logs are now explicitly the **model's** history rather than the ladder's, and say so in the code — they still walk the same match set as each other, because the ensemble joins them by match id.

`counts_stats` is the escape hatch for an event that genuinely should not be described either — a handicap night, a joke format, a bracket full of test rows. It is **optional**: no column, no flag, and everything counts, which is what anybody would expect. `docs/tournament-stats.sql` adds it when you need it.

Requires one column — `tournaments.bracket` — see **`docs/robin-plus.sql`**. Without it the app still works but the draw is stored in the admin's localStorage and won't sync to other devices; the UI says so.

### 8. Doubles
Report a doubles match (same Elo engine, scoped to the pairing) and view doubles team standings.

### 9. Training — casual play + calendar
- **Log a casual session**: date, game type (1v1 / Kings court / Casual doubles), a dynamic list of player rows (name + minutes played each, add/remove rows, minimum enforced per type), optional notes.
- **Calendar**: a month grid (Mon–Sun) with a colored dot per day for anything that happened/will happen that day — casual sessions (cyan), approved ladder matches (pink), tournament start dates (gold), and scheduled-but-not-yet-played matches (white). Clicking a day highlights it (2px accent-yellow border + filled background) and shows a detail list below with who played, for how long, and match/tournament labels. Prev/next month navigation.
- **Weekly availability**: a 7-day × 3-slot (Morning/Afternoon/Evening) toggle grid per player.
- **Smart scheduler**: pick two players, see their overlapping free windows.

### 10. Messages (DMs)
Direct messages between players, two-pane layout (conversation list + thread) collapsing to single-pane on mobile.

### 11. The Kit — rackets, strings, and the hours already on record
Rackets and string jobs per player, and the one question anybody asks about a string bed: is it still any good?

Every answer to that in circulation is a rule of thumb about a number nobody has — "restring as many times a year as you play per week". It is a proxy for playing **hours**, and a poor one: it cannot tell a season of forty-minute hits from a season of three-set finals, and it quietly assumes the string was fresh in January.

This app does not have to guess at the hours. **It has been recording them all along, for other reasons**, and `kitHoursFor()` reads them back out in three tiers, best first:

| tier | source | how good it is |
|---|---|---|
| **tracked** | a point-tracked match carries `rallies`, and inside it the instant the ref started and the instant the match ended | exact, to the second |
| **scoreline** | any other approved match has a set score, and a set score is a game count | a decent estimate (`KIT_MIN_PER_GAME`) |
| **practice** | the casual-session form already asks for minutes **per player** | exact, as reported |
| **assumed** | an approved match with nothing else written down | a flat hour |

A ref who forgets to press stop leaves an eight-hour match on record, so a tracked reading outside `[4, 240]` minutes falls back to its scoreline rather than putting an afternoon on somebody's strings. A match tiebreak written in the sets column (`10-8`) is scored as the short thing it is, not the fifteen-game set it looks like — the same correction the dynamic K makes, for the same reason.

**Every card shows the split**, as a bar and in words ("4.2h timed by a ref · 2.8h logged sessions · 1.6h from scorelines"), and says so plainly when most of its own total was estimated. The hours are the only part of this screen that is real; the reader is entitled to know how real.

#### The decay curve
`kitRemaining()` is a two-clock model per material (`KIT_STRINGS`: poly, multifilament, synthetic gut, natural gut, hybrid, kevlar):

- **bed-in** — the ~10% a bed loses in its first day or two, before anybody hits a ball. **It is not charged against playability.** A stringer pre-stretches for it and "strung at 52" has always meant the tension it settles to. An earlier draft counted it and reported a brand-new racket as a third gone: technically true against the machine reading, and useless as a description.
- **play** — exponential in hours hit, with a per-material constant.
- **age** — exponential in days elapsed. Polyester goes off on the shelf; natural gut barely notices. This is why the countdown takes the player's actual weekly rate: a bed that comes out once a fortnight has **fewer** usable hours left than one played every day, which is exactly what the hours-only rules of thumb get wrong.

**Playability** (0–100) is the smaller of two clocks — tension gone, or the string physically worn — and `kitBinding()` says which, because "the tension went" and "it wore through" call for different strings next time, not just a restring. The two clocks are deliberately set close to each other per material, and **which one binds first is the claim each row of `KIT_STRINGS` makes about its string**: poly and hybrid go dead while perfectly intact (the reason a pro restrings between matches); everything else notches or breaks while still holding a usable tension. `test/kit.test.js` asserts that ordering per material, so retuning a constant cannot quietly reverse it.

**The score is monotone, on purpose, and it costs something.** A poly bed genuinely does not feel its best in its first hour. An earlier draft modelled that as a rising ramp and the score climbed for two hours before falling; it was defensible and it was a bad idea, because a headline number that can go *up* invites the reading that the strings tightened themselves. So break-in is **reported** (`brokenIn`, "still breaking in") rather than priced in.

#### What it is honest about
The constants are published rules of thumb, not measurements — nobody here owns a tension meter, and the panel says so in a footnote rather than printing a tension to one decimal place and hoping. What the model is good for is **the ordering and the shape**: which bed is further gone than which, and roughly when this one stops being worth playing with.

#### What it feels like today, which is not what it measures
A string bed is a polymer under load, and polymers stiffen in the cold. The same racket, unchanged since the morning, plays tighter at 4° than it did at 24° — noticeably, in the direction everybody blames on the balls. So a Kit screen reporting one tension all year is telling the truth and still not answering the question, which is *why is this thing playing like a board today*.

The app already knows the temperature: the ambient background fetches Toronto's weather for its particle layer and the court's busyness model reads that same cached answer, so this is the **third reader of a number already on the page** and costs no request. `kitFeelShift()` expresses it in **effective pounds** — the unit anybody discussing this would use — roughly a pound per eight or nine degrees from a mild afternoon, capped, and scaled per material: polyester moves most, natural gut barely notices, which is one of the reasons people play gut in the cold. No reading means no shift *and no sentence*, so "no weather" can never read as "mild".

#### The bag check
Everybody's current bed, worst first. The per-player screen answers "should I restring"; this answers the question the group actually asks each other, and it is why the Kit is worth having as a shared page rather than a note on somebody's phone. It also does something useful by accident: a player who has never logged a stringing is conspicuously absent from a list everybody else is on.

#### The rest of the screen
- **Live cards**, one per frame currently strung: band colour as a top rule, a playability meter, tension now vs strung, hours on it, days on the racket, why it is going, and "about 9 days at 3.2 h/week".
- **The curve**, inline SVG in the app's own chart idiom, with the bed's position on it and the restring line marked.
- **History** — retired beds, each **frozen at the moment it came off** rather than still accruing hours it never played. Without that, a season of history reads as a column of dead beds, which is true of the string and useless as a record. Cutting a bed out therefore writes a date (`removed_at`) instead of deleting the row, which is the only way "it lasted 31 days" is knowable later.
- Requires two tables — see **`docs/kit.sql`**. Both optional; without them the screen explains what it would do and points at the file, because "we never created that table" and "you have not added a racket yet" look identical from the outside and want completely different actions from the reader.

## The command palette (⌘K)
The app grew to ten top-level views, nineteen sub-tabs and well over a hundred actions living behind a menu, a sheet, a sub-tab or a scroll. Reaching "the validation tab of Analytics" is four taps and knowing where it lives; reaching the FF Cup draw means knowing Events hides behind the More sheet on a phone. Fine for the handful of people whose habits grew alongside the app, hostile to everybody else.

**⌘K / Ctrl-K from anywhere**, or `/` when not typing into something. It is a **superset of the old search box**, not a second one beside it: players, matches, posts and #tags are four of its providers now rather than the whole list, and the ⌕ button opens this. `openSearch()` / `closeSearch()` survive as aliases so nothing written against the old box needed to change.

**The hard part is the ordering, not the list.** With ~200 candidates and a two-letter query a substring filter returns thirty rows in array order and the one you meant is nineteenth. So `cpFuzzy()` scores a subsequence alignment — the shape of thing an editor's file finder uses — as a dynamic program rather than a greedy left-to-right scan, because greedy gets "app" in `a-pretty-app` wrong (it takes the leading `a`, then the `p`s of "pretty", and never sees the whole word sitting there). Bonuses for prefixes, word starts, camelCase boundaries and consecutive runs; penalties for gaps and unmatched tail. Then `cpRank()` adds each item's standing weight and a recency boost, and caps how many rows any one group may contribute so forty players cannot bury five commands.

- **`keys` is the highest-leverage field in the registry** — the words a label does not say out loud. It is why "restring" finds The Kit and "glicko" finds Rating models.
- **Recency reorders equals, it never promotes a bad match.** Half-life decay (`cpRecencyBoost`), and the whole boost is deliberately worth less than a prefix match — so picking Backup once floats it for "do", and "doub" still means Doubles.
- **Weight is added, never multiplied**, so a heavyweight cannot win on a bad match: "d" must not open Doubles just because Doubles is important.
- Group headings appear **only when there is no query**. With a query the order is the ranking's, so the groups interleave and a heading at every run boundary read as a rendering fault rather than as information.
- Proper combobox/listbox ARIA — focus stays in the input and `aria-activedescendant` moves — rather than a list of buttons Tab has to walk.
- The core is pure and lives in the `CP-CORE` sentinel region; `test/palette.test.js` holds it to every promise above with no DOM at all.

## Mobile Navigation
- **Desktop (>=860px)**: horizontal top tab bar with an animated underline indicator. Ten tabs is the most it holds; **The Kit deliberately is not one of them** — it lives in the ☰ utility menu, the More sheet and ⌘K, because an eleventh tab pushes Messages off the end.
- **The bar used to clip silently.** Between the 860px breakpoint and about 1400px the ten tabs overflowed, and because the scrollbar is hidden (right on a phone) there was no scrollbar, no fade and no indication at all — on a 1280px laptop, the commonest desktop width there is, Messages simply was not there. Fixed in two layers: the tabs tighten across 860–1440px so they fit, and `moveTabIndicator()` — the one function that already measures this bar, on every view switch, resize and webfont load — now also sets a `.tb-cut` class that fades the right edge when anything really is cut off. It is also called once on the way in, because every trigger it had was an *event*, and a first paint at an overflowing width fires none of them.
- **Mobile (<860px)**: top tab bar hides; a fixed bottom nav bar (.botbar) shows the 5 most-used views (Ladder, Home, Matches, Predict, Stats) plus a "More" button.
- **"More" sheet**: a bottom sheet (slide-up panel + backdrop) listing the remaining views as a 2-column icon grid: Doubles, Training, The Kit, Court, Events, Messages, Search, Surface (cycles court-surface theme), Stadium (ambient stadium-mode toggle), Help. *(Doubles and Training were previously missing from this sheet — a mobile nav bug fixed in this design pass — make sure the target implementation includes every view here.)*
- A secondary fixed bar sits above the bottom nav: a scrolling "live ticker" of recent results/comments (marquee-style horizontal scroll, pauses on hover/tap).

## Accessibility
Most of this was already right — a real focus-trap and `aria-modal` on every dialog, one polite live region for the whole app rather than `aria-live` on a rebuilding scoreboard, `:focus-visible` rings that survive every skin, and a full `prefers-reduced-motion` pass. What was missing was the structure a screen reader navigates *by*:

- **No `<h1>` anywhere.** The wordmark was the page's title in every sense except the markup, so heading navigation started at an `h2` inside a panel, or nowhere. It is an `h1` now (with the margin/size resets that stop the browser's defaults rearranging the top bar around it).
- **No `<main>` landmark, and no skip link.** A keyboard user's first Tab landed on the FF Cup chip and then walked all ten nav tabs before reaching a word of content. The content wrap is `<main id="main">` and there is a standard skip link — off-screen until focused, then the first thing on the page.
- **22 form controls with no accessible name at all** — every filter on the Matches archive, both scheduler pickers, the casual-session date and type, the tournament format and Elo selectors. Eight had a visible `<label>` that was simply never associated with a `for`; the rest have no visible label because their own option text carries the meaning on screen, so they get an `aria-label` and nothing moves. Three buttons whose text is filled in by script were empty in the markup a screen reader first meets.

## Print
The whole visual system here is borrowed from a tournament's printed programme — a white ground, near-black green type, gold for what has been won — and it had never been printable. `⌘P` produced the fixed top bar overlapping the first rows, the bottom nav stamped across the footer, the ticker, and the leftovers of every hidden view.

There are real reasons to want it on paper: a draw pinned to the clubhouse noticeboard, the standings for somebody who does not use the site. So there is a proper print sheet rather than a `display:none` sweep — it pins the palette back to the base scheme (the weather themes and cup skin retint everything through *inline* custom properties at runtime, which no print sheet would otherwise beat), removes the chrome, and prints the one view that is open.

- **Entry panels are marked `data-print="hide"`, not guessed at by selector.** An empty text field prints as a filled dark rectangle, and a printed form is not a form — nobody is writing a set score onto paper and handing it back to the website. Printing is for reading a record. A future entry panel opts out by saying so; something inside one that *is* worth printing opts back in with `data-print="keep"`.
- **`print-color-adjust` is deliberately not forced on.** A reader who turned background graphics off did so on purpose, so nothing carries meaning by colour alone once the fill is gone: rank medals become a rank in a weighted ring, the Kit's band keeps its word as well as its colour, meters keep a border.
- Links print their URL once; `#` and `javascript:` links do not.

## Two things the re-skin left behind
The move to the white "Championships" palette landed six commits before this pass and missed two places, both of which had visible consequences.

**`SURFACES` was still the previous era's dark theme.** `applySurface()` writes `accent`, `dim` and `tint` as *inline custom properties on `<body>`*, and an inline custom property beats every rule in the stylesheet — the code's own comment already knew this, which is why the FF Cup skin deletes those three properties rather than trusting them. Without a skin running there was nothing to catch it, so every load overwrote three design tokens with a near-black purple (`--accent-dim`) and a near-black green (`--bg`). **Fifty-two rules paint a background from one of those two**, including `input, select`, `.composer textarea` and `.match-filter input` — which is why every text field on a white site rendered as a dark box — plus `.pred-tag`, `.cs-btn.on`, `.ch-pill.ch-yes` and the rest, which expected a pale tint. The accent itself was a light lilac on a page whose whole system is championship green. The three surfaces are now court colours inside the current palette (7.5:1, 6.2:1, 8.7:1 as text on the page, all carrying white type on a filled accent).

**`justify-content: center` on a bar that overflows.** A centred flex container pushes its overflow past the *start* edge, and that overflow is unreachable — you cannot scroll to negative. So at the widths where ten tabs do not fit, the first tab was clipped on the left with no way to reach it, in a bar that also scrolls. `safe center` falls back to `flex-start` exactly when overflow happens, which is the whole reason the keyword exists.

## Interactions & Behavior
- **Undo/redo**: point tracker and admin edit flows keep an action stack; nothing is persisted to Supabase until an explicit Submit.
- **Cursor tilt**: small podium/medal cards (.pod) get a cursor-tracked 3D tilt (perspective(900px) rotateX/rotateY, max 10°, plus a slight lift/scale) on pointer move, resetting smoothly on pointer leave. *Intentionally NOT applied to full-width panels or list rows* — that combination reads as broken "panning" rather than depth, per direct user feedback during this build.
- **Ghost cursors**: on desktop only, other connected users' live cursor positions are broadcast over a Supabase Realtime channel and rendered as a colored teardrop + name tag following their pointer around the page. Disabled on touch/mobile viewports (no meaningful hover position, and it was confusing mobile users who saw an unexplained floating name badge).
- **Sound**: synthesized (Web Audio, no audio files) cues for point/game/set/match wins and the 8-8 celebration.
- **Toasts**: bottom-center, auto-dismiss, used for all success/error feedback instead of alerts.
- **Modals**: centered, backdrop-blurred, used for match detail, edit flows, and confirmations.
- **Animations**: eased with cubic-bezier(.16,1,.3,1) (entrances) or cubic-bezier(.4,0,.2,1) (micro-interactions); everything is neutralized under prefers-reduced-motion: reduce.

## State Management
No framework — plain module-level JS arrays/objects re-rendered via innerHTML on data change:
- matches, comments, tournaments, posts, scheduledMatches, practiceLog, availabilityData, playerRoster, rackets, stringJobs — all mirrors of Supabase tables, refetched on load and on postgres_changes realtime subscriptions.
- `kitTables` — which of the Kit's two optional tables actually answered. `load()` already treats a failing table as "keep what is in memory", which is right for every other table and not enough for these two: an empty bag and a table that was never created look identical and want completely different sentences on screen.
- presentUsers, ghostCursors, presenceChan — ephemeral realtime presence/broadcast state (Supabase Realtime channels), not persisted.
- Point tracker keeps its own local PT state object (per-game point arrays, undo/redo stacks, timer) until Submit inserts a row into matches.
- Calendar keeps calCursor (visible month) and selectedCalDay (highlighted day key) as local UI state.
In the target codebase, model these as: a data layer (whatever the app already uses — React Query, Redux, plain hooks, etc.) for the Supabase-backed collections, plus local component state for in-progress/unsaved flows (point tracker, casual-session form, calendar selection).

### Writes are optimistic
Every write goes through one helper (`optWrite`) rather than talking to Supabase directly, because the naive shape — await the insert, await a full refetch, then paint — cost about a second of frozen UI per tap on a phone.

- **The change is applied locally and painted first**, then the round trip runs behind it. A refused write is peeled back off, the UI repaints without it, and the person gets a plain sentence ("You're offline — that didn't send") instead of raw Postgres.
- **Each store keeps a *base*** — the last rows the server confirmed — and the live array is always base with every in-flight change folded over it. Rolling one write back is dropping its fold and rebuilding, so a failure in the middle of three queued writes doesn't take the other two with it.
- **A refresh landing mid-flight re-lays** the still-pending changes over the new server rows, so a row you just typed doesn't blink out and back.
- **Optimistic rows carry a negative placeholder id** until the server issues a real one. They render dimmed (`.opt-pending`, `aria-busy`) with their id-dependent controls held back, and admin actions refuse to act on them.
- **Text is never lost.** A failed post, comment, reply, DM, poll or match report puts what was typed back in the field it came from.
- **Refreshes are coalesced.** Post-write confirmations and `postgres_changes` events share one debounced pass, so a busy minute in the feed costs one refetch rather than one per row touched. That pass fetches all fifteen tables in parallel.

If the target stack has React Query / SWR / RTK Query, this maps directly onto their optimistic-mutation primitives (`onMutate` + `onError` rollback + coalesced invalidation) — don't reimplement the bookkeeping by hand.

### …and a failed write is kept, if it never left the phone
This app is used **courtside**, on a phone, at a public park under a hydro corridor. Every write already failed *honestly* when the signal was gone — and honestly is not the same as usefully, because the person is standing there holding a completed match with nowhere to put it.

So a failure is now sorted into two piles, and **everything else is downstream of getting that sort right** (`oqClassify`):

| | what happened | what to do |
|---|---|---|
| **refused** | the server answered, and its answer was no — RLS, a duplicate key, a dangling FK, a column that was never migrated | roll it back and say so, exactly as before. Retrying is pointless and, for a duplicate, worse |
| **network** | nothing reached the server — no signal, DNS, a captive portal, a 5xx from a proxy, a 429 | keep the change on screen and park the write in the **outbox** |

The classifier is **deliberately biased toward "refused"**, because the two mistakes are not symmetric: a wrongly-queued write retries forever against a server that will never take it and sits in somebody's outbox looking like unsent work, while a wrongly-dropped one loses something the caller has already put back in the form. Anything it does not confidently recognise is a refusal. `test/outbox.test.js` is mostly that asymmetry, written out as the real messages Postgres, PostgREST and four browsers actually produce — including the ordering traps (a 5xx body that mentions "duplicate"; a refusal that mentions "network").

- **A descriptor, not a closure.** `optWrite` takes a `write` function and a function cannot be written to localStorage, so a queueable call passes a plain `{table, op, row, optional, label}` alongside it and the outbox rebuilds the Supabase call from that on the way out. It is **opt-in per call site**: a write nobody has thought about being replayed twenty minutes later, out of order, should fail honestly instead. Currently on: reporting a game, submitting a reffed match, logging a session, logging a stringing.
- **A reffed match is the worst thing in the app to lose** — two hours of somebody's afternoon, tapped in point by point. `ptSubmit` queues it and lets them put the phone away.
- Retries on `online`, on the tab coming back, and on a jittered backoff (1.5s → 5min) so a clubhouse of phones rejoining the same wifi do not all fire at once. Serial, stopping at the first thing still not sending — if the signal is gone it is gone for all of them.
- Items retire by age (a week) and by attempt count, so nothing retries to the heat death.
- A standing pill ("2 things waiting to send"), not a toast: it is a state, not an event, and it survives a reload — which is the case it exists for, a phone closed at the court and opened again at home.

**One bug this exposed, and it is the reason the outbox is wired before anything else.** `supabase` comes from a CDN `<script>`. When that request fails — which is *precisely the offline case* — the identifier is undefined and `sb = supabase.createClient(...)` threw an uncaught ReferenceError that stopped the script dead. Measured on an offline load: everything defined above that line survived, everything below it never ran. That is the **whole Admin Studio** (`SITE` left in the temporal dead zone, so even `typeof SITE` threw) plus the tail wiring. The client is built inside a `try` now, `sb` stays null, and the app degrades to the offline shell it was already designed to be instead of half-executing.

## Design Tokens

### Colors (CSS custom properties in the source)

The palette is **a championship on paper**: a white page, near-black green
type, championship green for anything interactive, purple as the secondary and
gold for anything earned. It replaced a near-black "neon grape" base with a
hot-pink accent; that old palette is still available as the **Neon grape**
preset in the Admin Studio, so nothing was lost, it was demoted.

The only dark surface is the **chrome** — the fixed top bar, bottom bar and
ticker are championship green with ivory type on them, the way a scoreboard
frames a white court. Everything inside them is black-on-white.

- Background: --bg #FFFFFF
- Panel surfaces: --panel #FFFFFF, --panel-2 #EDF2EE (hover/raised)
- Hairlines: --line rgba(16,38,26,.18), --line-soft rgba(16,38,26,.09)
- Text: --ink #10261A (primary), --muted #41564A (secondary), --dim #61776A (tertiary/labels) — 15.9:1, 8.5:1 and 6.1:1 on white
- Primary accent (championship green): --accent #00623C, --accent-dim #E3EFE7, --accent-glow rgba(0,98,60,.22)
- --on-accent #FFFFFF — type sitting **on** a filled accent, gold or court surface. Move it with the accent or a button goes unreadable.
- Chrome: --chrome #0B3B26, --on-chrome #F5F2E9, --on-chrome-dim rgba(245,242,233,.68), --chrome-line rgba(245,242,233,.20)
- Secondary accent (purple, the "loudest thing allowed"): --accent-pop #52247F
- Supports: --accent-split-a #7A5FA6, --accent-split-b #1F6E8C
- Court/grass: --court #1C6B45, --court-dim #E3EFE7
- Ball: --ball #6E7C10 — the olive a tennis ball reads as **in print**, because this token is a text colour in ~18 places. The ball graphic itself carries its own fluorescent literals.
- Medals, two sets, because a metal has two jobs:
  - as **text**: --gold #8A6A1E, --silver #63685F, --bronze #8A5524 (7.0:1, 6.6:1, 5.5:1 on white)
  - as **fill** on a badge or plinth: --medal-gold #D4AF37, --medal-silver #C2C6C4, --medal-bronze #C08A4E, with --on-medal #2A2008 on top
- Semantic: --danger #B23A2E, --pending #8A6A1E, --win #166B41
- Weather particles: --wx-ink "90,114,104" — an `r,g,b` triple the weather canvas composes its own alphas onto, so rain and snow are the paper's shadow rather than a fixed near-white

Every colour ever used as text clears 4.5:1 against --bg, --panel *and*
--panel-2, in the default palette and in all three weather themes. The only
type below that bar is on surfaces that carry their own dark ground — the
video overlays, the celebration screens, the cinematic intro and the FF Cup
skin.

### Radius
--r-sm 4px, --r-md 7px, --r-lg 10px, --r-pill 999px (pills stay fully round for buttons/tabs/tags). Close to square: a 26px corner reads as consumer app, a 10px corner reads as printed programme.

### Shadow
--shadow: 0 14px 34px -26px rgba(16,38,26,.42) — elevation you notice only when it is gone. Panels are **paper, not plastic**: one flat fill, one hairline, one soft cast. The bevelled-slab modelling (surface ramp, lit bevel, ambient occlusion, contact edge) that the dark palette needed is gone — on white those five layers only made a white card grey.

### Typography
Three tokens, and **every `font-family` in the stylesheet reads one of them** — `--font-body`, `--font-mono`, `--font-display`. Nothing names a typeface directly any more, which is what lets the Admin Studio retype the whole site without a rule being rewritten. `--font-display` is unclaimed by default and resolves to the body face until something points at it.

- UI/body font (`--font-body`): **Inter**, then the system stack — 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Display font (`--font-display`): **Playfair Display**, the editorial serif. No longer inert — the wordmark, every section label and the profile headline read it, and it is the single biggest reason the page reads as a championship rather than an app.
- Monospace/label font (`--font-mono`): **JetBrains Mono** — scores, ratings, timestamps and anything that has to line up in a column. Numbers carry `font-variant-numeric: tabular-nums`.
- Base body size 16px, line-height 1.6
- Section labels: 14px, Playfair Display, 600 weight, .16em letter-spacing, uppercase, --ink, over a hairline rule, with a 2px gold tick at the left. This is the most repeated piece of type on the site and sets its voice; it was 11px mono in grey, which read as a code comment.
- Row/player names: 15–16px, 600–700 weight, body font
- Never smaller than ~11px in this design; keep mobile tap targets ≥44px per the source's button/row padding

### Standings and results

Two components carry most of the site's identity and both are drawn as **one
sheet, not a stack of cards**:

- **The ladder** (`.board-broadcast` / `.brow`) is a single white sheet with one outline and hairline rules between rows. The podium three each carry their metal three times over — a 4px spine down the left edge, a filled medal disc in place of the plain numeral, and a wash of that metal across the row, deepest at first and lightest at third — so the break between "on the podium" and "not" is the loudest edge in the table. Hover is a wash and a 3px accent margin; nothing moves.
- **The archive** (`.msc`) is a scorecard, not a log line: the event and the stage across the head, then one row per player with their set scores in columns and the winner's row picked out in the accent behind a tick, then a footer carrying the comment count, the admin's re-file control and "View match →". `m.sets` is stored p1-first as `"6-4, 3-6, 7-5"`; splitting it into two columns is the whole trick. Games with no recorded set scores fall back to an em dash per side rather than collapsing the row.

### Spacing
No formal scale — panels use 14–20px internal padding, sections stack with margin-top: 40px (26px on mobile), grids use 8–14px gaps. Recreate with whatever spacing scale the target design system already has, snapping to the nearest step.

## Admin Studio — changing the site without changing the code

Everything above describes what the site is *coded* to look like. An admin can change most of it from inside the site: ☰ → **✎ Edit site**, then click something and change it. **Publish** pushes the result to everyone over realtime. Full guide: **[docs/admin-studio.md](docs/admin-studio.md)**; setup is one migration, [docs/site-config.sql](docs/site-config.sql).

**How it feels to use.** Clicking selects the nearest thing a person would *name* — a button, a heading, a section — not the deepest node under the cursor, and a toolbar appears on it with the things you'll want most. Double-click text and type into the page. Grab ⠿ and drag a section elsewhere. ⌘Z undoes anything (a whole colour drag is one step, not forty). The panel names your selection in plain words and offers sliders and swatches; the CSS selector is demoted to an **Advanced** disclosure.

What it reaches:

- **Colours and shape** — every design token listed above, grouped and explained, with eight complete palettes as starting points (including **Neon grape**, the palette this site wore before the championship one, and **Championship whites**). Studio colours outrank the FF Cup skin and the live weather themes, both of which redeclare the palette on `<body>`.
- **Typography** — the three font tokens, plus scale, line height, tracking and weight. Google families are fetched only once one is chosen.
- **Copy** — click any element and retype it. Icons, counters and badges beside the words stay where they are.
- **Layout** — rename, reorder and hide nav tabs; reorder and hide the sections of any view. The section list is discovered live, so a panel added to a view later shows up with no work.
- **Per-element styling** — colour, size, weight, padding, radius, border and a free-text declaration box for one specific element.
- **New content** — "blocks": admin-authored HTML anchored above, below or inside any element. Scripts, iframes and inline handlers are stripped.
- **Features** — particle effects, sound, transitions, the intro, the HUD grid, weather theming, cursor tilt, the podium, stadium mode, the install prompt.
- **Raw CSS** — applied last, so it wins.

Edits are a **draft** until published: they live in your browser, survive a reload, and nobody else sees them. Every publish is versioned, recorded in `site_config_history`, and restorable from the History tab.

The design that makes this survivable in an app that re-prints most of its UI from templates: **the config compiles to a stylesheet**, so hiding, reordering, restyling and theming cannot be clobbered by `innerHTML` and cost nothing per frame. Only copy and blocks are written into the DOM, and one coalesced `MutationObserver` re-lays those. The honest limits — a key addresses a *position* in the markup, so overrides on generated list rows follow the position rather than the content — are set out in the doc.

Not running the migration is a supported way to run the site: the app notes the missing table and renders the built-in defaults, which is exactly how it looked before any of this existed.

## FF Cup event skin (temporary)

For the duration of the FF Cup the app wears a tournament skin — **jet black · anti-gravity**. Everything above still describes the permanent design; the skin is a layer on top of it, not a replacement.

**Runs Aug 17 – Sep 15.** Those two dates live in one place: the `FF CUP WINDOW` script just after `</header>` in `index.html`. The badge in the top bar, the lockup on the load screen and the marquee on the landing page all read from them (the script publishes `window.FFCUP` for the app), so they can't drift. To move the cup, change `START` / `END` there and nothing else.

**How it is switched on:** `data-skin="ffcup"` on the `<html>` element. The skin's CSS is one block at the end of the `<style>` in `index.html`, headed `FF CUP EVENT SKIN`, and every rule in it is scoped to `:root[data-skin="ffcup"]`. The window script also sets `data-cup="pre"` / `"live"` on the same element (the badge's date line pulses only while the cup is actually on).

**It retires itself.** After Sep 15 the window script removes `data-skin` on load and the app is back to normal with no intervention. That leaves only the dead CSS to delete:

1. Delete the `FF CUP EVENT SKIN` block from the `<style>`, and the `WET BLACK` gloss block that follows it (section 10 of the same comment numbering — it is scoped to `:root[data-skin="ffcup"]` throughout, so it is inert off-skin either way).
2. Delete the `FF CUP WINDOW` script after `</header>`, the `<span class="ffcup-chip">` in the top bar, the `<div class="ls-cup">` on the load screen, the `FF CUP — THE MARQUEE` JS block, the ten `<div class="cup-mount">` stubs, the `<button class="ms-cup">` in the mobile sheet, and the two `<span class="cup-flag">`s in the navigation.
3. Restore `theme_color` / `background_color` in `manifest.webmanifest` (they were `#f8f0e0` and `#0a0814`) and the `theme-color` meta in `index.html`.

**What the skin does:**
- **Deeper blacks.** `--bg` is `#000000`; panels are `#070707` falling to pure black. The live weather themes (`body[data-heat]` / `body[data-wx]`) and the weather FX canvas are overridden off so the black stays black.
- **One hue.** Every accent — pink, cyan, chartreuse, and the gold/silver/bronze medals — collapses to neon green `#3dff6e` (`--neon`), with `#ccffdd` as the white-hot tube core and two dimmer greens standing in for silver and bronze. Only `--danger` survives as a second colour, desaturated to `#e8596f`, because a loss has to read as a loss.
- **Jet black surfaces, chrome-rimmed.** Panels, the board, pending rows, menus and sheets are polished piano black lit like metal: the rim is a chrome gradient rather than a hairline, the body is dark in the middle and lifted at *both* ends (the ground bounce coming back up the lower edge is what makes it read as a curved polished face instead of a flat slab), and an elliptical specular sits on top and rolls across on hover. One lit neon filament replaces the old 4px broadcast strip. Two chrome ramps back this: `--chrome` / `--chrome-rim` for surfaces, and `--chrome-text` for the two wordmarks — floored at a mid grey, because the dark half of a metal ramp reads as depth on a surface but as a hole inside a letter on a black page.
- **Anti-gravity.** Nothing rests on anything. Shadows are thrown far below with no contact point, content rises in from below (`ffRise`), and the load screen's ball floats instead of bouncing. The idle drift (`ffFloat` / `ffHover`) is spent on the marquee and the brand mark only — it used to run on every `<section>` at once, which pinned a dozen full-width compositor layers for the life of the session; everything else gets its weightlessness from the entrance and the hover lift, both of which end. The float never goes on `.panel` / `.pod`, because the cursor-tilt script writes inline transforms onto those.
- **Branding.** A chrome-plated badge in the top bar (`FF CUP` struck in metal over the dates in neon), the same lockup on the load screen, and the marquee below. The brand ball becomes a mirrored chrome sphere with the neon coming back around its lower rim — the only colour on it, since there is nothing else in the scene to reflect.
- **The marquee.** For the length of the cup the event is the first thing on the page, above the broadcast hero on the ladder and above the timeline on Home. One component (`renderCupMarquee()`, the `FF CUP — THE MARQUEE` block) fills every `.cup-mount` stub on the page: a jet-black slab with a neon filament welded along its top edge, a court grid receding into the floor behind the type, one specular crossing the face every nine seconds, the wordmark struck in chrome, and a live countdown burning through it as exposed tube — to first serve before the cup, to the last day once it's running. Under it, the six-stage rail (Roster → Group → Cut → Semis → Final → Champion) reads live off the Robin+ snapshot, and the footer carries the next fixture and the way in. Nine views get it — the two landing pages and Events in full, every other top-level tab as a compact lit bar; Messages is left alone. Nothing is stored twice: the marquee reads the real tournament row for its field, stage, next fixture and champion, and only falls back to `window.FFCUP`'s dates while that row doesn't exist yet.
- **The calendar — a day for every game.** Any Robin+ fixture can be given a day inside the cup window: group games, qualification deciders, the semis, the third-place game and the final, whether or not the round it belongs to has been reached yet (the semis are schedulable before anyone has qualified for them). An admin sets a day from a date picker on the fixture itself or from the calendar panel, or lays the whole draw out at once with **Spread across the window**, which distributes the fixtures evenly in playing order across the days between the cup's start and end. **Catch up from today** is the same thing for an event that has already slipped: only the games still to play are moved, evenly over the days left in the window, and anything already on record keeps the day it was actually played on. The panel shows the window as a month grid, Monday first, running from the Monday of the opening week to the Sunday of the closing one — so a cup that crosses into a second month is still one continuous board. Each day carries a dot per fixture (dimmed once played) and one of two glows: **blue** for a day with a 1v1 (the group games and any decider), **white** for a day with a bracket game (semis, third place, final); a day with both gets both. Today underlines its own number, the day you are looking at takes a ring — neither borrows blue or white, since those two are the legend. Tapping a day writes it out underneath, which is where the walk-in button and (for an admin) the date picker live, with today's game called out above it and anything not yet dated listed below. The days live in `state.dates` inside the same `tournaments.bracket` JSON as the draw, keyed by round, so **there is no second migration**; they also survive a re-draw, because a day is a slot in the window ("the third game is on the 21st") rather than a property of a pairing. Off-skin, and before a draw exists, the panel renders nothing.
- **The walk-in.** The title film a fixture gets on the day it is played (`FFIntro`, the `FF CUP — THE WALK-IN` block). The camera leaves the road, climbs over a floodlit rooftop court mid-rally, dives back through the plaza, banks out of the avenue and goes **straight through a lit office window** — corridor, strip lights, poster on the wall, out the far side — rolling through a full 360° on the way, then up over the skyline, back down among the towers, and out to the arena floating above the city. Whiteout, and a **versus card**: both players, their rating, their record in this cup, their last five, the head-to-head and the Elo split — the last of which the flight has spent ten seconds working out in front of you.

  Scattered through the city is the app itself: the brand ball hanging where the moon should be (seam and all), the ladder's **podium** with its three medals in a plaza, the top bar's **ticker** — `LIVE · K 20-64 · START 500`, read straight off `taglineText()` so the city cannot drift from the bar — running along a building, the **rating galaxy** as a constellation on the dome, the load screen's **court** painted on the avenue with the ball floating over the net, a **trophy** on a roof, the **FGTA wordmark** in neon with one tube not quite right, `FX.celebrate`'s confetti drifting between the towers, a rain cell over one district, and jumbotrons cycling the fixture, the cup and the app's own Banter/Storm/Poll/Callout row.

  **The sum, out loud.** The card lands on a split — `68% · 32%` — and a number with nothing behind it is a horoscope, so the film does the working on the way there. A strip in the top corner steps through the ladder's own Elo expectation, one line at a time across the flight: the two live ratings, the gap between them, the gap over the divisor, ten to that power, and finally `E = 1 / (1 + 10^(−Δ/400))` resolving a beat before the cut — so the odds bar on the card is the **answer to a question the viewer watched being asked**. The city carries the same sum twice: a lit board off the avenue with the two ratings on it early in the flight, and one slung across the road under the arena with the formula on it late. Every figure comes from `mathOf()`, derived once from the film's own `divisor` and `K`, so the strip, the boards and the line under the odds bar cannot drift apart — and the bar itself is now read off that working rather than computed beside it. Films restored from the offline cache predate those two fields and fall back to classic Elo.

  **It says whose film it is.** An `FGTA` mark — brand ball, wordmark, `championship ladder` — sits in the corner for the whole run and stays up through the card, over a corner scrim so it survives both a white tower and a neon sign passing behind it. The card signs itself with the same lockup above the fixture line, and labels its odds bar `FGTA Elo · expected score` with the formula under it. In the world, the boards are headed `FGTA · ELO`, and the arena the flight ends at now carries the house sign across the front of its bowl, big enough to read from the last hundred metres of the approach.

  It is one `<canvas>` and one overlay, drawn from nothing: no library, no assets, hand-rolled perspective projection with a painter's sort. The city is generated from the fixture's round key, so every game gets its own skyline and the same game always gets the same one — and the flight path is **carved out of it** afterwards, so the one building the camera goes inside is the one built for it.

  **Every move has a reason.** One tennis ball is sampled from the same spline half a second further along, so the camera is permanently chasing it and the two can never disagree: the climb over the rooftop court is the camera following the ball up off a rally, the dive is following it back down to the plaza, the bank out of the avenue is following it around a crane gantry slung across the street, and the window is simply where the ball goes and the camera goes after it. Birds break off the roofs as it passes overhead, paper and leaves get kicked up off the road where the flight skims it, and the gantry's one open end carries the lamp you steer by. Nothing in the path is a flourish the picture doesn't account for.

  It plays from the ▶ button on any fixture with two named players, from the marquee's **Watch the walk-in** on the day, when the cup is opened on a day that has a game, and **when the app itself is opened** on such a day. All routes go through the same once-per-game-per-device guard, so it is an occasion rather than a toll gate. Tap, Esc or **Skip** ends it; under `prefers-reduced-motion` the flight is skipped entirely and the card comes up on its own.

  **On a match day it is instant, and it holds the screen.** Waiting for the database before deciding whether to play would put the film some hundreds of milliseconds *after* the load screen, which reads as a stutter rather than an opening. So the decision is made with no network at all, from two synchronous sources tried in order: `fgta_walkin_next` (a finished film, written at the end of every `load()` for the next dated fixture the event is waiting on) and, failing that, the app's existing `fgta_offline_cache`, from which the film is re-derived. Either way `FFIntro.prepare()` generates the city and paints frame zero *while the load screen is still up*, and the flight starts on the exact frame the wipe begins — `ffWhenRevealed`, published by the load screen itself, with `.loadscreen` at `z-index:10000` so its wipe **reveals** a flight already running rather than cutting to one. Measured: the overlay is built and painted ~2.3s before the wipe, so there is nothing left to compute at the cut.

  It plays **whenever the cinematic load screen plays** — once per browser session. Open the app on a match day and you get the walk-in; move around inside it, or reload inside the same session, and you do not. It is the opening titles, so it is tied to the thing that opens. For its first `T_LOCK` seconds there is no Skip button and nothing to tap through to: the button is `display:none`, out of the layout and out of the accessibility tree, so the street run and the first climb are not skippable. After that a tap, Esc or the button ends it.

  The cost of deciding from cache is that the card's numbers are as of the last session the app was open — at worst one session stale, which is the right trade. A schedule made since the last session is in neither cache; `ffBootWalkIn` covers that one case off the back of `load()`.

  **What keeps it smooth.** The camera is a Catmull-Rom spline through fifteen keyframes rather than a set of hand-written phases — the first version switched between phases and the camera's *speed* jumped where two met, a visible hitch in the middle of the best shot; a spline is continuous in velocity everywhere, so there is no seam left to hit. Yaw is not authored at all: it is taken from the path's own derivative, which is what makes the camera look into its turns. Beyond that: the versus card is built and held paused rather than injected at the cut (parsing it mid-flight cost the frame it landed on), every bloom radius is capped at 42% of the frame (a street lamp passing a metre from the lens was asking for a 700px radial gradient — one call painting more than the whole canvas, and the reason the opening second stuttered), the backing store is capped well below the display's pixel ratio because nothing at ninety units a second is worth four times the fill, buildings are rejected on a screen-space bounding box before anything is filled, and their window grids and dark panes drop out by distance. Measured under software rasterisation the worst frame is now about 1.5× the median, against 5× before.

- **Promoted everywhere else.** A lit pip on the Events tab and the mobile More button, the cup at the top of the mobile sheet on its own, the top-bar badge wired up as the fastest route into the event, and the idle live ticker turned over to the cup. All of it is `display:none` off-skin, so it comes and goes with `data-skin`.
- **The void.** The retired `#hudGrid` layer is reused as a black hole behind the app: light bending toward a horizon, a masked accretion ring turning once every 96s, and infalling dust. No new markup, and it disappears with the skin. The ring's softness is baked into its gradient stops rather than applied with `filter: blur()` — see the performance note below.
- **Wet black — the gloss pass.** A second block (`10. WET BLACK`) sits under the skin and works the surface rather than the palette. The panel body goes darker through the middle and brighter at both lips (that contrast *is* the gloss: a matte surface fades evenly, a polished one holds a hard bright line where it turns away from you), the top highlight is tightened from a 17% falloff to an 11% one, the leaderboard rows join the panels as polished slabs instead of flat `--panel` holes, and the top/bottom bars drop their frosted-glass `backdrop-filter` for solid jet black — the blur was invisible under a 92% opaque black anyway and cost a full-viewport re-blur on every scrolled frame.
- **Tennis, on touch.** Every accent dot is the same object — a tennis ball lit from the upper left, drawn in gradients. Hover a section and its ball takes one squash-and-stretch bounce; hover a leaderboard row and a ball plays a three-bounce rally along its baseline while a sideline lights down its left edge; hover a button and a racket string-bed sweeps across the face; the marquee's CTA ends in a ball that gets tossed forward; the brand ball takes one topspin revolution; stat tiles paint in a court baseline from the centre out; the tab-change wipe gets its neon racket strings back. Every one of these is finite and pointer-triggered — see below.
- Everything animated is off under `prefers-reduced-motion`, and all of the hover work is stripped under `@media (hover: none)` where it can never fire.

**Performance — what makes this skin cheap.** It is a lot of light for a page that has to stay at 60fps on a phone, and the rules that keep it there are worth knowing before adding to it:

- **Only `transform` and `opacity` are animated.** Never `background-position`, `left`, `width`, `box-shadow` or `filter` — those are paint or layout properties, and animating one forces the main thread to re-rasterise the element every single frame. Three loops in this file were doing exactly that (the marquee's specular sweep, its court floor, and the podium plinth sheen); all three now travel on transforms and land in the same place.
- **Nothing loops forever unless it is small.** A running animation pins its element to its own compositor layer for as long as it runs. Idle motion is limited to the marquee, the brand ball and the void; everything else is triggered by a pointer, runs once and releases.
- **No standing `will-change`.** It was on `.panel` and `.pod`, which promoted a dozen-plus full-width layers for the whole session in exchange for a hint that only matters during a 350ms hover. It is raised on `:hover` now, and the tilt script raises and drops its own.
- **The accretion ring carries no `filter: blur()`.** It used to be a ~3100px-square layer under a 60px gaussian — two GPU surfaces, tens of MB, re-blurred on every repaint, and by far the most expensive thing on the page. Measured in headless Chromium, removing it alone took the idle frame from **117ms to 16.7ms**. The softness now comes from long feathered gradient stops and a wide feathered mask, which cost nothing. (The mobile override was also growing the ring to 220vmax against a 150vmax desktop base while claiming to shrink it; it is genuinely smaller now.)
- **Hidden things do not draw.** The weather FX canvas is `display:none` under this skin — it was still clearing and repainting a full-viewport canvas every frame into a layer nobody could see, and allocating a viewport-sized backing store to do it.

## Assets
No custom illustrations or photography — avatars are generated from initials (a small avatar(name, size) helper drawing colored circles + initials). Fonts are loaded from Google Fonts (Outfit, JetBrains Mono). Weather icons/emoji are used inline (no icon font/library). No other external image assets.

## Files
- index.html — the full app (single file, ~15.7k lines: styles, markup for every view, and all JS logic including Supabase calls, Elo/Glicko/Markov models, calendar, the YouTube livestream panel, and realtime presence).
- overlay.html — the OBS Browser Source that burns the live scoreboard into the broadcast. Standalone by design: it loads nothing from index.html, so an unrelated change to the app can never break the graphic that is going out live.
- netlify/functions/youtube.mts — the YouTube Data API proxy behind `/api/youtube`.
- netlify/functions/ai.mts — the Anthropic API proxy behind `/api/ai`, used by the match-card AI commentary/roast buttons.
- docs/admin-studio.md — the in-app site editor: what each tab reaches, how the config compiles to a stylesheet rather than into the DOM, and where the limits are.
- docs/site-config.sql — the `site_config` + `site_config_history` tables the studio publishes to, their admin-only RLS, the realtime publication, and the one-transaction `publish_site_config()`.
- docs/youtube-live.md — how to set streaming up, once for the league and once per match, plus how the video is kept.
- docs/streams.sql — optional `stream_log` table: the league's own record of every broadcast, so old matches stay listed after YouTube's listing moves on.
- docs/robin-plus.sql — the one column the Robin+ tournament format needs (`tournaments.bracket`), plus what happens if you skip it.
- docs/tournament-stats.sql — the optional `tournaments.counts_stats` column: how to keep one event out of the stats as well as out of the ladder, and why you almost never want to.
- docs/rally-reel.md — cutting a match down to just the rallies: how the taps become an edit, how the sync works, and what the three exports are for.
- docs/auto-cut.md — the same cut for footage nobody reffed: how the ball-strike detection works, what it measured, and the one thing it can't do.
- docs/kit.sql — the Kit's two optional tables (`rackets`, `string_jobs`), why the hours are deliberately NOT stored in either of them, and why cutting a bed out writes a date rather than deleting the row.
- docs/rally-reel.sql — the one column the rally reel needs (`matches.rallies`), the shape of what goes in it, and what happens if you skip it.
- FGTA Ladder (standalone).html — an older snapshot of the app pre-bundled as a self-contained offline-loadable file; predates the move to YouTube streaming and is kept only for offline reference, not as a build artifact.
- manifest.webmanifest, sw.js, icons/ — the installable-app layer, see below.

## Tests
No dependencies, no build, no runner: each file is `node test/<name>.test.js` and prints its own pass/fail. `test/extract.js` pulls **sentinel-delimited regions straight out of index.html** — `/* ==== NAME-START ==== */ … /* ==== NAME-END ==== */` — so the tests run the shipped code rather than a copy of it that can drift, and throw rather than silently testing nothing if a sentinel moves.

- `elo.test.js` — **the rating engine**, which had no coverage at all until now, and is the one piece of this app whose output people argue about. A bug in the feed loses a post and somebody notices within the hour; a bug in here quietly rewrites who is winning and produces a table exactly as plausible as the right one. Covers the margin multiplier, the per-player K, the replay, and — most importantly — **the date gates**. Margin of victory and the dynamic K were both shipped with an explicit promise not to re-score anything already played, and that promise is enforced entirely by two string comparisons; the last section replays a pre-gate season and checks it against a flat-K replay written out by hand, to the point.
- `kit.test.js` — the string model. The curve has no ground truth available, so what is asserted is its *shape*: monotone in both clocks, bounded at both ends, and each material's two clocks arranged so the one that is supposed to run out first does. The hour readers are a different matter and are tested against real rows, including every way they can be wrong — a ref who never pressed stop, a match tiebreak that reads as a fifteen-game set, a practice row from a deployment that skipped the `players` migration.
- `models.test.js` — the three rating models that are **not** Elo: Bradley–Terry, the bootstrap and PageRank. Elo is the ladder, so a bug in it is argued about within a week; these are the ones nobody checks against anything, and all three produce a tidy plausible ranked table from *any* input. So what is asserted is the properties each method guarantees and the specific way each is known to blow up: BT's unbeaten player running to infinity without the phantom-half-win anchor; PageRank's edges running loser→winner (reverse them and it ranks the worst player first, very convincingly) and its mass not leaking through a player who has never lost; the bootstrap's bands being the right way round and actually separating.
  - **It found a piece of wrong copy.** The bootstrap panel said "play more games to shrink them", and that is false. Bootstrapping a *mean* narrows because a mean has a fixed point; Elo has none — it is a sequential random walk, so a longer season spreads the ratings apart at least as fast as it pins each one down. Measured on a clean pecking order from 6 to 60 games, the mean band width goes 66 → 83 → 87 → 90 → 77 points, flat; what falls monotonically is the width *relative to the spread it describes*, 0.73 → 0.15. The bands separate, they do not narrow. The legend says so now, and the test asserts it in both directions so nobody later "fixes" the resampler chasing a narrowing that was never coming.
- `outbox.test.js` — the offline queue, and mostly its classifier: the real failure messages from Postgres, PostgREST and four browsers, sorted into "the server said no" and "it never got there".
- `palette.test.js` — the fuzzy matcher and ranker, held to the ordering promises in the section above.
- `robin-plus.test.js`, `park-busy.test.js`, `score*.test.js`, `serve*.test.js`, `floor.test.js`, `studio*.test.js` — the draw solver, the busyness model, the score reconstruction, and the Admin Studio.
- The video tests (`ball`, `bigfile`, `dynamics`, `onsets`, `preview`, `render`, `scoreboard`, `serve-vision`) need fixtures first — run the `test/make-*.js` scripts — and some need a Playwright chromium. They say so and exit 2 rather than failing.

## Installable app (PWA)
The site is installable on Android and iPhone as-is — no native app store build. `manifest.webmanifest` (linked from index.html's `<head>`) gives it a name, icon set, and standalone display mode; `sw.js` is a minimal service worker that makes install prompts eligible and caches an offline shell. Android/Chrome shows an install prompt (wired to the "Install app" button via `beforeinstallprompt`); iOS/Safari has no such prompt, so `installApp()` shows the manual "Share → Add to Home Screen" steps instead — this is a Safari limitation, not something fixable from the app.

Updates stay instant on purpose: `sw.js` is network-first for navigations, so every time the installed app is opened it fetches whatever is currently deployed and only falls back to the cached shell if there's no network. There's no build/publish step for updates — push to the branch Netlify deploys and the next app open picks it up, exactly like the website. `netlify.toml` sets `Cache-Control: no-cache` on `/sw.js` and `/manifest.webmanifest` so browsers don't sit on a stale copy of either. Bump the `VERSION` string at the top of `sw.js` when changing what's precached in `SHELL_URLS`, so old caches get dropped on activate.
