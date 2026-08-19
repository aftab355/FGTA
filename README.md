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
- **Content**: Standings are computed live from the matches table (Elo, K=32, start rating 100).

### 2. Home / Feed
Social feed: post composer, "moments" horizontal scroller, presence bar ("N on court" + stacked avatars when others are active), live activity ticker, "on this day" callback box, comments.

**YouTube links play in place.** Paste a link into a post, a match comment, a reply or a DM and it renders as a player instead of a URL — no extra field, no upload, and old posts pick it up too, since the link is read out of the body text (`socialBody()`). Unlisted videos work exactly like public ones; only Private doesn't. What lands in the card is a thumbnail and a play button until somebody clicks, so a feed of forty posts is forty images rather than forty YouTube players. Up to three videos per post; a fourth link stays as plain text rather than vanishing. While a video is playing, updates arriving from other people wait behind a "new activity — tap to refresh" pill instead of rebuilding the list out from under it.

### 3. Matches (Point Tracker / Archive / Rivalries) — subtabs
- **Point Tracker**: Enter player 1 / player 2 names → "Start tracking" begins a live point-by-point 1v1. Best-of-3, games to 6 win-by-2, tiebreak to 7 at 6-6. Plain incrementing point counts (0,1,2,3…), not tennis scoring. Every tap is undo/redo-able; nothing writes to the ladder until final Submit. Every tap is also **timestamped**, which is the whole basis of the rally reel described under Archive below — the ref pressing a button when a point ends is a more reliable record of where the rally finished than tracking the ball would be, and it was already happening.
  - Live celebrations: 8-8 in a game triggers a full-screen rainbow/confetti overlay; a game win shows a gold banner with the game number; a set win shows a flame overlay.
  - **Submit toward**: a tracked game files to the ladder by default, but a "Submit toward" picker on both the setup screen and the wrap-up lets the ref file it under any unfinished event instead — the FF Cup leads the list while it's on. Picking an event sets `matches.tournament_id`, the same field the admin tournament screens write, so the event page and the draw pick the game up with nothing new downstream. Whether the game *also* moves Elo is the event's own `counts_elo` flag rather than a second switch, so the two can never disagree: an exhibition cup files the result and leaves ratings alone. When the two players are an unplayed fixture in that event's draw, the round is attached too and the result slots straight into the bracket on approval. The choice is remembered between matches (a ref working a cup reffs the whole cup) and frozen onto the match at start, so resuming a draft can't re-file it under a target picked for a later game.
  - "Ref mode" pill badge next to the section title.
  - Built-in livestream panel: the match is broadcast from **OBS to YouTube
    Live**, and the app embeds the resulting stream (YouTube IFrame API) with
    the FGTA layer wrapped around it — live chat, ref-mode scoring from any
    device, a live-match directory, and fullscreen with chat/ref drawers over
    the picture. Any number of viewers, no relay, and the VOD stays on
    YouTube for free once the match ends.
    - "Set up a broadcast" is a four-step checklist, not a button: it mints a
      session code, links the YouTube video, and hands over the OBS settings.
      Nothing about the stream itself is controlled from the browser — camera,
      mic, framing, zoom and filters are all OBS's job now.
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
      `docs/youtube-live.md` for the full setup and the quota arithmetic.
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

### 7. Events
Tournament creation (admin) and bracket/format display; round-robin, knockout, hybrid and **Robin+** supported. Upcoming tournaments show a countdown; admins can go live, edit schedule, or delete a tournament.

#### Robin+ — the group-into-bracket format
The default format, and the only one with a full interactive flow rather than a bare "add a game" form. Everyone plays **exactly two** group games, the top 4 qualify, and those 4 go straight into semis → final. It is an **exhibition by default — Robin+ games never touch Elo**.

