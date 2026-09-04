/* Serve rotation, played through the shipped point tracker rather than a copy
   of its rules. Drives ptStart/ptPoint in the real page and checks what came
   out against the rules of tennis — including the tiebreak, which is the only
   place the rotation is not simply "the player whose turn it is".

   node test/serve.test.js   (needs playwright + chromium) */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

(async()=>{
  const server=http.createServer((rq,rs)=>{
    const f=path.join(APP, decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html');
    if(!f.startsWith(APP)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
    rs.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  page.on('pageerror',e=>{ if(!/supabase/.test(e.message)) console.log('  [pageerror] '+e.message); });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);

  const out=await page.evaluate(()=>{
    try{ localStorage.removeItem('fgta_tracker_draft'); }catch(e){}
    document.getElementById('ptA').value='Ada';
    document.getElementById('ptB').value='Bo';
    document.getElementById('ptServe').value='a';
    ptStart();

    const seen=[];
    const play=(side)=>{
      seen.push({server:ptServerNow(), court:ptServeCourt(),
                 gA:PT.gamesA, gB:PT.gamesB, tb:!!PT.tiebreak,
                 tbA:PT.tbA, tbB:PT.tbB, sets:PT.sets.length});
      ptPoint(side);
    };
    // twelve games, alternating winners, four points each -> 6-6 -> tiebreak
    for(let g=0; g<12; g++){ const w=g%2===0?'a':'b'; for(let p=0;p<4;p++) play(w); }
    const tbFirstServer=ptServerNow();
    // tiebreak to 7-0
    for(let p=0;p<7;p++) play('a');
    const afterTb={server:ptServerNow(), sets:PT.sets.length,
                   setScore:PT.sets.length?PT.sets[0]:null};
    // a few points into the next set
    for(let p=0;p<4;p++) play('b');

    // undo/redo has to carry the server, since it lives on PT
    const before=ptServerNow();
    ptUndo(); const mid=ptServerNow(); ptRedo(); const after=ptServerNow();

    return {seen, tbFirstServer, afterTb, undo:{before,mid,after},
            rallies:PT.rallies.map(r=>({sv:r.sv, ct:r.ct, g:r.g, tb:r.tb||0})),
            hasDot: /pt-serve/.test(document.getElementById('ptLive').innerHTML),
            payload: (typeof ptSyncPayload==='function') ? ptSyncPayload() : null};
  });
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# serve rotation, through the shipped tracker');

  const games=out.seen.filter(s=>!s.tb);
  // 1. one server per game, alternating
  const perGame=[];
  let cur=null;
  for(const s of out.seen){
    const key=s.sets+'/'+s.gA+'-'+s.gB+'/'+(s.tb?'tb':'g');
    if(!cur||cur.key!==key){ cur={key, servers:new Set(), courts:[], first:s.server, tb:s.tb}; perGame.push(cur); }
    cur.servers.add(s.server); cur.courts.push(s.court);
  }
  const plain=perGame.filter(g=>!g.tb);
  ok(plain.every(g=>g.servers.size===1),'one server for the whole of each game',
     plain.map(g=>g.servers.size).join(','));

  /* Alternation is over every game INCLUDING the tiebreak, which occupies a
     rotation slot of its own. Checking only the plain games and demanding
     they alternate is wrong, and it is wrong in a way that looks like a bug:
     the games either side of a tiebreak ARE served by the same player, and
     that is the rule, not a fault. */
  const seq=perGame.map(g=>g.first);
  ok(seq.every((s,i)=>i===0||s!==seq[i-1]),
     'the server alternates every game, counting the tiebreak as one',seq.join(''));
  ok(seq[0]==='a','the player picked at setup serves the first game',seq[0]);

  const tbAt=perGame.findIndex(g=>g.tb);
  ok(tbAt>0 && tbAt<perGame.length-1 &&
     perGame[tbAt-1].first===perGame[tbAt+1].first,
     'a tiebreak takes a rotation slot, so the games either side share a server',
     tbAt>0?perGame[tbAt-1].first+'/'+perGame[tbAt+1].first:'no tiebreak in the middle');

  // 2. deuce/ad alternates every point, starting deuce
  ok(perGame.every(g=>g.courts.every((c,i)=>c===(i%2===0?'deuce':'ad'))),
     'the serve court alternates every point, starting in the deuce court');

  // 3. the tiebreak: one point, then two at a time
  const tb=out.seen.filter(s=>s.tb);
  const want=tb.map((s,i)=>{
    const flipped=Math.floor((i+1)/2)%2===1;
    return flipped ? (out.tbFirstServer==='a'?'b':'a') : out.tbFirstServer;
  });
  ok(tb.length>0,'a tiebreak actually happened','points='+tb.length);
  ok(tb.every((s,i)=>s.server===want[i]),'the tiebreak serves one point, then two at a time',
     'got '+tb.map(s=>s.server).join('')+' want '+want.join(''));

  // 4. the next set starts with the tiebreak's first RECEIVER
  ok(out.afterTb.server===(out.tbFirstServer==='a'?'b':'a'),
     "the tiebreak's first receiver serves the next set",
     'tb first='+out.tbFirstServer+' next='+out.afterTb.server);
  ok(out.afterTb.sets===1 && out.afterTb.setScore && out.afterTb.setScore.a===7,
     'the set closed 7-6', JSON.stringify(out.afterTb.setScore));

  // 5. every point carries it
  ok(out.rallies.length>0 && out.rallies.every(r=>(r.sv==='a'||r.sv==='b') && (r.ct==='deuce'||r.ct==='ad')),
     'every logged point records who served and from which court',
     out.rallies.length+' points');

  // 6. undo/redo carries the server, because it lives on PT
  ok(out.undo.before===out.undo.after,'undo then redo leaves the server where it was',
     JSON.stringify(out.undo));

  // 7. it reaches the things that draw a scoreboard
  ok(out.hasDot,'the scorecard draws a serving dot');
  ok(out.payload && (out.payload.server==='a'||out.payload.server==='b'),
     'the broadcast payload carries a resolved server',
     out.payload?String(out.payload.server):'no payload');
  ok(out.payload && (out.payload.serveCourt==='deuce'||out.payload.serveCourt==='ad'),
     'and the serve court');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
