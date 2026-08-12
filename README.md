# Handoff: FGTA Tennis Ladder App

## Overview
FGTA is a competitive tennis ladder web app for a friend group: report/track 1v1 and doubles matches, run tournaments, browse Elo-style rankings and analytics, watch live peer-to-peer streams of matches, log casual sessions, and manage a shared calendar. It runs against Supabase (Postgres + Realtime) for data and live features, plus the free Open-Meteo API for ambient weather theming.

## About the Design Files
The bundled file (ladder-merged.html) is a **working HTML/CSS/vanilla-JS prototype**, not production code to copy as-is. It was built as a single-file app directly against Supabase's JS client, with no build step, no component framework, and all styling inline/in one <style> block. Treat it as a **design and behavior reference**: recreate the same screens, interactions, and visual language in the target codebase's actual stack (React/Vue/native/etc., whichever the project already uses — or the most sensible choice if starting fresh). Reuse its logic (Elo/Glicko math, calendar aggregation, tilt/hover effects, etc.) as the source of truth for *what* to build, not the file structure for *how*.

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
  - Built-in livestream panel: "Go live" (WebRTC peer-to-peer via Supabase Realtime signaling, capped at 3 viewers), a stream code, viewer count, fullscreen toggle, live chat, mic/camera toggles, video filters (grayscale/sepia/neon/VHS), a zoom slider, instant replay (slow-mo clip with a "REPLAY" bug), and a perspective switcher to watch other camera angles of the same match if others are also streaming it.
  - Camera flip (🔄) asks for the opposite lens with an `exact` constraint, falls back to the opposite-facing device by id, and verifies afterwards that the camera actually changed — an `ideal` facing hint loses to the resolution hint on a lot of phones and silently returns the lens you were already on. What the flip asked for is remembered separately from what the device reports, because plenty of devices report nothing. Every camera event lands in the 🩺 stream-health log.
  - Hawk-Eye rewind (🦅): the last ~60s of every camera is kept on the device as a chain of short overlapping recordings, and can be scrubbed side by side, at ¼/½/1× or a frame at a time, without touching the broadcast or asking anyone filming for anything. A toggle — it is a second video encoder per angle — on by default where there is headroom, off on a small phone.
  - A camera is also a spectator. Cameras announce themselves to each other over the signalling channel they already share (`host-hello`), so a phone that is filming knows who else is filming: it can cut the broadcast to another camera by name (🎬, the same `director_cut` a viewer sends), rewind its own picture, and — with 📺 monitoring on, which costs one of each other camera's three viewer slots — pull in the other angles and rewind those too. A camera reviews muted, because its own microphone is live.
  - Recording watchdog: the composite loop runs off `requestAnimationFrame` with a timer underneath it, so a backgrounded page keeps producing frames instead of freezing the stream and quietly recording a still photograph; and if the recording's byte rate collapses anyway (measured: ~3 KB/s frozen vs ~390 KB/s filming) the 🩺 log and a toast say so during the match rather than after it.
  - Live score "bug" overlay and a Match Point tension banner when the score is close.
- **Archive**: past-match history, editable "fix a game" flow that lets you flip a game's recorded winner if the point math still supports it, CSV export.
- **Rivalries**: pick two players to see head-to-head history, rating swing, and trend; a "fiercest rivalries" leaderboard by games played.

### 4. Predict
Forecast / Live & sims / Fixtures subtabs — win-probability model, Monte Carlo match simulation, and a "Rating Galaxy" force-directed canvas visualization (players as nodes sized by rating, rivalries as glowing links).

### 5. Analytics
Overview / Rating models / Validation / Story & records subtabs — 18 advanced stats: Clutch Factor, time-of-day performance splits, nemesis detection, redemption tracking, record book, rookie board, vibe tagging, team Elo, Glicko-2, a Markov point-transition model, Dominance Ratio, recency-weighted Elo, workload (ACWR), umpire ratings, and more. Charts are inline SVG line/bar charts with a shared JetBrains Mono axis-label style.

### 6. Court
Live local weather (Open-Meteo, Toronto) driving ambient theming: background tint + a subtle canvas particle overlay (rain streaks, snow, fog, twinkling stars) behind the app, gated off on mobile for performance.

### 7. Events
Tournament creation (admin) and bracket/format display; round-robin supported. Upcoming tournaments show a countdown; admins can go live, edit schedule, or delete a tournament.

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
- ladder-merged.html — the full app (single file, ~13.7k lines: styles, markup for every view, and all JS logic including Supabase calls, Elo/Glicko/Markov models, calendar, livestream/WebRTC, and realtime presence).
- FGTA Ladder (standalone).html — the same app pre-bundled as a self-contained offline-loadable file (fonts/scripts inlined); useful for opening/reviewing without a dev server, not meant as a build artifact.