- **The ring.** Two games each means the group is a 2-regular graph, i.e. a ring: sit the field in a circle and each player plays their two neighbours. N players, N games, no byes, nobody sits out. It's drawn as an SVG circle in the event panel — edges light up as games are played, and the next game pulses.
- **The draw is searched, not shuffled.** `rpSolve()` scores candidate rings on three competing objectives and refines them with 2-opt (a tournament draw is a travelling-salesman problem where "distance" is how bad a matchup would be): **closeness** (Elo-expectation, superlinear so one blowout costs more than two mild mismatches), **fair draw** (the spread of average-opponent-rating across the field — with only two games, drawing the two strongest players eliminates you by luck rather than form, so this is penalised directly), and **freshness** (recency-weighted rematch penalty, ~45-day half-life). Seeded from a rating "snake" plus 28 random restarts. A "Why this draw?" panel shows the numbers.
- **Order of play** is sequenced separately so nobody plays back-to-back where the ring allows it, with the closest matchup held back for last.
- **The cut.** Ranked on wins → head-to-head → game difference → games won → strength of opposition → ladder rating. Anything results can settle *is* settled on results; **anything still level across the 4th/5th line plays a 1v1 decider for the spot** rather than being broken on a tiebreak column. `rpPlayoffPlan()` picks the decider shape from the arithmetic: 2 level for 1 spot → one game; 5 level for 4 → the bottom two play; 3 level for 1 → a mini knockout with a bye to the better seed; and (vanishingly rare) 5+ level for 2 → the same ring format run among the tied.
- **Bracket** seeds #1 v #4 and #2 v #3, with an optional 3rd-place game, then crowns the champion.
- Admins record results by tapping a fixture; every stage is derived from the `matches` rows, so undoing or editing a result months later re-resolves the whole event.

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

## Mobile Navigation
- **Desktop (>=860px)**: horizontal top tab bar with an animated underline indicator.
- **Mobile (<860px)**: top tab bar hides; a fixed bottom nav bar (.botbar) shows the 5 most-used views (Ladder, Home, Matches, Predict, Stats) plus a "More" button.
- **"More" sheet**: a bottom sheet (slide-up panel + backdrop) listing the remaining views as a 2-column icon grid: Doubles, Training, Court, Events, Messages, Search, Surface (cycles court-surface theme), Stadium (ambient stadium-mode toggle), Help. *(Doubles and Training were previously missing from this sheet — a mobile nav bug fixed in this design pass — make sure the target implementation includes every view here.)*
- A secondary fixed bar sits above the bottom nav: a scrolling "live ticker" of recent results/comments (marquee-style horizontal scroll, pauses on hover/tap).

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
- matches, comments, tournaments, posts, scheduledMatches, practiceLog, availabilityData, playerRoster — all mirrors of Supabase tables, refetched on load and on postgres_changes realtime subscriptions.
- presentUsers, ghostCursors, presenceChan — ephemeral realtime presence/broadcast state (Supabase Realtime channels), not persisted.
- Point tracker keeps its own local PT state object (per-game point arrays, undo/redo stacks, timer) until Submit inserts a row into matches.
- Calendar keeps calCursor (visible month) and selectedCalDay (highlighted day key) as local UI state.
In the target codebase, model these as: a data layer (whatever the app already uses — React Query, Redux, plain hooks, etc.) for the Supabase-backed collections, plus local component state for in-progress/unsaved flows (point tracker, casual-session form, calendar selection).

## Design Tokens

### Colors (CSS custom properties in the source)
- Background: --bg #151125 (near-black grape)
- Panel surfaces: --panel #211c38, --panel-2 #2c2650
- Hairlines: --line rgba(255,255,255,.16), --line-soft rgba(255,255,255,.08)
- Text: --ink #f2eefc (primary), --muted #a29cc4 (secondary), --dim #6e6795 (tertiary/labels)
- Primary accent (hot pink, 90s neon): --accent #ff2d78, --accent-dim #3a1230, --accent-glow rgba(255,45,120,.4)
- Secondary accent (cyan/court): --court #1ec9dd, --court-dim #0d2f36
- Tertiary accent (chartreuse/ball): --ball #d4ff2b, --ball-glow rgba(212,255,43,.4)
- Medal colors: --gold #ffcc00, --silver #c7c7d9, --bronze #e0793a
- Semantic: --danger #ff3b3b, --pending #ffb100, --win #34c759

