# FGTA recorder

Turns a PC into a silent extra viewer that records a live match to its own
disk — **every camera angle at once, one file per angle**, at higher quality
than a phone would keep. Nothing is uploaded, nothing fills up anyone's phone,
and the people filming can close the app afterwards without losing anything.

The people filming do nothing differently. The recorder joins the same code
they are already streaming with.

---

## Install (Windows)

1. **Install Node.js** — the LTS build from <https://nodejs.org>. Accept the
   defaults.

2. **Open a terminal in this folder.** Shift + right-click the `recorder`
   folder → *Open PowerShell window here*.

3. **Install:**

   ```powershell
   npm install
   ```

   This pulls in Playwright and downloads a private copy of Chromium
   (~150 MB). It does not touch the Chrome you already use.

4. **Run it:**

   ```powershell
   npm start
   ```

   Or double-click **`start.bat`**.

It prints something like:

```
  Dashboard:  http://localhost:8910
  From phone: http://192.168.1.42:8910
  Saving to:  C:\...\recorder\recordings
```

## Using it

Open the dashboard — from the PC, or from your phone on the same wifi using the
`From phone:` address.

**Auto-record is on by default.** Leave the PC running and it joins whatever
goes live and records it, with nobody touching anything. That is the intended
way to use it.

To drive it manually, turn auto off and either type a code and press **record**,
or tap a match under *Live now*.

While recording you get a file per angle, named after the camera:

```
67WB5__Court-cam__2026-08-11T14-22-05.webm
67WB5__Baseline-cam__2026-08-11T14-22-31.webm
```

They appear under *Saved on this PC* and play in the browser, VLC, or anything
else. Angles that join late get their own file from the moment they connect;
an angle that stops closes its file and the rest keep going.

---

## Worth knowing

- **It uses one viewer slot.** Each camera accepts 3 viewers, and the recorder
  is one of them, so 2 people can still watch live while it records. If you
  would rather have all 3 slots for people, stop the recorder.

- **It records what the camera actually broadcast** — the composed picture
  including the burnt-in scoreboard, replays and set-break graphics, plus the
  host's audio. It is the broadcast, not a raw camera feed.

- **MP4 if this PC has Google Chrome installed, WebM otherwise.** The recorder
  uses your Chrome when it can find it, because Chrome ships the licensed
  H.264/AAC codecs that make an MP4 play in Windows Media Player, on a phone,
  and in any editor. Playwright's own bundled browser has no such codecs — the
  best MP4 it can write is VP9 inside an MP4 container, which is *worse* than
  WebM because the file name promises compatibility it does not have, so in
  that case the recorder deliberately stays on WebM. The startup log says which
  one it picked. If you want MP4 and do not have Chrome, installing it is the
  whole fix.

- **Recording quality follows the broadcast.** These files are as good as what
  the phone sent, and no better — the recorder cannot add detail that never
  arrived. Cameras send up to 720p; the app now stops WebRTC quietly collapsing
  that to 320x180 on a nervous connection, but a genuinely poor link will still
  send a smaller picture and the recording will show it.

- **Recording keeps going even for the angle nobody is watching.** All angles
  are recorded in parallel and independently.

- **Bandwidth**: roughly 3 Mbps down per angle. Two angles for two hours is
  about 5 GB on disk at the quality this records at (6 Mbps video).

- **It needs the phones to reach it.** If the cameras are on mobile data and
  the PC is at home, that traffic goes through a TURN relay — see
  [`../docs/self-hosted-relay.md`](../docs/self-hosted-relay.md). Running that
  relay on this same PC is a good idea, and the connection test in the app will
  tell you whether it is working before a match.

- **Leave it running.** Idle cost is a headless browser doing nothing. It only
  works while the PC is on and awake — check your power settings do not sleep
  the machine mid-match.

## Settings

Environment variables, if you need them:

| Variable | Default | What it does |
|---|---|---|
| `FGTA_PORT` | `8910` | dashboard / API port |
| `FGTA_APP_URL` | `https://fgta.netlify.app/index.html` | which deployment to join |

```powershell
$env:FGTA_PORT=9000; npm start
```

## If something is wrong

The dashboard's **Log** panel is the first place to look.

- **"Could not load the FGTA app"** — no internet on first run. After one
  successful start it caches a copy and can run without it.
- **Joins but never records** — the angles are not reaching *live*. That is a
  connection problem between the phones and this PC, not a recorder problem;
  run the connection test in the app.
- **Nothing under *Live now*** — the recorder only sees matches that are
  actually streaming. Check the phone says `live` and share the code manually.

## What this is not

It does not re-encode, transcode, or produce a single combined multi-angle
video. Each angle is stored as it arrived. Editing them together afterwards is
a job for a video editor.
