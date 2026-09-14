/* Does "⬇ Export scoreboard video" survive a whole match?

   scoreboard.test.js covers the auto-cut render's own bug. This one is the
   export in docs/scoreboard-export.md: the button that replays a finished
   match onto a canvas and hands back a file you drop on a timeline. The
   things that only go wrong at full length are the things checked here —
   how long a 90-minute match takes to render, how big the file is, whether
   it can be scrubbed, whether the right score is on screen at the right
   moment, and whether the tracker you were using survives it.

   Needs playwright + chromium (no fixture):
     node test/scoreboard-export.test.js  [match minutes, default 90]  */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const MINUTES=+(process.argv[2]||90);

(async()=>{
  const server=http.createServer((rq,rs)=>{
    const rel=decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
    const f=path.join(APP,rel);
    if(!f.startsWith(APP)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
    rs.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage',
    '--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage();
  page.on('pageerror',e=>{ if(!/supabase/.test(e.message)) console.log('  [pageerror] '+e.message); });
  /* Supabase is the only thing on the page that wants the network; stub it
     rather than wait out five connection timeouts per run. */
  await page.route('**/cdn.jsdelivr.net/**', r=>r.fulfill({status:200,contentType:'text/javascript',body:'/*stub*/'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);

  const out=await page.evaluate(async(MIN)=>{
    /* PT, matches and friends are top-level `let`s in index.html's own
       script, which is a different scope from this one — indirect eval runs
       in theirs, so the test drives the real state rather than a copy. */
    const G=window.eval, PTof=()=>G("PT");

    /* ---- a whole match, played through the real tracker ---------------- */
    G("PT=ptDefaultState('Ada Lovelace','Bo Diddley'); ptHistory=[]; ptFuture=[];");
    const t0=PTof().startedAt;
    let clock=0, guard=0;
    const gap=Math.round(MIN*60000/170);          // ~170 points in the target span
    while(!PTof().winner && !PTof().draw && guard++<900){
      clock+=gap;
      const real=Date.now; Date.now=()=>t0+clock;     // stamp rallies at match pace
      try{ window.ptPoint(Math.random()<0.53?'a':'b', Math.random()<0.07); }
      finally{ Date.now=real; }
    }
    const played=PTof();
    const data={v:1,a:played.a,b:played.b,startedAt:played.startedAt,endedAt:t0+clock,
                video:null,points:played.rallies};
    G("matches=[]"); G("matches").push({id:4242,a:data.a,b:data.b,rallies:JSON.stringify(data)});

    /* ---- something else in the tracker, to prove the export gives it back */
    G("PT=ptDefaultState('Cy','Dee'); ptHistory=[]; ptFuture=[];");
    window.ptPoint('a',false); window.ptPoint('b',false); window.ptPoint('a',false);
    const before={a:PTof().a, b:PTof().b, ptsA:PTof().ptsA, ptsB:PTof().ptsB,
                  history:G("ptHistory").length,
                  draft:(()=>{try{return localStorage.getItem('fgta_tracker_draft')||''}catch(e){return ''}})()};

    /* ---- nothing that belongs to a live point may fire during a replay -- */
    let spoke=0, buzzed=0;
    try{ if(window.speechSynthesis) window.speechSynthesis.speak=()=>{spoke++;}; }catch(e){}
    try{ navigator.vibrate=()=>{buzzed++; return true;}; }catch(e){}
    let asked=0; window.confirm=()=>{ asked++; return true; };
    /* set/8-8 celebrations are full-screen overlays; a replay closing three
       sets in a second must not throw them over the page */
    let celebrations=0;
    new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{
      if(n.nodeType===1 && n.classList && n.classList.contains('fgta-cel')) celebrations++;
    }))).observe(document.body,{childList:true,subtree:true});

    /* ---- the export --------------------------------------------------- */
    const pick=await sbxPickEncoder();
    const w0=performance.now();
    let peak=0;
    const p=window.ptExportScoreboardVideo(4242);
    while(performance.now()-w0 < 900000){
      if(performance.memory) peak=Math.max(peak, performance.memory.usedJSHeapSize);
      const el=document.getElementById('sbxPanel');
      if(el && /Scoreboard ready|export failed/.test(el.textContent)) break;
      await new Promise(r=>setTimeout(r,200));
    }
    await p.catch(()=>{});
    const wall=(performance.now()-w0)/1000;
    const panel=document.getElementById('sbxPanel');
    const link=panel && panel.querySelector('a[download]');
    if(!link) return {err:'no file after '+wall.toFixed(0)+'s: '+(panel?panel.textContent.slice(0,160):'no panel')};
    const stats=G("SBX_LAST");

    const after={a:PTof()&&PTof().a, b:PTof()&&PTof().b, ptsA:PTof()&&PTof().ptsA, ptsB:PTof()&&PTof().ptsB,
                 history:G("ptHistory").length, running:!!G("SBX"),
                 draft:(()=>{try{return localStorage.getItem('fgta_tracker_draft')||''}catch(e){return ''}})()};

    /* ---- read the file back the way an editor would --------------------- */
    const v=document.createElement('video');
    v.src=link.href; v.muted=true; v.preload='auto';
    document.body.appendChild(v);
    await new Promise(res=>{ v.addEventListener('loadedmetadata',res,{once:true}); setTimeout(res,20000); });
    const seekTo=async(t)=>{
      const s=performance.now();
      await new Promise(res=>{ const f=()=>{v.removeEventListener('seeked',f);res();};
        v.addEventListener('seeked',f); setTimeout(res,20000); try{ v.currentTime=t; }catch(e){ res(); } });
      return performance.now()-s;
    };
    const plate=(cv)=>{  // the scoreboard's own corner, where every number is
      const y0=1080-64-136;
      return cv.getContext('2d').getImageData(64, y0-46, 620, 182+46).data;
    };
    const grab=async(t)=>{
      const took=await seekTo(t);
      const c=document.createElement('canvas'); c.width=1920; c.height=1080;
      c.getContext('2d').drawImage(v,0,0,1920,1080);
      return {took, px:plate(c)};
    };
    /* the same instant, drawn straight from the match's own state: what the
       frame at that timestamp is supposed to look like */
    const expected=(tSec)=>{
      G("PT=ptDefaultState('"+data.a.replace(/'/g,"")+"','"+data.b.replace(/'/g,"")+"'); PT_SIM=true; ptHistory=[]; ptFuture=[];");
      const p0=data.points[0];
      if(p0&&p0.sv) G("PT.server='"+p0.sv+"'");
      for(const pt of data.points){ if(pt.t>tSec*1000) break; window.ptPoint(pt.w, pt.ace===1); }
      const c=document.createElement('canvas'); c.width=1920; c.height=1080;
      sbxDrawFrame(c.getContext('2d'), G("sbxSnap()"));
      G("PT_SIM=false");
      return plate(c);
    };
    const diff=(x,y)=>{ let s=0; for(let i=0;i<x.length;i+=4) s+=Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]);
                        return +(s/(x.length/4)/3).toFixed(1); };
    const dur=v.duration;
    const at=[0.2, 0.5, 0.85].map(f=>Math.round(dur*f));
    const shots=[]; for(const t of at) shots.push(await grab(t));
    const fits=at.map((t,i)=>diff(shots[i].px, expected(t)));
    const drift=[diff(shots[0].px, shots[1].px), diff(shots[1].px, shots[2].px)];
    v.remove();

    return {wall:+wall.toFixed(1), matchMin:+(clock/60000).toFixed(1), points:data.points.length,
            pick, stats, dur:+dur.toFixed(2), vw:v.videoWidth, vh:v.videoHeight,
            bytes:stats&&stats.bytes, peakMB:+(peak/1048576).toFixed(0),
            seeks:shots.map(s=>Math.round(s.took)), fits, drift,
            before, after, spoke, buzzed, asked, celebrations};
  }, MINUTES);

  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# exporting a whole match');
  if(out.err){ console.log('  ERROR '+out.err); process.exit(1); }
  const s=out.stats||{};
  console.log('  '+out.points+' points over '+out.matchMin+' min → '+s.path+' path, '+(s.codec||'?')+
              ', '+(out.bytes/1048576).toFixed(1)+' MB in '+out.wall+'s (peak heap '+out.peakMB+' MB)');
  console.log('  file: '+out.dur+'s, '+out.vw+'x'+out.vh+', '+s.frames+' frames, '+s.keyFrames+' keyframes');
  console.log('  seeks: '+out.seeks.join('ms, ')+'ms · drawn-vs-expected: '+out.fits.join(', '));

  ok(s.path==='fast', 'took the fast path, not real time', s.path);
  ok(out.wall < out.matchMin*60*0.25, 'rendered in well under the time the match took',
     out.wall+'s for '+out.matchMin+' min of tennis');
  ok(Math.abs(out.dur - out.matchMin*60) < 8,
     'the video runs as long as the match did, so it lines up with the footage',
     out.dur+'s vs '+(out.matchMin*60).toFixed(0)+'s');
  ok(out.vw===1920 && out.vh===1080, 'at 1080p', out.vw+'x'+out.vh);
  ok(s.keyFrames >= Math.floor(s.frames/(4*2)) - 1,
     'with a keyframe every couple of seconds, so an editor can scrub it',
     s.keyFrames+' keyframes in '+s.frames+' frames');
  ok(out.seeks.every(t=>t<4000), 'and seeking into it is quick', out.seeks.join('/')+'ms');
  ok(out.bytes < 400*1048576, 'the file is a sane size for a full match',
     (out.bytes/1048576).toFixed(0)+' MB');
  ok(out.peakMB < 900, 'and rendering it does not eat the tab', out.peakMB+' MB peak heap');

  console.log('\n# the right score, at the right moment');
  ok(out.fits.every(d=>d<12), 'every sampled frame matches the scoreboard that instant of the match should show',
     'mean channel error '+out.fits.join('/'));
  ok(out.drift.some(d=>d>1), 'and the board is not simply frozen', out.drift.join('/'));

  console.log('\n# and the tracker is where you left it');
  ok(out.after.a===out.before.a && out.after.b===out.before.b,
     'the match being tracked is still the one that was being tracked',
     out.after.a+' vs '+out.after.b);
  ok(out.after.ptsA===out.before.ptsA && out.after.ptsB===out.before.ptsB,
     'with its score intact', out.after.ptsA+'-'+out.after.ptsB);
  ok(out.after.history===out.before.history, 'and its undo history',
     out.after.history+' vs '+out.before.history);
  ok(out.after.draft===out.before.draft, 'the saved draft was never written over');
  ok(!out.after.running, 'and nothing is left running afterwards');
  ok(out.spoke===0 && out.buzzed===0, 'no replayed point was spoken aloud or buzzed',
     out.spoke+' spoken, '+out.buzzed+' buzzes');
  ok(out.celebrations===0, 'and no set celebration was thrown over the page',
     out.celebrations+' overlays');
  ok(out.asked===0, 'and the fast path asked nothing', out.asked+' confirms');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
