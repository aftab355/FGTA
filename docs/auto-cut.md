# Auto-cut — rallies out of footage nobody reffed

**Matches → Auto-cut.** Drop in a clip or a whole recording; it finds the
rallies and gives you the cut.

The [rally reel](rally-reel.md) does this exactly, from the umpire's taps —
but only for matches somebody scored in the app. This is the other case: a
clip off a phone, a match nobody was tracking, footage from before any of
this existed. There are no taps, so the boundaries have to come out of the
recording itself.

---

## How it finds them

Not by watching. A tennis court is full of motion that isn't a rally —
players walking back, someone crossing behind the fence, a tree moving in
wind — so picture is a poor signal and an expensive one.

Audio is far cleaner, because **a struck tennis ball is a loud broadband
click and almost nothing else on a court is**. But the real giveaway isn't
one click. It's a *run* of them, roughly a second apart, with silence either
side. Dead time contains no strikes at all. That pattern is what gets
detected, and it's why this works on tennis specifically: the sport hands
you a nearly binary signal.

The pipeline, all of it in the page:

1. **Difference the samples** — a crude high-pass. Clicks survive it; wind,
   traffic and voices are mostly low frequency and get flattened.
2. **RMS envelope every 10 ms.**
3. **Rising edge of its log.** The log is what makes it level-independent:
   a phone on the fence and a phone ten metres back produce the same onset
   strengths, so one sensitivity setting covers both.
4. **Peak-pick** against a local threshold *and* two absolute floors.
5. **Group** strikes less than `maxGap` apart, and require at least one
   properly struck ball in the group.
6. **Pad** first strike to last, into a clip.

### Two things that took a second attempt

**An adaptive threshold alone cuts nothing.** Local mean + k·sd sounds
right, but between points that window is nearly silent — its mean and sd are
tiny, so every faint rustle clears the bar, the clusters bridge the gaps, and
the "cut" comes out as the whole recording. A racket strike isn't merely a
local maximum; it's one of the loudest transients in the file. Hence the
absolute floors.

**Players bounce the ball before serving.** Those are real transients and the
detector is right to find them, but four bounces in three seconds is a
cluster and became its own "rally". The fix is that a rally must contain one
*hard* strike: a bounce is never as hard as a forehand, at any mic distance,
because both scale together.

### Measured

Against synthetic matches with known ground truth, across six conditions —
mic near the court, windy, distant mic with quiet hits, players talking
through the dead time, players bouncing before serving, and all of it at
once:

| | result |
|---|---|
| rallies found | **every one**, in all six |
| false positives | **0–1 per 20 minutes** |
| cut | **54–57%** of the runtime removed |
| speed | ~200 ms of analysis per hour of audio |

Synthetic audio is not real audio. Those numbers say the method is sound,
not that your footage will behave. That's exactly why every threshold is on
a slider and why the output is a **review list**, not a finished file.

### The one it can't do by ear

**An adjacent court in use sounds exactly like your court.** There is no
audio-only fix — the strikes are identical. If courts either side of you are
busy, expect extra clips.

On a **video** file there is now a second pass that can: a rally on the next
court is, from your camera, a still frame with a soundtrack, so the picture
is checked for someone actually moving on your court while those strikes were
heard. It runs by itself after this one and only ever pre-drops, into the
same review list. See [Watching the picture](video-analyzer.md) — including
what it deliberately does not attempt, which is the ball, the bounce and the
score.

On an audio-only file, or when the picture pass declares itself blind, the
review pass is still the fix, and the app says so rather than leaving you to
discover it.

---

## Using it

**Nothing is uploaded.** The file is read with the File API and decoded by
your own browser. It never leaves the device — there is no server in this
app that could receive a video.

1. **Drop a file in.** Video or audio. A video also gets the
   [picture pass](video-analyzer.md), which starts on its own once the
   rallies are found.
2. **Wait for the decode.** The detecting is milliseconds; the decoding is
   the slow part, and it's the browser doing it.
3. **Review.** Every clip is listed with its time, how many strikes it
   contains, and how long it runs. Tap ✓ to drop one. Only ticked clips are
   exported. With a video you get a preview that plays the kept rallies
   back-to-back, skipping everything else.
4. **Retune if needed** — instant, because the recording is only decoded
   once. **Sensitivity** is the one to reach for: too many clips, lower it;
   missed rallies, raise it.
5. **Export.**

### Strikes per minute

The panel reports how many strikes it heard per minute. A real singles match
runs about **15–25**. Far above that and it's hearing the next court or
picking up noise — lower the sensitivity. Far below and it's missing the
ball — raise it. It's the fastest way to tell whether a result is worth
reviewing at all.

### Big files

Decoding needs the whole file in memory, so past about 1.2 GB the tab won't
survive it and the app says so instead of hanging. The detector only ever
listens to the audio, so give it just the audio:

```bash
ffmpeg -i match.mov -vn -ac 1 -ar 16000 -c:a aac -b:a 48k audio.m4a
```

A few seconds, a few MB. Drop `audio.m4a` in instead — the timings come out
identical because it shares a clock with the video, so the cut script it
produces runs against your original file unchanged.

---

## Exports

Same two as the reel, from the same generator.

**`⬇ ffmpeg script`** — defaults to the filename you dropped in, so it's
usually just:

```bash
bash fgta-my-footage-cut.sh
```

Each rally is extracted on its own and the pieces are joined. It re-encodes
rather than stream-copying, because a copy can only cut on keyframes — which
in practice means several extra seconds of walking about at the head of every
clip.

**`⬇ cut list (JSON)`** — the segments with strike counts, for feeding
something else.

**The browser finds the cut; ffmpeg performs it.** Nothing is re-encoded in
the page — a phone should not be transcoding an hour of tennis, and doing it
in a tab would be slower and worse than the one command that already exists.

---

## Which one should I use?

| | rally reel | auto-cut (audio) | auto-cut (+ picture) |
|---|---|---|---|
| needs | the match scored in the point tracker | any footage | a video file |
| accuracy | exact — real point endings | good first pass, review it | fewer wrong clips, still review it |
| knows the score | yes: set, game, who won each point | no | no |
| filters | long rallies, pressure, aces, per player | none — it's just rallies | none |
| next court over | irrelevant | will be picked up | usually thrown out |
| rallies nobody heard | n/a | missed | still missed — it only checks candidates |

If the match was reffed in the app, use the reel. It's not a better version
of the same guess — it's not a guess at all.
