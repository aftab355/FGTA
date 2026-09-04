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

### How loud is loud enough

Not a fraction of a percentile of the whole recording, which is what this
used to be and what made it fail. Where the 99.5th percentile sits depends on
how much of the recording is rallies, so a match with long gaps drags it down
until court ambience clears the bar. Measured on a fixture with six rallies in
63 seconds: **30 strikes played, 35 found inside the rallies, and 117 more
found in the silence between them.** Finding strikes was never the problem.
Rejecting silence was — and no setting of the sensitivity slider fixed it,
because the slider moves a threshold that was anchored to the wrong thing.
Phantom strikes in a gap are not cosmetic: two of them inside `maxGap` weld a
rally to its neighbour, and a handful turn a whole match into one clip.

Otsu's method is the obvious fix and does not work here. The peaks genuinely
are two populations, twelve times apart, but Otsu weights by class *size* and
here that is 30 strikes against 2,000 noise peaks — with a 1.5% minority the
threshold lands deep inside the majority. It returned 0.043 where strikes sit
at 2.6.

So the floor is anchored to the **noise** instead. Noise is the majority by a
wide margin in any recording of a sport played with gaps in it, so its centre
and spread are well estimated; the strikes are sparse, and how far up a
percentile they land is exactly the density-dependence that broke the old
rule. A strike is a peak four robust deviations above the typical peak —
median and MAD, in log space, since the two populations are separated
multiplicatively. And it defers: the floor used is whichever of this and the
old one is higher, and if raising it that far would leave almost no peaks
standing it is not applied at all, because a floor that finds nothing is not
a floor.

### And then four sigmas was wrong too

Four was where both fixtures had margin. Real footage is neither of them: on a
24-minute match it left **two rallies and eight seconds**, 99% of the
recording cut. Which is the same mistake as the one it replaced, pointing the
other way — a number calibrated on the recordings that happened to be
available.

So it is not a number any more. The bar is chosen by **what it leaves
behind**: the strictest setting that still keeps a plausible number of strikes
a minute, starting at four and coming down. A real singles match runs 15–25;
well under ten means rallies are being lost, whatever the arithmetic thinks of
the noise.

The obvious improvement is wrong and the code says so. Bracketing from both
ends — *the strictest bar that lands in a plausible band* — sounds better and
measurably is not: on a clean recording it settles half a deviation **above**
what was needed, because 18 strikes a minute is as much "in band" as 32, and
it gets there by throwing away four strikes in ten. Five rallies came out as
ten clips. Being in a plausible band is not the same as not losing anything,
and the two failures are not symmetric: an extra clip is one tap to drop, a
lost rally is gone.

What it does not fix, and does not pretend to, is a recording that is not
tennis. A camera left running somewhere noisy has loud peaks and no strikes,
and no bar drawn from the noise can separate them when there is nothing else
there. The strikes-per-minute figure catches that, and the panel says so in
words.

`node test/floor.test.js` runs three recordings that are nothing like each
other — strikes towering over the ambience, strikes barely clearing it, and no
tennis at all — and `node test/onsets.test.js` prints the sweep.

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

And against two recorded fixtures with real soundtracks, after the floor above
was fixed — the second of which used to come back as a single clip:

| | played | detected | in the dead time | clips |
|---|---|---|---|---|
| flat court, quiet | 31 | 31 | **0** | 4 of 4 |
| perspective, noisy ambience | 30 | 30 | **0** | 6 of 6 |

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
   once. **Threshold** is the one to reach for, and the strikes-per-minute
   figure tells you which way: too many strikes, raise it; missed rallies,
   lower it. (This slider was called *Sensitivity* and this instruction was
   the wrong way round, which is the worst possible combination — the value
   is a threshold, so turning it up makes the detector fussier, not keener.)
5. **Export.**

### Strikes per minute

The panel reports how many strikes it heard per minute. A real singles match
runs about **15–25**. Far above that and it's hearing the next court, the
wind, a hall's reverb or a crowd — raise Threshold. Far below and it's
missing the ball — lower it. It's the fastest way to tell whether a result is
worth reviewing at all, and it is worth doing *before* looking at the clip
list: at four times the expected rate, strikes land closer together than
`maxGap`, so every rally merges into its neighbours and you get a handful of
enormous "rallies" several minutes long instead of a cut.

### Big files

**There is no size limit any more.** A 10 GB recording is fine; so is a
40 GB one. What matters now is how *long* it runs, not how large it is.

Under about 1.2 GB the file is read whole and decoded in one go — exact, and
it takes seconds. Over that, it can't be: decoding needs the entire file
resident plus the decoded samples, and a tab does not survive it. So a big
file is **played through instead of loaded**. Nothing is ever held in memory,
nothing is uploaded, and the strike detection is the same detection — the
envelope is measured in the recording's own time, so playing it faster does
not make it coarser.

