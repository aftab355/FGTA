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

### At the court, this is the whole routine

Assuming the one-time setup below is done:

1. App → Matches → Point Tracker → **Set up a broadcast**.
2. OBS → **Start Streaming**.
3. Wait ~20–30s. The app auto-detects the new broadcast and shows it as a
   tappable card in step 4 of the panel — tap it. (If it hasn't shown up yet,
   the regular **YouTube app** on your phone — not Studio — has it at the top
   of your channel; copy that link in instead.)
4. Score.

No Studio, no typing a stream key, no re-adding the overlay. That's only
true because of the setup below — do that first, once, not at the court.

### 2.0 One-time setup — do this before match day

**a. A reusable stream key.** <https://studio.youtube.com> → **Create → Go
live** → *Streaming software*, and in the stream's settings turn on
**"reusable" / "persistent" stream key**. This is the whole trick: with it
on, YouTube auto-creates a new broadcast the instant OBS starts sending
video to that key — no visit to Studio's create-broadcast screen, ever
again. Set latency to **Low** (*Ultra-low* is ~2s faster and caps quality at
1080p; *Normal* is the one to avoid, ~20s behind) and DVR on. Copy the key.

**b. Point OBS at it.** Settings → Stream → Service **YouTube - RTMPS**,
paste the key. Or, on the custom server: `rtmp://a.rtmp.youtube.com/live2`
with the same key.

Settings → Output (Simple mode is fine):

| setting | value |
|---|---|
| Video bitrate | 4500 kbps (2500 if the upload is thin) |
| Encoder | hardware if the machine has it, x264 otherwise |
| Audio bitrate | 160 kbps |

Settings → Video: 1920×1080, 30fps. Go to 1280×720 rather than dropping
frames — a court at 30fps is fine, a court at 15fps is not.

**c. Add the scoreboard.** In the app: Matches → Point Tracker → Set up a
broadcast → copy the overlay URL from step 3 of the panel. In OBS: **+ →
Browser**:

| field | value |
|---|---|
| URL | the overlay URL — `…/overlay.html?code=ABCDE` |
| Width | 1920 |
| Height | 1080 |
| Shutdown source when not visible | **off** |
| Refresh browser when scene becomes active | off |

Drag it over your camera source. It's transparent except for the scoreboard
— no chroma key, no cropping. The panel shows **🟢 overlay** once it
connects.

This URL's code is remembered on this device and reused every time you tap
"Set up a broadcast" (`localStorage`, not synced anywhere), so this browser
source is correct forever — it isn't a password, it's just what ties the
overlay, chat, and everyone watching to the same broadcast. The only reason
to revisit it is on purpose, via **change** next to the code in the app's
panel: a leaked code, or two courts streaming at once from the same laptop.

That's it — (a), (b), (c) are each done exactly once. Everything from here
on is the four-step routine at the top of this section.

### Visibility, every match

**Public** or **Unlisted**, set once inside your persistent stream's default
settings so you don't have to think about it per match. Unlisted streams are
never auto-discovered outside the app — the link paste in step 3 of the
routine above is the only way anyone finds one, which is also exactly why
that step can't be automated away.

### Scoring

Start the match in the Point Tracker as usual, or open **⚖️ ref** in the
stream panel. Every tap goes out over Realtime and lands in three places at
once: the app, everyone watching, and the OBS overlay, which redraws the
burnt-in scoreboard immediately.

Anyone watching can open ⚖️ ref and score too. Their taps are requests; the
device running the Point Tracker is the only one that owns the match state,
so there is no way for two people scoring to fork it.

### Ending

Stop the stream **in OBS**. Closing the app's panel does not stop YouTube —
it never had control of it. A minute or so later the finished broadcast
appears under *past broadcasts* on the stream panel, and stays there.

---

## Latency

YouTube is a few seconds behind: roughly 2–5s on Ultra-low, 5–15s on Low,
15–30s on Normal.

**The burnt-in scoreboard is unaffected.** OBS composites `overlay.html` over
the camera *before* encoding, so the score and the picture it sits on are the
same instant by construction, however far behind both of them arrive.

**The in-page score bug is affected**, because it is drawn by the site on top
of an already-delayed picture. Left alone it would announce the point several
seconds before you saw it. So it is off by default, and when switched on it
delays incoming scores to match — the slider is under ⚙️ in the stream panel.
Set it by watching a point land and dragging until the numbers change at the
same moment. Ten seconds is right for the Low setting.

---

## Filming from a phone

OBS itself is desktop-only, but nothing above requires OBS specifically —
anything that speaks RTMP works, and it's the same reusable key from step
2.0a. The at-the-court routine is identical: open the app, open the RTMP
app, hit go, wait, link.

- **iOS / Android**: *Streamlabs*, *Larix Broadcaster*, *Prism Live Studio*.
  Larix is free and has no account. Paste the same persistent key into it
  once, the same way as OBS.
- **The YouTube app's own "Go live"** works and is the simplest option, but
  it needs 50+ subscribers on the channel and gives you no way to add the
  scoreboard overlay.

Without OBS there is no browser source, so no burnt-in scoreboard. Viewers
can still turn the in-page score bug on (⚙️ → score), which is what it is
there for.

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
