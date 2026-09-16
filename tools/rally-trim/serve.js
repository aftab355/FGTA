/* Where the point actually started.

   This is the whole point of the tool. `rrSegments` (index.html) has no
   measurement of it at all:

     const serve = prev - tune.lag + tune.dead;

   — the previous point's ending plus a fixed 12 seconds. On the supplied cut
   list that arithmetic sets the start of 113 of 154 clips, each landing
   exactly 8.00s after the previous clip ended, and leaves a mean clip of 16.0s
   against a club singles rally of about 5-8s of ball in play. The dead time it
   keeps is the dead time it assumed, not the dead time that happened.

   So: measure it. Work BACKWARD from the point ending, which is the one thing
   the taps know exactly.

     1. group the strikes inside this point's window by `maxGap`
     2. take the group the rally ended on
     3. keep absorbing earlier groups while the gap is under `faultGap`
     4. the serve is the first HARD strike in what is left

   Step 3 is what keeps faults, lets and second serves: a fault and its second
   serve are five to twelve seconds apart, ordinary dead time is longer, and
   the window cannot reach back past the previous point in any case.

   Step 4 is what stops the clip opening on a ball bounce. Bounces are real
   transients and the detector is right to find them, but a bounce is never as
   hard as a serve — the same reasoning acCluster uses, applied to picking the
   first strike rather than to keeping the run.

   Working backward rather than forward matters when the court next door is
   busy: a neighbour's rally earlier in the gap cannot pull the start with it
   unless it is close enough to look like a fault, and the motion gate is what
   answers that case. */
'use strict';

const DEF = {
  faultGap: 14,      // an earlier strike group this close is a fault or a let
  grace: 0.25,       // a strike may land just past the computed point ending
  guard: 0.30,       // keep clear of the previous point's ending
  maxClip: 45,       // safety rail. NOT the reel's 30s cap: starts are measured
                     // now, so capping at 30 would re-introduce the truncation
                     // this tool exists to remove.
  minLead: 0.0
};