The cost is time. It runs at **4×**, so about a quarter of the length of the
recording: a 40-minute match in ten minutes, a three-hour one in forty-five.
Leave the tab in front while it goes — browsers throttle audio in background
tabs.

Why 4× and not 40×: playing faster degrades the *audio*, not the timing. Past
about 4× a 6 ms click stops resampling cleanly and the detector starts
hearing strikes nobody played — measured at 31 real strikes heard as 33 at
4×, 36–49 at 8×, and 288 at 16×. The numbers and the test that produces them
are in [Watching the picture](video-analyzer.md#big-files).

**The fast route is still the fast route.** The detector only ever listens,
so give it just the audio:

```bash
ffmpeg -i match.mov -vn -ac 1 -ar 16000 -c:a aac -b:a 48k audio.m4a
```

A few seconds, a few MB, no waiting. Drop `audio.m4a` in instead — the
timings come out identical because it shares a clock with the video, so the
cut script it produces runs against your original file unchanged. The one
thing you give up is the picture check, which needs the video.

---

## When the clip ends mid-rally

The complaint that produced this section: *it ends the clip the moment someone
returns a serve.*

Audio can do that, and no threshold fixes it. A far-side return reaches the
microphone much quieter than the serve did. A ball can be two seconds in the
air. Put those together and a rally goes quiet for longer than `maxGap`, so
the cluster closes and the clip stops in the middle of the point. **The
information needed to keep it open is not in the soundtrack at all** — the
rally is still going, and the ball is still moving.

So on a video there is a second button: **▶ look for the ball**.

It finds small fast-moving things and links them into short tracks. A player
is a blob of hundreds of pixels that moves a few pixels a frame; a ball is a
handful of pixels that moves tens. Everything of the wrong size is thrown
away before linking, and what survives has to keep travelling in a consistent
direction for three frames before it counts as anything.

**What it is not.** It does not do line calls, does not know where the ball
bounced, and cannot tell you who won a point. Those need the ball located to
within centimetres from several calibrated cameras. It answers exactly one
question — *was the ball in play during this gap?* — and answers it well.

**Why it is affordable.** A ball has to be followed frame by frame: at a
tenth of a second it has already crossed a quarter of the court and changed
direction, so this pass cannot be played fast the way the others are. That
would be ruinous over a whole match, so **it does not watch a whole match**.
It watches only the gaps between clips the audio already found, plus a second
either side, and skips any gap long enough to be obviously between rallies.
On a match with forty rallies that is a few minutes of footage rather than
forty — and it is exactly the footage the audio was unsure about.

It then does two things, and the second is the one the complaint was actually
about:

- **Stretches every clip** to where the ball really stopped. A rally whose
  *last* strikes are inaudible has no later clip to join to — it simply ends
  early and the rest of the point is thrown away. So the video just past each
  clip's end gets watched whether or not anything follows it.
- **Joins clips back up** when the ball was in play right through the gap
  between them — one rally the soundtrack lost the middle of.

Measured on a fixture built so nothing else could solve it: one rally that
goes silent in the *middle*, a second that goes silent for its last five
seconds with nothing after it, and a real thirteen-second gap where nobody is
playing.

| | |
|---|---|
| by ear alone | `2.6-10.3` `14.1-20.5` `32.6-38.8` — first rally in halves, second five seconds short |
| ball found in | `9.3-15.1` and `38.3-42` — through the silence, and past the end |
| after | `2.6-20.5` `32.6-42` — both rallies whole, the real gap untouched |
| cost | 741 frames over 25s of video, in 26s |

### What it is *not* the fix for

Before building it I checked whether the strike floor was the culprit, on a
fixture with the dynamic range real tennis has — a serve at full level, near
groundstrokes at three quarters, far-side returns at half, and the odd soft
touch at a third. It finds **all 38 of them, at every threshold setting, with
nothing in the dead time**. So quiet strikes were not being lost to the floor.
That is what `test/dynamics.test.js` is for, and it is worth keeping precisely
because it rules something out.

## Getting the video back

**`▶ render the video here`** — plays the kept clips through and records them
into one file, in the page. No terminal, nothing uploaded, and what you get
is a video you can save.

It runs at **real time**, because it is playback: twelve minutes of rallies
takes twelve minutes. Leave the tab in front while it goes, since a
backgrounded tab throttles both the video and the encoder. The output is
**WebM** (VP9 or VP8 with Opus), because that is what a browser's recorder
writes — if you need MP4, use the ffmpeg script.

Where the browser allows it the file is written straight to disk as it is
made, so length stops being a question of what fits in a tab. Otherwise it is
held in memory and handed over at the end.

Stopping it early keeps what has been rendered so far rather than throwing it
away.

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
