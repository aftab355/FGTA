# Streaming a match

The picture goes out through **OBS → YouTube**. The site embeds whatever
YouTube says is live and keeps the FGTA layer around it: chat, the ref deck,
the score bug, and a scoreboard overlay that OBS burns into the video.

This replaced a peer-to-peer WebRTC stream. Three things are different, and
they are the reason for the change:

|  | before | now |
|---|---|---|
| viewers | 3, hard limit | as many as turn up |
| different networks | needed a TURN relay, and usually failed | YouTube's problem, not yours |
| after the match | record by hand, 2GB off a phone | the VOD is there, free, immediately |

The cost is **latency**: the stream is a few seconds behind real life instead
of a fraction of one. That matters in exactly one place, and it is handled —
see [Latency](#latency).

There are two setups: one you do once for the whole league, and one you do
each time you film.

---

## Part 1 · One-time, for the league

Somebody with access to the Netlify site and the YouTube channel does this
once.

### 1.1 A YouTube channel with live streaming enabled

1. Sign in to the Google account the league should stream from.
2. Go to <https://youtube.com/live_dashboard> and enable live streaming.
   **This takes up to 24 hours the first time.** Do it before the day you
   want to use it, not on it.
3. Note the **channel ID** — YouTube Studio → Settings → Channel → Advanced
   settings. It starts with `UC` and is 24 characters.

Streaming below 1080p needs nothing else. 1080p60 and going live from a phone
with the YouTube app need 50+ subscribers, which is a YouTube rule and not
something the site can work around; OBS on a laptop has no such requirement.

### 1.2 A YouTube Data API key

This is only so the site can answer "is anything live right now" without
anybody typing a link. Everything still works without it — you just have to
paste links.

1. <https://console.cloud.google.com> → create a project (any name).
2. **APIs & Services → Library → YouTube Data API v3 → Enable.**
3. **Credentials → Create credentials → API key.**
4. Restrict it, or it is a key anyone who finds it can spend:
   - *API restrictions* → **YouTube Data API v3** only.
   - *Application restrictions* → **None**. The key is used from the Netlify
     function, server-side, so an HTTP-referrer restriction would block it.
     Leave it unrestricted here and keep it out of the browser (which is
     exactly why this goes through a function rather than straight from
     `index.html`).

### 1.3 Two environment variables on Netlify

Site configuration → Environment variables:

| variable | value |
|---|---|
| `YOUTUBE_API_KEY` | the key from 1.2 |
| `YOUTUBE_CHANNEL_ID` | the `UC…` id from 1.1 |

Redeploy. The Point Tracker's stream panel should now list anything live on
that channel; when it can't, it says why rather than looking broken.

**Quota.** The API allows 10,000 units a day. This uses 2 units per refresh
and refreshes at most every 45 seconds, with a CDN cache in front so a
hundred viewers cost the same as one — roughly 4,000 units on a day of
constant polling. The obvious implementation (`search.list`) costs 100 units
a call and would have run out by lunchtime; `netlify/functions/youtube.mts`
explains what it does instead. If you ever do exhaust it, the panel says so
and pasting a link still works. It resets at midnight Pacific.

---

## Part 2 · Streaming a match

Two ways to get a picture out. Pick whichever matches what you actually
carry to a court — this is a hardware choice, not an app setting, and it's
made once:

| | **Just a phone** | **A laptop** |
|---|---|---|
| streaming app | Larix Broadcaster (free, no account) | OBS |
| burnt-in scoreboard | no — use the in-page score bug instead | yes |
| everything else | identical | identical |

The rest of this doc is written for the phone path first, since that's what
most people are actually holding at a court, with OBS's equivalents alongside.

### At the court, this is the whole routine

Assuming the one-time setup below is done:

1. App → Matches → Point Tracker → **Set up a broadcast**.
2. **Larix → tap the broadcast button.** (OBS → Start Streaming.)
3. Wait ~20–30s. The app auto-detects the new broadcast and shows it as a
   tappable card in step 4 of the panel — tap it. (If it hasn't shown up yet,
   the regular **YouTube app** on your phone — not Studio — has it at the top
   of your channel; copy that link in instead.)
4. Score.

No Studio, no typing a stream key, no reconfiguring anything. That's only
true because of the setup below — do that first, once, not at the court.

### 2.0 One-time setup — do this before match day

**a. A reusable stream key.** <https://studio.youtube.com> → **Create → Go
live** → *Streaming software*, and in the stream's settings turn on
**"reusable" / "persistent" stream key**. This is the whole trick: with it
on, YouTube auto-creates a new broadcast the instant your phone starts
sending it video — no visit to Studio's create-broadcast screen, ever again.
Set latency to **Low** (*Ultra-low* is ~2s faster and caps quality at 1080p;
*Normal* is the one to avoid, ~20s behind) and DVR on. Copy the key.

**b. Point Larix at it.**

1. Install *Larix Broadcaster* — App Store / Google Play, free, no sign-up.
2. **Connections → +** → add an RTMP connection:

   | field | value |
   |---|---|
   | URL | `rtmp://a.rtmp.youtube.com/live2` |
   | Stream name / key | the key from step (a) |

3. Save it. It stays in the app from here on — this is the one-time part.
4. Video settings: 1920×1080 (or 1280×720 if your upload is thin), 30fps,
   ~4500 kbps (2500 if thin). Larix picks sane defaults; these are worth
   checking once.

*(On a laptop instead: OBS → Settings → Stream → Service **YouTube - RTMPS**
→ paste the key. Same one-time deal.)*

**c. The scoreboard is OBS-only — skip this on a phone.** A phone streaming
app has no way to composite an HTML overlay onto outgoing video the way
OBS's Browser Source does, so there's no burnt-in scoreboard to set up.
Instead, anyone watching turns on the **in-page score bug** from the stream
panel (⚙️ → score) — it's drawn by the site over the player, not by your
phone, so it costs you nothing to leave off. See [Latency](#latency) for why
it's delayed by default.

*(On a laptop: In the app's stream panel, copy the overlay URL from step 3.
In OBS: **+ → Browser**, paste it, 1920×1080, "Shutdown source when not
visible" **off**. Drag it over your camera source — it's transparent except
for the scoreboard. The panel shows **🟢 overlay** once it connects, and
because the code in that URL is remembered on this device (see below), this
source is correct forever once it's added.)*

The session **code** itself — visible in the app's panel, and part of the
overlay URL if you're using one — is remembered on this device
(`localStorage`, not synced anywhere) and reused automatically every time
you tap "Set up a broadcast." It isn't a password; anyone with it can chat
and ref. The only reason to change it is on purpose, via **change** next to
the code in the panel: a leaked code, or two courts streaming at once from
the same device.

### Visibility, every match

**Public** or **Unlisted**, set once inside your persistent stream's default
settings so you don't have to think about it per match. Unlisted streams are
never auto-discovered outside the app — the link paste in step 3 of the
routine above is the only way anyone finds one, which is also exactly why
that step can't be automated away.

### Scoring

Start the match in the Point Tracker as usual, or open **⚖️ ref** in the
stream panel. Every tap goes out over Realtime and lands wherever it's
needed: the app, everyone watching, and — if you set up the OBS overlay —
the burnt-in scoreboard, redrawn instantly.

Anyone watching can open ⚖️ ref and score too. Their taps are requests; the
device running the Point Tracker is the only one that owns the match state,
so there is no way for two people scoring to fork it.

### Ending

Stop the stream in whatever's sending it — Larix's broadcast button again,
or OBS. Closing the app's panel does not stop YouTube; it never had control
of it. A minute or so later the finished broadcast appears under *past
broadcasts* on the stream panel, and stays there.

---

## Posting a video to the feed

Nothing here is only for live matches. A highlight cut, a lesson clip, a
rally somebody filmed on a phone — upload it to YouTube, paste the link into
a post, a match comment, a reply or a DM, and the feed shows a player rather
than a URL.

There is no separate field for it and nothing to upload to this site. The
link in the text *is* the attachment, which is also why it works on posts
written before the feature existed.

- **Unlisted is fine.** Unlisted videos embed exactly like public ones —
  only **Private** doesn't, and it fails the same way everywhere else on
  this site. Leave *Advanced settings → allow embedding* on.
- **Nothing unlisted is ever auto-discovered.** The "live now" and "past
  broadcasts" lists come from the channel's uploads via `/api/youtube`, and
  an unlisted video isn't in it. Past broadcasts is also *finished live
  streams only*, so an ordinary upload never appears there even when it's
  public. Pasting the link is how anyone finds either.
- **Three videos per post.** A fourth link stays as text.
- The card shows a thumbnail until somebody taps it; the player itself is
  only built on that tap.

**Editing a match rather than posting a clip?** Don't cut it by hand — the
[rally reel](rally-reel.md) plays the rallies out of the untouched
recording, and can hand you an `ffmpeg` script if you want a real file. An
already-edited cut attached there won't line up, because the reel's
timecodes are the match's, not your edit's.

---

## Latency

YouTube is a few seconds behind: roughly 2–5s on Ultra-low, 5–15s on Low,
15–30s on Normal.

**The burnt-in scoreboard (OBS only) is unaffected.** OBS composites
`overlay.html` over the camera *before* encoding, so the score and the
picture it sits on are the same instant by construction, however far behind
both of them arrive.

**The in-page score bug is affected**, because it is drawn by the site on top
of an already-delayed picture. Left alone it would announce the point several
seconds before you saw it. So it is off by default, and when switched on it
delays incoming scores to match — the slider is under ⚙️ in the stream panel.
Set it by watching a point land and dragging until the numbers change at the
same moment. Ten seconds is right for the Low setting.

---

## Other streaming apps

Larix is the recommendation because it's free, needs no account, and just
works — but anything that speaks RTMP is a drop-in replacement, using the
same URL and key from step 2.0b: *Streamlabs*, *Prism Live Studio*, and
others.

**The YouTube app's own "Go live"** also works and is the simplest option of
all, but it needs 50+ subscribers on the channel to unlock, and gives no way
to add a scoreboard overlay even on a laptop.

---

## When something is wrong

**The panel says "Automatic what's-live lookup isn't set up".**
`YOUTUBE_API_KEY` / `YOUTUBE_CHANNEL_ID` are missing on the deploy, or the
site hasn't been redeployed since they were added. Pasting a link works
regardless.

**Nothing appears in "live now" but the stream is definitely up.**
Either it is unlisted (expected — paste the link), or YouTube's own listing
is lagging, which it does for up to a minute after a stream starts. Tap
*check now*.

**"Embedding is turned off for this video".**
YouTube Studio → the video → *Advanced settings* → allow embedding. Some
"made for kids" settings force this off and cannot be overridden; the panel
offers a link to open it on YouTube instead.

**The overlay indicator stays ⚪.**
The browser source URL and the code in the app must match exactly. Open the
overlay URL in an ordinary browser tab — it shows a small chip saying whether
it connected, and to which code.

**The overlay is connected but shows no score.**
Nothing is being tracked yet. Start the match in the Point Tracker, or tap a
point in ⚖️ ref.

**The scoreboard is the wrong size.**
The browser source must be 1920×1080 even if you are streaming 720p — OBS
scales it with the rest of the scene. If your canvas is something unusual,
add `&scale=1.5` (or whatever) to the overlay URL.

**Chat is empty for one person and not another.**
They are on different codes. Everyone who reaches the stream through the app
shares one; someone who found the video on YouTube itself gets the video's
own room. Have them open it from the app.

---

## What this replaced

Deleted along with the WebRTC transport, because all of them existed only to
work around its limits:

- the **TURN relay** setup guide, and the relay-configuration panel
- the **PC recorder** (`recorder/`) — YouTube keeps the recording now
- **Hawk-Eye rewind** — the player's own DVR scrub does this, on every device,
  with no second video encoder running on the viewer's phone
- **instant replay**, **auto-highlights** and the **AI highlight judge** —
  all of them needed the raw frames in the browser, which an embedded player
  does not give you
- **camera flip, zoom, filters, mic and camera toggles, set-break graphics** —
  OBS does every one of these, better

Kept, unchanged: live chat, ref mode from any device, the score bug, the live
match directory, fullscreen with the chat and ref drawers.