function groupBy(strikes, maxGap) {
  const groups = [];
  let cur = [];
  for (const h of strikes) {
    if (!cur.length || h.t - cur[cur.length - 1].t <= maxGap) cur.push(h);
    else { groups.push(cur); cur = [h]; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function peakOf(g) { return g.reduce((m, h) => Math.max(m, h.lvl), 0); }

/* The same test acCluster applies, so a group this tool is willing to treat as
   a serve attempt is a group the app would have called a rally. */
function looksPlayed(g, ac) {
  const peak = peakOf(g);
  if (g.length === 1) return peak >= ac.aceFrac;
  return g.length >= ac.minHits && peak >= ac.hardFrac;
}

function sliceStrikes(hits, t0, t1) {
  const out = [];
  for (const h of hits) {
    if (h.t < t0) continue;
    if (h.t > t1) break;
    out.push(h);
  }
  return out;
}

/* opt.gate, when present, is (t0,t1) -> {ratio, ok} from motion.js: was
   anything moving on YOUR court while those strikes were heard? */
function findServes(aligned, hits, tune, ac, options) {
  const opt = Object.assign({}, DEF, options || {});
  const pts = aligned.points;
  const out = [];
  let prevEnd = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const winStart = Math.max(0, (i > 0 ? pts[i - 1].videoEnd : 0) + opt.guard);
    const winEnd = p.videoEnd;
    const rec = {
      n: p.n, label: p.label, meta: p.meta,
      matchEnd: p.matchEnd, videoEnd: winEnd,
      aligned: p.aligned, residual: p.residual,
      reelStart: p.reelStart, reelDur: p.reelDur,
      measured: false, via: null, serve: null, strikes: 0, faults: 0,
      courtRatio: null, note: ''
    };

    if (winEnd <= winStart) {
      rec.note = 'window collapsed — previous point ends after this one';
    } else {
      const inWin = sliceStrikes(hits, winStart, winEnd + opt.grace);
      const groups = groupBy(inWin, ac.maxGap);
      if (!groups.length) {
        rec.note = 'no strikes heard in this point\'s window';
      } else {
        /* The rally is the last group; absorb earlier ones that are close
           enough to be a fault, subject to the picture agreeing. */
        let keep = [groups[groups.length - 1]];
        for (let g = groups.length - 2; g >= 0; g--) {
          const prev = groups[g];
          const gap = keep[0][0].t - prev[prev.length - 1].t;
          if (gap > opt.faultGap) break;
          if (!looksPlayed(prev, ac)) continue;        // bounces, not a serve
          if (opt.gate) {
            const m = opt.gate(prev[0].t, prev[prev.length - 1].t + 0.5);
            if (m && !m.ok) { rec.note = 'earlier strikes ignored — nothing moving on court'; continue; }
          }
          keep.unshift(prev);
          rec.faults++;
        }
        const flat = [].concat.apply([], keep);
        if (!looksPlayed(flat, ac)) {
          rec.note = 'strikes present but too soft or too few to be a rally';
        } else {
          /* First HARD strike: the first real serve attempt, not the bounces
             that preceded it. */
          let serve = flat[0].t;
          for (const h of flat) { if (h.lvl >= ac.hardFrac) { serve = h.t; break; } }
          if (opt.gate) {
            const m = opt.gate(serve, Math.min(winEnd, serve + 2.0));
            rec.courtRatio = m ? m.ratio : null;
          }
          rec.measured = true;
          rec.via = 'audio';
          rec.serve = serve;
          rec.strikes = flat.length;
        }
      }
    }

    /* Nobody heard this point. Before falling back to arithmetic, ask the
       picture when both ends of the court got busy — a weaker signal than a
       struck ball, but a measurement rather than a constant, and labelled as
       the weaker one so it can be checked. */
    if (!rec.measured && opt.rise && winEnd > winStart) {
      const r = opt.rise(winStart, winEnd);
      if (r && r.t < winEnd - 0.5) {
        rec.measured = true; rec.via = 'motion'; rec.serve = r.t; rec.riseConf = r.conf;
        rec.note = 'heard nothing — start taken from when both ends of the court got busy';
      }
    }

    /* Only now fall back to the reel's own arithmetic, and say so. A guessed
       start that is not labelled a guess is the thing to avoid. */
    let start, cap;
    if (rec.measured) {
      start = rec.serve - tune.lead;
      cap = opt.maxClip;
    } else {
      start = (i > 0 ? pts[i - 1].videoEnd : 0) + tune.dead - tune.lead;
      rec.via = 'assumed';
      rec.note = 'assumed dead time' + (rec.note ? ' — ' + rec.note : '');
      /* The generous rail exists to stop a MEASURED long rally being
         truncated. There is no measurement here, so the reel's own cap is the
         right conservative choice — otherwise a guess after a long break comes
         back as 45 seconds of walking about. */
      cap = Math.min(opt.maxClip, tune.max);
    }

    let end = winEnd + tune.tail;
    if (start < prevEnd) start = prevEnd;             // never overlap the last clip
    if (end - start > cap) start = end - cap;
    if (end - start < tune.min) start = Math.max(prevEnd, end - tune.min);
    if (start < 0) start = 0;

    rec.start = start;
    rec.end = end;
    rec.dur = end - start;
    rec.saved = rec.reelDur != null ? rec.reelDur - rec.dur : null;
    /* A clip can collapse to nothing when two points are badly enough
       misaligned that this one ends before the last one's clip did. It must
       not go into the cut, but it must still appear in the report — a rally
       that quietly vanishes is worse than one that is marked unusable. */
    if (rec.dur > 0) prevEnd = end;
    else { rec.dropped = true; rec.note = 'dropped: ' + (rec.note || 'ends before the previous clip does'); }
    out.push(rec);
  }
  return out;
}

module.exports = { findServes, groupBy, looksPlayed, peakOf, sliceStrikes, DEF };
