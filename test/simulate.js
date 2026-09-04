/* A tennis match under the rules the shipped tracker scores by, used by the
   scoring tests. It is a second copy of those rules, so serve.test.js drives
   the REAL ptPoint/ptCloseGame and pins the two facts everything here leans
   on: the server alternates every game, and the serving end holds for two. */
/* ---- a match, under the rules the tracker scores by ---- */
function playMatch(R, holdA, holdB){
  /* Two hold rates, not one. With the same rate on both sides a set is a
     symmetric random walk and 6-6 becomes the single likeliest finish — the
     first version of this produced a tiebreak in 70% of matches, which is not
     tennis, it is an artefact of making both players identical. */
  if(holdB==null) holdB=holdA;
  let server='a', endA='near';
  let setsA=0,setsB=0, gamesA=0,gamesB=0, ptsA=0,ptsB=0;
  const setScores=[]; const gameWins=[];
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
    gameWins.push(win);
    if(done){ if(win==='a') setsA++; else setsB++; setScores.push([gamesA,gamesB]); gamesA=gamesB=0; }
    game++;
  };

  while(setsA<2 && setsB<2 && guard++<4000){
    ends.push(serveEnd()==='near'?1:-1);
    gameOf.push(game);
    const sv=serverNow();
    const winner = (R()<(sv==='a'?holdA:holdB)) ? sv : (sv==='a'?'b':'a');
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
  /* Rally timings, because where the games are is partly a question of when
     people took longer. Real tennis: about twenty seconds between points,
     noticeably more between games while balls are collected, and a minute and
     a half at a changeover. The reconstruction leans on that ordering, not on
     the exact numbers. */
  const rallies=[]; let clock=12;
  for(let i=0;i<gameOf.length;i++){
    const dur=4+R()*8;
    rallies.push({start:Math.round(clock*10)/10, end:Math.round((clock+dur)*10)/10});
    clock+=dur;
    const boundary=(i+1<gameOf.length) && gameOf[i+1]!==gameOf[i];
    if(!boundary) clock += 16+R()*8;
    else {
      const gameNo=gameOf[i];
      clock += (gameNo%2===1) ? 62+R()*28 : 24+R()*10;   // changeover after odd games
    }
  }
  return {ends, bounds, rallies, gameOf, gameWins, points:ends.length,
          games:gameOf[gameOf.length-1], tiebreaks, setScores};
}


module.exports={playMatch};