### Radius
--r-sm 12px, --r-md 18px, --r-lg 26px, --r-pill 999px (fully-rounded pills for buttons/tabs/tags)

### Shadow
--shadow: 0 24px 60px -28px rgba(0,0,0,.6) — soft, diffuse, no hard offset

### Typography
- UI/body font: system font stack with **Outfit** as the fallback custom font — -apple-system, BlinkMacSystemFont, "Segoe UI", 'Outfit', sans-serif
- Monospace/label font: **JetBrains Mono** — used for all uppercase labels, stats, scores, timestamps, badges, and anything data-like (contrast against the humanist body font)
- Base body size 16px, line-height 1.6
- Section labels: 11px, JetBrains Mono, 600 weight, 1.5px letter-spacing, uppercase, --muted
- Row/player names: 15–16px, 600–700 weight, body font
- Never smaller than ~11px in this design; keep mobile tap targets ≥44px per the source's button/row padding

### Spacing
No formal scale — panels use 14–20px internal padding, sections stack with margin-top: 34px (26px on mobile), grids use 8–14px gaps. Recreate with whatever spacing scale the target design system already has, snapping to the nearest step.

## FF Cup event skin (temporary)

For the duration of the FF Cup the app wears a tournament skin — **jet black · anti-gravity**. Everything above still describes the permanent design; the skin is a layer on top of it, not a replacement.

**Runs Aug 17 – Sep 8.** Those two dates live in one place: the `FF CUP WINDOW` script just after `</header>` in `index.html`. The badge in the top bar, the lockup on the load screen and the marquee on the landing page all read from them (the script publishes `window.FFCUP` for the app), so they can't drift. To move the cup, change `START` / `END` there and nothing else.

**How it is switched on:** `data-skin="ffcup"` on the `<html>` element. The skin's CSS is one block at the end of the `<style>` in `index.html`, headed `FF CUP EVENT SKIN`, and every rule in it is scoped to `:root[data-skin="ffcup"]`. The window script also sets `data-cup="pre"` / `"live"` on the same element (the badge's date line pulses only while the cup is actually on).

**It retires itself.** After Sep 8 the window script removes `data-skin` on load and the app is back to normal with no intervention. That leaves only the dead CSS to delete:

1. Delete the `FF CUP EVENT SKIN` block from the `<style>`, and the `WET BLACK` gloss block that follows it (section 10 of the same comment numbering — it is scoped to `:root[data-skin="ffcup"]` throughout, so it is inert off-skin either way).
2. Delete the `FF CUP WINDOW` script after `</header>`, the `<span class="ffcup-chip">` in the top bar, the `<div class="ls-cup">` on the load screen, the `FF CUP — THE MARQUEE` and `FF CUP — THE RESULTS BOARD` JS blocks, the ten `<div class="cup-mount">` stubs and the two `<div class="cup-board-mount">` stubs, the `<button class="ms-cup">` in the mobile sheet, and the two `<span class="cup-flag">`s in the navigation.
3. Restore `theme_color` / `background_color` in `manifest.webmanifest` (they were `#f8f0e0` and `#0a0814`) and the `theme-color` meta in `index.html`.

