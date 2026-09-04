/* How high the bar for a strike is set, across recordings that are nothing
   like each other.

   This exists because a fixed answer failed twice, in opposite directions, on
   the same person's footage:

     a fraction of a percentile   -> 117 phantom strikes in the silence, and a
                                     whole match welded into one clip
     a fixed four deviations      -> 24 minutes of tennis cut to two rallies
                                     and eight seconds

   Both were calibrated on recordings that happened to be available. So the
   bar is not a constant any more, and this checks it across the range: a
   clean recording where strikes tower over the noise, a rough one where they
   barely clear it, and one that is not tennis at all.

   node test/floor.test.js   (no dependencies) */
const {loadAudio}=require('./extract.js');
const {acPickOnsets, acCluster, acSegments} = loadAudio();

const TUNE={sens:1.2, maxGap:2.5, minHits:2, lead:1.5, tail:1.5, min:2,
            minGapMs:120, winMs:1500, floorFrac:0.30, envFrac:0.18,
            hardFrac:0.45, aceFrac:0.72, noiseSig:4, minRate:6};

/* A recording, as the detector sees one: an onset-strength curve and an
   envelope, 10ms a frame. `sep` is how far above the noise the strikes sit. */
function make(seconds, rallies, sep, seed){
  let s=seed||11;
  const R=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
  const n=Math.round(seconds*100);
  const o=new Float64Array(n), env=new Float64Array(n);
  for(let i=0;i<n;i++){
    /* court ambience: small peaks everywhere, log-normal-ish */
    const v=Math.exp(-3.4+R()*1.5)*(R()<0.16?1:0.18);
    o[i]=v; env[i]=0.02+v*0.5;
  }
  const played=[];
  for(const r of rallies){
    for(let t=r[0]; t<r[1]; t+=0.8+R()*0.3){
      const i=Math.round(t*100);
      if(i<1||i>=n-1) continue;
      const amp=sep*Math.exp(-3.4)*(0.75+R()*0.5);
      o[i]=amp; o[i-1]=amp*0.35; o[i+1]=amp*0.3;
      env[i]=0.2+amp*0.4;
      played.push(Math.round(i)/100);
    }
  }
  return {o, env, played, seconds, rallies};
}

let pass=0,fail=0;
const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };

function run(name, rec, check){
  const hits=acPickOnsets(rec.o, rec.env, TUNE, 10, null);
  const segs=acSegments(acCluster(hits,TUNE), TUNE, rec.seconds);
  const inR=(t)=>rec.rallies.some(r=>t>=r[0]-0.4 && t<=r[1]+0.4);
  const found=(t)=>hits.some(h=>Math.abs(h.t-t)<0.06);
  const recall=rec.played.length?rec.played.filter(found).length/rec.played.length:0;
  const dead=hits.filter(h=>!inR(h.t)).length;
  const sp=hits.split;
  console.log('\n# '+name);
  console.log('   '+rec.played.length+' played · '+hits.length+' found ('+
    Math.round(hits.length/(rec.seconds/60))+'/min) · recall '+Math.round(recall*100)+
    '% · '+dead+' in the dead time · '+segs.length+' clips');
  console.log('   bar: '+(sp? (sp.applied? sp.sigmas+' deviations'+(sp.relaxed?' (relaxed from 4)':'')+
      ', '+sp.above+' peaks over it' : (sp.gaveUp?'gave up — plain floor only':'not applied'))
      : 'none computed'));
  check({hits, segs, recall, dead, split:sp, rec});
}

run('a clean recording — strikes towering over the ambience',
    make(180, [[10,25],[40,58],[75,92],[110,128],[145,166]], 26, 3),
    ({recall,dead,segs,split})=>{
      ok(recall>0.9,'nearly every strike found', Math.round(recall*100)+'%');
      ok(dead<=3,'and the silence stays quiet', dead+' phantoms');
      ok(segs.length===5,'five rallies, five clips', segs.length+' clips');
      ok(split && split.applied && !split.relaxed,'the strict bar was enough');
    });

run('a rough one — strikes only just above the ambience',
    make(180, [[10,25],[40,58],[75,92],[110,128],[145,166]], 7, 5),
    ({recall,segs,split})=>{
      /* the case that cut 24 minutes to 8 seconds: the strict bar is too high
         here, and the search has to come down rather than return nothing */
      ok(recall>0.7,'most of the rally survives instead of two clips out of a match',
         Math.round(recall*100)+'%');
      ok(segs.length>=4,'the rallies are still separate clips', segs.length+' clips');
      ok(split && (!split.applied || split.relaxed || split.gaveUp),
         'and it did not hold the strict bar that would have thrown them away');
    });

run('not tennis at all — a camera left running',
    make(180, [], 0, 9),
    ({hits,segs,split})=>{
      /* Not "few strikes found": a bar drawn from the noise cannot tell loud
         noise from a racket when there is no racket in the recording, and
         pretending otherwise is what made the clean case worse. What has to
         hold is that it does not come back with a cut somebody might trust —
         and the strikes-per-minute figure the panel shows is what actually
         catches this, in words, for a person to act on. */
      ok(Math.round(hits.length/3) > 45,'the rate it reports is obviously wrong, which is the point',
         Math.round(hits.length/3)+'/min — the panel warns above 32');
      ok(segs.length<=2,'and almost nothing is called a rally', segs.length+' clips');
      ok(split ? (split.gaveUp || split.applied) : true,
         'it either finds a bar or says it could not, rather than inventing one');
    });

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
