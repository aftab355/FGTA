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

## Part 2 · Every time you film

Most of this is only real work the *first* time. What's actually true every
single match:

- **YouTube hands out a new video for every broadcast.** There is no way
  around this — it's how YouTube's live model works — so "Go live" in Studio
  and pasting the resulting link into the app are the two steps you cannot
  skip.
- Everything else below — the app's code, OBS's stream key, the overlay
  browser source — is remembered and reused automatically. Set it up once and
  leave it alone; the walkthrough below just also covers that first time.

### 2.1 In the app

**Matches → Point Tracker → Set up a broadcast.**

That gives you a **code** — five characters the first time, and the *same*
one every time after, because the app remembers it on this device
(`localStorage`, not synced anywhere). The code is what ties the score to a
broadcast — the OBS overlay uses it, and so does everyone watching. It is not
a password; anyone with it can chat and ref.

Because the code doesn't change, the OBS browser source in step 2.3 doesn't
either — add it once and forget it. The only reason to touch the code again
is on purpose (tap **change** next to it in the panel): a code that leaked,
or streaming two courts at once from the same laptop, which needs two.

Leave the panel open. It walks through the rest and is where you paste the
YouTube link at the end.

### 2.2 In YouTube Studio

<https://studio.youtube.com> → **Create → Go live** → *Streaming software*.

- **Title**: whatever. The app shows the match name instead, if it knows it.
- **Visibility**: *Public* or *Unlisted*. Both work. Unlisted streams are
  never discovered automatically — nobody outside the app can stumble on
  them, and the only way anyone finds one is the link you paste in step 2.4.
- **Latency**: **Low**. (*Ultra-low* is about two seconds faster and caps
  quality at 1080p — worth it if somebody is reffing off the stream rather
  than off the court. *Normal* is the only one to avoid; it is ~20 seconds
  behind.)
- **DVR**: on. This is what lets viewers scrub back during the match.
- **Turn on "reusable stream key"** in the stream's settings, if this is your
  first time. With it on, the key you copy below works for every future
  broadcast, and step 2.3 becomes something you never open again either.
- Copy the **stream key** — first time only, if you did the above.

### 2.3 In OBS — first time only, with a reusable key

**Settings → Stream**

- Service: **YouTube - RTMPS**, then paste the stream key.
- Or, if you would rather use a custom server: `rtmp://a.rtmp.youtube.com/live2`
  with the stream key.

**Settings → Output** (Simple mode is fine)

| setting | value |
|---|---|
| Video bitrate | 4500 kbps (2500 if the upload is thin) |
| Encoder | hardware if the machine has it, x264 otherwise |
| Audio bitrate | 160 kbps |

**Settings → Video**: 1920×1080, 30fps. Go to 1280×720 rather than dropping
frames — a court at 30fps is fine, a court at 15fps is not.

**Sources**

1. Your camera (a capture card, a webcam, or a phone via the *Camo* /
   *DroidCam* style apps — anything OBS sees as a camera).
2. **+ → Browser**, and this is the important one:

   | field | value |
   |---|---|
   | URL | the overlay URL from the app's panel — `…/overlay.html?code=ABCDE` |
   | Width | 1920 |
   | Height | 1080 |
   | Shutdown source when not visible | **off** |
   | Refresh browser when scene becomes active | off |

   Drag it over the camera. It is transparent except for the scoreboard, so
   it needs no chroma key and no cropping.

   The app's panel shows **🟢 overlay** once it connects. If it stays ⚪,
   the URL is wrong or the code doesn't match. Once it's in your scene
   collection, this stays — the URL is only wrong again if you deliberately
   change the code (2.1).

Then **Start Streaming**.

**Every match after this one**, assuming a reusable stream key: open OBS,
confirm the scoreboard source shows 🟢 in the app's panel (it will — nothing
here changed), and click **Start Streaming**. That's the entire OBS side.

### 2.4 Back in the app

Paste the stream's YouTube link into step 4 of the panel, or tap it if it has
already been detected. That is what makes everyone else's app play the right
video under the right match name — and the only way an unlisted stream
reaches anyone.

### 2.5 Scoring

Start the match in the Point Tracker as usual, or open **⚖️ ref** in the
stream panel. Every tap goes out over Realtime and lands in three places at
once: the app, everyone watching, and the OBS overlay, which redraws the
burnt-in scoreboard immediately.

Anyone watching can open ⚖️ ref and score too. Their taps are requests; the
device running the Point Tracker is the only one that owns the match state,
so there is no way for two people scoring to fork it.

### 2.6 Ending

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
anything that speaks RTMP works, and the RTMP URL and stream key are the same.

- **iOS / Android**: *Streamlabs*, *Larix Broadcaster*, *Prism Live Studio*.
  Larix is free and has no account.
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