**What the skin does:**
- **Deeper blacks.** `--bg` is `#000000`; panels are `#070707` falling to pure black. The live weather themes (`body[data-heat]` / `body[data-wx]`) and the weather FX canvas are overridden off so the black stays black.
- **One hue.** Every accent — pink, cyan, chartreuse, and the gold/silver/bronze medals — collapses to neon green `#3dff6e` (`--neon`), with `#ccffdd` as the white-hot tube core and two dimmer greens standing in for silver and bronze. Only `--danger` survives as a second colour, desaturated to `#e8596f`, because a loss has to read as a loss.
- **Jet black surfaces, chrome-rimmed.** Panels, the board, pending rows, menus and sheets are polished piano black lit like metal: the rim is a chrome gradient rather than a hairline, the body is dark in the middle and lifted at *both* ends (the ground bounce coming back up the lower edge is what makes it read as a curved polished face instead of a flat slab), and an elliptical specular sits on top and rolls across on hover. One lit neon filament replaces the old 4px broadcast strip. Two chrome ramps back this: `--chrome` / `--chrome-rim` for surfaces, and `--chrome-text` for the two wordmarks — floored at a mid grey, because the dark half of a metal ramp reads as depth on a surface but as a hole inside a letter on a black page.
- **Anti-gravity.** Nothing rests on anything. Shadows are thrown far below with no contact point, content rises in from below (`ffRise`), and the load screen's ball floats instead of bouncing. The idle drift (`ffFloat` / `ffHover`) is spent on the marquee and the brand mark only — it used to run on every `<section>` at once, which pinned a dozen full-width compositor layers for the life of the session; everything else gets its weightlessness from the entrance and the hover lift, both of which end. The float never goes on `.panel` / `.pod`, because the cursor-tilt script writes inline transforms onto those.
- **Branding.** A chrome-plated badge in the top bar (`FF CUP` struck in metal over the dates in neon), the same lockup on the load screen, and the marquee below. The brand ball becomes a mirrored chrome sphere with the neon coming back around its lower rim — the only colour on it, since there is nothing else in the scene to reflect.
- **The marquee.** For the length of the cup the event is the first thing on the page, above the broadcast hero on the ladder and above the timeline on Home. One component (`renderCupMarquee()`, the `FF CUP — THE MARQUEE` block) fills every `.cup-mount` stub on the page: a jet-black slab with a neon filament welded along its top edge, a court grid receding into the floor behind the type, one specular crossing the face every nine seconds, the wordmark struck in chrome, and a live countdown burning through it as exposed tube — to first serve before the cup, to the last day once it's running. Under it, the six-stage rail (Roster → Group → Cut → Semis → Final → Champion) reads live off the Robin+ snapshot, and the footer carries the next fixture and the way in. Nine views get it — the two landing pages and Events in full, every other top-level tab as a compact lit bar; Messages is left alone. Nothing is stored twice: the marquee reads the real tournament row for its field, stage, next fixture and champion, and only falls back to `window.FFCUP`'s dates while that row doesn't exist yet.
- **The calendar — a day for every game.** Any Robin+ fixture can be given a day inside the cup window: group games, qualification deciders, the semis, the third-place game and the final, whether or not the round it belongs to has been reached yet (the semis are schedulable before anyone has qualified for them). An admin sets a day from a date picker on the fixture itself or from the calendar panel, or lays the whole draw out at once with **Spread across the window**, which distributes the fixtures evenly in playing order across the days between the cup's start and end. The panel shows the window as a month grid, Monday first, running from the Monday of the opening week to the Sunday of the closing one — so a cup that crosses into a second month is still one continuous board. Each day carries a dot per fixture (dimmed once played) and one of two glows: **blue** for a day with a 1v1 (the group games and any decider), **white** for a day with a bracket game (semis, third place, final); a day with both gets both. Today underlines its own number, the day you are looking at takes a ring — neither borrows blue or white, since those two are the legend. Tapping a day writes it out underneath, which is where the walk-in button and (for an admin) the date picker live, with today's game called out above it and anything not yet dated listed below. The days live in `state.dates` inside the same `tournaments.bracket` JSON as the draw, keyed by round, so **there is no second migration**; they also survive a re-draw, because a day is a slot in the window ("the third game is on the 21st") rather than a property of a pairing. Off-skin, and before a draw exists, the panel renders nothing.
- **The results board.** Directly under the marquee on the two landing pages, for the length of the cup: the live group table, the bracket as it fills in, and the last six games played, so a cup result is on the first screen you open rather than two taps in behind *Enter the event*. Read-only — no report panel, no admin control — with a `Full event ›` button through to Events, which is still where a result is recorded. It is `renderCupBoard()` in the `FF CUP — THE RESULTS BOARD` block, filling the `.cup-board-mount` stubs on the ladder and Home; it runs on the same pass and the same skin gate as the marquee, so the two can never be on screen apart. Nothing is stored twice here either: the table, the cut line, the seeds and the bracket are all read from the same `rpSnapshot()` the event page renders from, and a tournament that isn't Robin+ falls back to the plain per-event record. Deliberately unlit next to the marquee above it — two lit slabs stacked would fight, and the one you're meant to *read* would lose.

