/* Given only which END each serve came from — the one thing a camera on a
   tripod can reliably see — how much of the match's structure comes back?

   The matches are simulated here rather than played through the page, because
   the page deep-clones the whole match for undo on every point and a few
   thousand points of that takes minutes. The rules the simulator encodes are
   pinned against the shipped tracker by serve.test.js, which drives the real
   ptPoint/ptCloseGame and asserts the same two facts this leans on: the
   server alternates every game, and the serving end holds for two.

   node test/score-frame.test.js   (no dependencies) */
const {loadScore}=require('./extract.js');
const {scFrame}=loadScore();

const {playMatch}=require('./simulate.js');

let seed=20260904;
const R=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);

let pass=0,fail=0;
const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };

const N=200;
let runs=0,certain=0,ambiguous=0,illegal=0;
let hit=0,total=0,wrong=0, edgeHit=0,edgeTotal=0;
let tbMatches=0, tbFound=0, cleanMatches=0, cleanLegal=0, points=0, games=0, flagged=0;

for(let m=0;m<N;m++){
  const M=playMatch(R, 0.62+R()*0.2);
  points+=M.points; games+=M.games;
  const f=scFrame(M.ends);
  runs+=f.runs.length; certain+=f.certain; ambiguous+=f.ambiguous; illegal+=f.illegal; flagged+=f.flagged;

  const truth=new Set(M.bounds);
  /* only boundaries the frame actually stands behind: the edge before a run
     it could read, and the split inside a run that read exactly one way.
     Nothing is claimed at the edges of a tiebreak or of the run beside one. */
  const claimed=new Set();
  f.runs.forEach((r,i)=>{
    const prev=f.runs[i-1];
    const solid = r.state==='certain'||r.state==='ambiguous'||r.state==='partial';
    const prevSolid = !prev || prev.state==='certain'||prev.state==='ambiguous'||prev.state==='partial';
    if(r.from>0 && solid && prevSolid) claimed.add(r.from);
    if(r.state==='certain' && r.games) claimed.add(r.from+r.games[0]);
  });
  for(const b of claimed) (truth.has(b)?hit++:wrong++);
  total+=truth.size;
  for(const b of claimed){ edgeTotal++; if(truth.has(b)) edgeHit++; }

  if(M.tiebreaks){ tbMatches++; if(f.tiebreaks>=M.tiebreaks) tbFound++; }
  else { cleanMatches++; if(f.illegal===0) cleanLegal++; }
}

console.log('\n# '+N+' simulated matches, holds between 62% and 82%');
console.log('  '+points+' points, '+games+' games, '+tbMatches+' matches with a tiebreak');
console.log('  runs of one end: '+runs+' — '+certain+' read exactly one way, '+
            ambiguous+' with 2-3 candidates, '+illegal+' impossible');
console.log('  game boundaries: '+hit+' of '+total+' located ('+
            Math.round(hit/total*100)+'%), '+wrong+' claimed that were not real');
console.log('  every boundary it stands behind: '+edgeHit+'/'+edgeTotal+' real');
console.log('  runs set aside as tiebreak or beside one: '+flagged+
            '   tiebreaks spotted in '+tbFound+'/'+tbMatches+' matches that had one');
console.log('  tiebreak-free matches reading legally end to end: '+cleanLegal+'/'+cleanMatches);

ok(edgeHit===edgeTotal,'every boundary it stands behind is a real one', edgeHit+'/'+edgeTotal);
ok(tbFound===tbMatches,'every match with a tiebreak has it spotted', tbFound+'/'+tbMatches);
ok(wrong===0,'nothing is claimed that is not true', wrong+' wrong claims');
ok(hit/total>0.4,'a good share of the game boundaries come back from the ends alone',
   Math.round(hit/total*100)+'%');
ok(cleanLegal===cleanMatches,'every tiebreak-free match reads legally end to end',
   cleanLegal+'/'+cleanMatches);
ok(illegal===0,'nothing is left as unexplained-impossible once tiebreaks are taken out',
   illegal+' impossible runs');

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
