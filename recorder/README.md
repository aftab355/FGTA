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
   (~150 MB) plus its own ffmpeg (~80 MB, used only for combining angles and
   cutting highlights — see below). It does not touch the Chrome you already
   use and does not put anything on your PATH.

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

## After the match: one file, and the highlights

Under *Watch back*, every recorded match has two buttons.

**one file** puts every camera onto a single timeline, side by side, with all
of their microphones mixed together, and writes it as one MP4 that plays
anywhere. Cameras that joined late are padded with black at the front, so a
given moment in the output is the same moment in every cell — the file is
genuinely synchronised, not just concatenated.

Two cameras make a 1920x540 file (two 960x540 cells, nothing wasted), three or
four make a 1920x1080 grid, more go to smaller cells.

**highlights** finds the moments worth keeping and cuts them out, then joins
them into a reel. Three things decide, in order:

1. **The score.** While recording, the recorder is a viewer like any other, so
   the host's live match state arrives here — games, sets, aces, match points —
   and is written down with the time it happened, next to the video.
2. **The crowd.** A rally worth watching ends in noise. Loudness is measured
   across the recording and peaks are picked out relative to how loud this
   particular court usually is, which works even when nobody was scoring.
3. **Claude.** Each surviving moment is sent as three stills to the same
   `/api/highlight` endpoint the live stream already asks before it auto-replays
   something, which answers whether it is actually worth watching and gives it
   a short caption. Clips are named after that caption.

If the endpoint cannot be reached — this PC is offline, or the site has not
been deployed — the clipper falls back to its own verdict and marks those clips
*not judged* rather than producing nothing. No API key lives on this PC.

Both are ffmpeg jobs. They take minutes on a long match, run one at a time so
they never compete with a recording in progress, and report progress at the top
of the dashboard. The results land under *Made from recordings*, deliberately
kept apart from the originals so they are never mistaken for another camera
angle of the match they were made from.

### ffmpeg

`npm install` brings its own ffmpeg (the `ffmpeg-static` package), so there is
nothing to install by hand and nothing added to your PATH. If this PC has an
NVIDIA card the encoder is the GPU (`h264_nvenc`), which is several times
faster than the CPU and leaves it free for the match that may still be
recording; Intel and AMD hardware encoders are used the same way when they are
there. The startup log and the dashboard both say which one is in use.

Recording itself never touches ffmpeg. If it is missing, everything above is
unavailable and everything else works exactly as before.

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
| `FGTA_FFMPEG` | the bundled one | path to your own ffmpeg build |
| `FGTA_HIGHLIGHT_URL` | `/api/highlight` on the app URL | where the highlight judge lives |

```powershell
$env:FGTA_PORT=9000; npm start
```

## If something is wrong

The dashboard's **Log** panel is the first place to look. It only holds the
last 300 lines and starts empty after a restart, so for anything that happened
overnight read **`recorder.log`** in this folder instead — every line the
dashboard shows is mirrored there with a full timestamp, and it survives
restarts.

The log also records what the recorder can see: a line every time the list of
live matches changes, and a line when it joins one. If a match was live and the
log never mentions it, the recorder never saw it announced — that is a
directory problem, not a recording one, and restarting the recorder clears it.

If the browser crashes the recorder now says so and rebuilds it rather than
sitting there silently doing nothing; auto-record carries on afterwards.

- **"Could not load the FGTA app"** — no internet on first run. After one
  successful start it caches a copy and can run without it.
- **Joins but never records** — the angles are not reaching *live*. That is a
  connection problem between the phones and this PC, not a recorder problem;
  run the connection test in the app.
- **Nothing under *Live now*** — the recorder only sees matches that are
  actually streaming. Check the phone says `live` and share the code manually.

- **"No ffmpeg found"** — `npm install` did not finish, or it was skipped. Run
  it again in this folder, or point `FGTA_FFMPEG` at a build you already have.
  Recording is unaffected either way.
- **"nothing stood out in this recording"** — no score was being kept and the
  court was quiet throughout, so there was nothing for the clipper to find. The
  combined file is still the useful thing there.

## What this is not

It is not a video editor. What it records is what the cameras broadcast, and
what it makes from that is one combined file and a set of clips — good enough
to watch and to hand to somebody, not a substitute for cutting a match properly
if that is what you want.

The recordings themselves are never re-encoded. Each angle is stored exactly as
it arrived; combining and clipping produce new files and leave the originals
untouched.