- **The walk-in.** The title film a fixture gets on the day it is played (`FFIntro`, the `FF CUP — THE WALK-IN` block). The camera leaves the road, climbs over a floodlit rooftop court mid-rally, dives back through the plaza, banks out of the avenue and goes **straight through a lit office window** — corridor, strip lights, poster on the wall, out the far side — rolling through a full 360° on the way, then up over the skyline, back down among the towers, and out to the arena floating above the city. Whiteout, and a **versus card**: both players, their rating, their record in this cup, their last five, the head-to-head and the Elo split — the last of which the flight has spent ten seconds working out in front of you.

  Scattered through the city is the app itself: the brand ball hanging where the moon should be (seam and all), the ladder's **podium** with its three medals in a plaza, the top bar's **ticker** — `LIVE · K=32 · START 100` — running along a building, the **rating galaxy** as a constellation on the dome, the load screen's **court** painted on the avenue with the ball floating over the net, a **trophy** on a roof, the **FGTA wordmark** in neon with one tube not quite right, `FX.celebrate`'s confetti drifting between the towers, a rain cell over one district, and jumbotrons cycling the fixture, the cup and the app's own Banter/Storm/Poll/Callout row.

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
- docs/youtube-live.md — how to set streaming up, once for the league and once per match.
- docs/robin-plus.sql — the one column the Robin+ tournament format needs (`tournaments.bracket`), plus what happens if you skip it.
- docs/rally-reel.md — cutting a match down to just the rallies: how the taps become an edit, how the sync works, and what the three exports are for.
- docs/auto-cut.md — the same cut for footage nobody reffed: how the ball-strike detection works, what it measured, and the one thing it can't do.
- docs/rally-reel.sql — the one column the rally reel needs (`matches.rallies`), the shape of what goes in it, and what happens if you skip it.
- FGTA Ladder (standalone).html — an older snapshot of the app pre-bundled as a self-contained offline-loadable file; predates the move to YouTube streaming and is kept only for offline reference, not as a build artifact.
- manifest.webmanifest, sw.js, icons/ — the installable-app layer, see below.

## Installable app (PWA)
The site is installable on Android and iPhone as-is — no native app store build. `manifest.webmanifest` (linked from index.html's `<head>`) gives it a name, icon set, and standalone display mode; `sw.js` is a minimal service worker that makes install prompts eligible and caches an offline shell. Android/Chrome shows an install prompt (wired to the "Install app" button via `beforeinstallprompt`); iOS/Safari has no such prompt, so `installApp()` shows the manual "Share → Add to Home Screen" steps instead — this is a Safari limitation, not something fixable from the app.

Updates stay instant on purpose: `sw.js` is network-first for navigations, so every time the installed app is opened it fetches whatever is currently deployed and only falls back to the cached shell if there's no network. There's no build/publish step for updates — push to the branch Netlify deploys and the next app open picks it up, exactly like the website. `netlify.toml` sets `Cache-Control: no-cache` on `/sw.js` and `/manifest.webmanifest` so browsers don't sit on a stale copy of either. Bump the `VERSION` string at the top of `sw.js` when changing what's precached in `SHELL_URLS`, so old caches get dropped on activate.
