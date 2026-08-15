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
- **Content**: Standings are computed live from the matches table (Elo, K=32, start rating 100).

### 2. Home / Feed
Social feed: post composer, "moments" horizontal scroller, presence bar ("N on court" + stacked avatars when others are active), live activity ticker, "on this day" callback box, comments.

### 3. Matches (Point Tracker / Archive / Rivalries) — subtabs
- **Point Tracker**: Enter player 1 / player 2 names → "Start tracking" begins a live point-by-point 1v1. Best-of-3, games to 6 win-by-2, tiebreak to 7 at 6-6. Plain incrementing point counts (0,1,2,3…), not tennis scoring. Every tap is undo/redo-able; nothing writes to the ladder until final Submit.
  - Live celebrations: 8-8 in a game triggers a full-screen rainbow/confetti overlay; a game win shows a gold banner with the game number; a set win shows a flame overlay.
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
- **Rivalries**: pick two players to see head-to-head history, rating swing, and trend; a "fiercest rivalries" leaderboard by games played.

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

## Assets
No custom illustrations or photography — avatars are generated from initials (a small avatar(name, size) helper drawing colored circles + initials). Fonts are loaded from Google Fonts (Outfit, JetBrains Mono). Weather icons/emoji are used inline (no icon font/library). No other external image assets.

## Files
- index.html — the full app (single file, ~15.7k lines: styles, markup for every view, and all JS logic including Supabase calls, Elo/Glicko/Markov models, calendar, the YouTube livestream panel, and realtime presence).
- overlay.html — the OBS Browser Source that burns the live scoreboard into the broadcast. Standalone by design: it loads nothing from index.html, so an unrelated change to the app can never break the graphic that is going out live.
- netlify/functions/youtube.mts — the YouTube Data API proxy behind `/api/youtube`.
- netlify/functions/ai.mts — the Anthropic API proxy behind `/api/ai`, used by the match-card AI commentary/roast buttons.
- docs/youtube-live.md — how to set streaming up, once for the league and once per match.
- docs/robin-plus.sql — the one column the Robin+ tournament format needs (`tournaments.bracket`), plus what happens if you skip it.
- FGTA Ladder (standalone).html — an older snapshot of the app pre-bundled as a self-contained offline-loadable file; predates the move to YouTube streaming and is kept only for offline reference, not as a build artifact.
- manifest.webmanifest, sw.js, icons/ — the installable-app layer, see below.

## Installable app (PWA)
The site is installable on Android and iPhone as-is — no native app store build. `manifest.webmanifest` (linked from index.html's `<head>`) gives it a name, icon set, and standalone display mode; `sw.js` is a minimal service worker that makes install prompts eligible and caches an offline shell. Android/Chrome shows an install prompt (wired to the "Install app" button via `beforeinstallprompt`); iOS/Safari has no such prompt, so `installApp()` shows the manual "Share → Add to Home Screen" steps instead — this is a Safari limitation, not something fixable from the app.

Updates stay instant on purpose: `sw.js` is network-first for navigations, so every time the installed app is opened it fetches whatever is currently deployed and only falls back to the cached shell if there's no network. There's no build/publish step for updates — push to the branch Netlify deploys and the next app open picks it up, exactly like the website. `netlify.toml` sets `Cache-Control: no-cache` on `/sw.js` and `/manifest.webmanifest` so browsers don't sit on a stale copy of either. Bump the `VERSION` string at the top of `sw.js` when changing what's precached in `SHELL_URLS`, so old caches get dropped on activate.
