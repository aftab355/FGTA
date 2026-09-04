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

/* ---- a match, under the rules the tracker scores by ---- */
function playMatch(R, hold){
  let server='a', endA='near';
  let setsA=0,setsB=0, gamesA=0,gamesB=0, ptsA=0,ptsB=0;
  let tb=false, tbA=0, tbB=0;
  const ends=[], gameOf=[];
  let game=1, guard=0, tiebreaks=0;

  const serverNow=()=>{
    if(!tb) return server;
    const p=tbA+tbB;
    return (Math.floor((p+1)/2)%2===1) ? (server==='a'?'b':'a') : server;
  };
  const serveEnd=()=>{
    const sv=serverNow();
    /* inside a tiebreak the ends change every six points, which is exactly
       why a tiebreak breaks the two-game pattern */
    const flip = tb && (Math.floor((tbA+tbB)/6)%2===1);
    const a = flip ? (endA==='near'?'far':'near') : endA;
    return sv==='a' ? a : (a==='near'?'far':'near');
  };
  const closeGame=(win,wasTb)=>{
    if(wasTb){ if(win==='a') gamesA=7; else gamesB=7; tiebreaks++; }
    else { if(win==='a') gamesA++; else gamesB++; }
    ptsA=ptsB=tbA=tbB=0; tb=false;
    server = server==='a'?'b':'a';
    if(((gamesA+gamesB)%2)===1) endA = endA==='near'?'far':'near';
    if(gamesA===6 && gamesB===6 && !wasTb){ tb=true; game++; return; }
    const done = wasTb || ((gamesA>=6||gamesB>=6) && Math.abs(gamesA-gamesB)>=2);
    if(done){ if(win==='a') setsA++; else setsB++; gamesA=gamesB=0; }
    game++;
  };

  while(setsA<2 && setsB<2 && guard++<4000){
    ends.push(serveEnd()==='near'?1:-1);
    gameOf.push(game);
    const sv=serverNow();
    const winner = (R()<hold) ? sv : (sv==='a'?'b':'a');
    if(tb){
      if(winner==='a') tbA++; else tbB++;
      if((tbA>=7||tbB>=7) && Math.abs(tbA-tbB)>=2) closeGame(tbA>tbB?'a':'b', true);
    } else {
      if(winner==='a') ptsA++; else ptsB++;
      if((ptsA>=4||ptsB>=4) && Math.abs(ptsA-ptsB)>=2) closeGame(ptsA>ptsB?'a':'b', false);
    }
  }
  const bounds=[];
  for(let i=1;i<gameOf.length;i++) if(gameOf[i]!==gameOf[i-1]) bounds.push(i);
  return {ends, bounds, points:ends.length, games:gameOf[gameOf.length-1], tiebreaks};
}

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
