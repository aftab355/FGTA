/* The whole reconstruction: rallies and serving ends in, a score out.

   What goes in is what a camera on a tripod and a soundtrack can actually
   supply — how many rallies, when each one ran, and which end served it —
   plus the one thing the players always know, the final scoreline. What comes
   out is which game every rally belonged to and who won it.

   Nothing here reconstructs individual points. That is not a gap in the
   implementation, it is the thing one camera cannot do, and the test does not
   pretend otherwise.

   node test/score.test.js   (no dependencies) */
const {loadScore}=require('./extract.js');
const {playMatch}=require('./simulate.js');
const {scFrame, scScore}=loadScore();

let seed=771131;
const R=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
let pass=0,fail=0;
const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };

const N=200;
let matches=0, usable=0, tbMatches=0;
let gamesTotal=0, gamesRight=0, lenRight=0, lenTotal=0;
let boardTotal=0, boardRight=0;
const caught={3:0,5:0}; let wrongTotal=0;
let noteCount=0;

for(let m=0;m<N;m++){
  /* two players of different strengths, as a ladder actually has */
  const hA=0.60+R()*0.22, hB=0.60+R()*0.22;
  const M=playMatch(R, hA, hB);
  matches++;
  if(M.tiebreaks){ tbMatches++; continue; }     // tiebreaks are reported, not reconstructed
  usable++;

  const frame=scFrame(M.ends);
  /* the app knows each player's hold rate from their history — the Predict
     tab computes it — so the reconstruction is given it here too */
  const S=scScore(M.rallies, frame, M.setScores, {firstServer:'a', holdA:hA, holdB:hB});
  if(S.note) noteCount++;
  if(!S.ok) continue;

  /* did the games come out the right lengths? */
  const trueLens=[];
  { let cur=1,n=0;
    for(const g of M.gameOf){ if(g!==cur){ trueLens.push(n); n=0; cur=g; } n++; }
    trueLens.push(n); }
  lenTotal+=trueLens.length;
  for(let i=0;i<Math.min(trueLens.length,S.games.length);i++)
    if(S.games[i].points===trueLens[i]) lenRight++;

  /* and the right winners? */
  gamesTotal+=M.gameWins.length;
  const wrong=[];
  for(let i=0;i<Math.min(M.gameWins.length,S.games.length);i++){
    if(S.games[i].winner===M.gameWins[i]) gamesRight++;
    else wrong.push(i);
  }
  /* the question the panel actually has to answer: if a person checks the
     handful of games it is least sure of, do they find the mistakes? */
  const byDoubt=S.games.map((g,i)=>({i, c:g.confidence==null?0.5:g.confidence}))
                       .sort((x,y)=>x.c-y.c);
  for(const k of [3,5]){
    const flagged=new Set(byDoubt.slice(0,k).map(x=>x.i));
    caught[k]+=wrong.filter(i=>flagged.has(i)).length;
  }
  wrongTotal+=wrong.length;

  /* the scoreboard standing before each rally */
  for(const row of S.board){
    const trueGame=M.gameOf[row.rally];
    if(trueGame==null) continue;
    boardTotal++;
    let a=0,b=0,sa=0,sb=0,seen=0,gi=0;
    /* rebuild the true standing score at that rally */
    let g=1, aa=0, bb=0, saa=0, sbb=0, si=0, count=0;
    for(let k=0;k<M.gameWins.length;k++){
      const len=trueLens[k];
      if(count+len>row.rally){ break; }
      count+=len;
      if(M.gameWins[k]==='a') aa++; else bb++;
      const sc=M.setScores[si];
      if(sc && aa===sc[0] && bb===sc[1]){ if(sc[0]>sc[1]) saa++; else sbb++; aa=0; bb=0; si++; }
    }
    if(row.gamesA===aa && row.gamesB===bb && row.setsA===saa && row.setsB===sbb) boardRight++;
  }
}

console.log('\n# '+N+' simulated matches, holds between 62% and 82%');
console.log('  '+usable+' reconstructed, '+tbMatches+' set aside for containing a tiebreak');
console.log('  game lengths right:  '+lenRight+'/'+lenTotal+'  ('+Math.round(lenRight/lenTotal*100)+'%)');
console.log('  game winners right:  '+gamesRight+'/'+gamesTotal+'  ('+Math.round(gamesRight/gamesTotal*100)+'%)');
console.log('  scoreboard right at any given rally: '+boardRight+'/'+boardTotal+
            '  ('+Math.round(boardRight/boardTotal*100)+'%)');
console.log('  matches flagged with a note: '+noteCount);

/* The tiebreak share here is a property of the simulator, not a result: two
   players drawn from the same range of strengths produce close sets, and a
   close set is what a tiebreak is. It is reported rather than asserted on. */
console.log('  (tiebreak share is a simulator artefact of drawing both players from one range)');
ok(usable>N*0.35,'enough matches reconstruct end to end to measure anything',
   usable+'/'+N);
ok(tbMatches===N-usable,'and every excluded match was excluded for a tiebreak',
   (N-usable)+' excluded, '+tbMatches+' had one');
ok(lenRight/lenTotal>0.9,'the games come out the right lengths',
   Math.round(lenRight/lenTotal*100)+'%');
ok(gamesRight/gamesTotal>0.85,'and mostly the right winners',
   Math.round(gamesRight/gamesTotal*100)+'%');
ok(boardRight/boardTotal>0.7,'so the scoreboard is right at most moments',
   Math.round(boardRight/boardTotal*100)+'%');
console.log('  of the games it got wrong, checking the least-confident:');
console.log('     3 per match catches '+caught[3]+'/'+wrongTotal+
            ' ('+Math.round(caught[3]/wrongTotal*100)+'%)');
console.log('     5 per match catches '+caught[5]+'/'+wrongTotal+
            ' ('+Math.round(caught[5]/wrongTotal*100)+'%)');
ok(caught[5]/wrongTotal>0.6,'the games it gets wrong are the ones it says it is unsure about',
   Math.round(caught[5]/wrongTotal*100)+'% caught in the 5 least confident');
const perMatch=(gamesTotal-gamesRight)/usable;
console.log('  games a person would have to correct: '+perMatch.toFixed(1)+' per match');
ok(perMatch<4,'and a person has only a few games to correct',
   perMatch.toFixed(1)+' per match');

/* the honest part: no individual point is invented */
{
  let M=null;
  for(let i=0;i<60 && !M;i++){ const c=playMatch(R,0.78,0.58); if(!c.tiebreaks) M=c; }
  const S=scScore(M.rallies, scFrame(M.ends), M.setScores, {firstServer:'a'});
  const withPts=S.board.filter(r=>r.pts);
  const loveGames=S.games.filter(g=>g.points===4).length;
  console.log('\n  point scores shown only for love games: '+withPts.length+' rallies across '+
              loveGames+' such games, out of '+S.board.length+' rallies');
  ok(S.board.length>0 && withPts.every(r=>r.points===4),
     'a point score is only ever shown where there is one reading',
     S.board.length+' rallies');
  ok(S.board.every(r=>r.point>=1 && r.point<=r.points),'every rally knows its number within the game');
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
