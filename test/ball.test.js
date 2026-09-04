/* Does looking for the ball rescue a rally the soundtrack lost the middle of,
   without gluing together two rallies that really were separate?

   The fixture is built so nothing but the ball can tell them apart: one rally
   goes silent for six seconds while the ball keeps moving, and a real gap of
   the same order has nothing moving in it at all.

   Needs the fixture:  node test/make-ball-fixture.js
   Then:               node test/ball.test.js */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..'), FIX=path.join(__dirname,'fixtures');
const MIME={'.html':'text/html','.js':'text/javascript','.webm':'video/webm','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
if(!fs.existsSync(path.join(FIX,'ball.webm'))){
  console.error('No fixture. Run:  node test/make-ball-fixture.js'); process.exit(2);
}

(async()=>{
  const server=http.createServer((rq,rs)=>{
    let rel=decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
    let f=/\.webm$/.test(rel)?path.join(FIX,rel):path.join(APP,rel);
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
    const size=fs.statSync(f).size, type=MIME[path.extname(f)]||'application/octet-stream';
    const m=/^bytes=(\d*)-(\d*)$/.exec(rq.headers.range||'');
    if(m){ const s=m[1]?+m[1]:0,e=m[2]?+m[2]:size-1;
      rs.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes',
        'Content-Range':'bytes '+s+'-'+e+'/'+size,'Content-Length':e-s+1});
      return fs.createReadStream(f,{start:s,end:e}).pipe(rs); }
    rs.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':size});
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling',
    '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const page=await browser.newPage();
  page.on('pageerror',e=>{ if(!/supabase/.test(e.message)) console.log('  [pageerror] '+e.message); });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);

  const out=await page.evaluate(async()=>{
    try{ localStorage.setItem('fgta_autocut_vision', JSON.stringify({on:false})); }catch(e){}
    const r=await fetch('/ball.webm'); const b=await r.blob();
    await acLoad(new File([b],'ball.webm',{type:'video/webm'}));
    let t0=Date.now();
    while(Date.now()-t0<120000){ if(AC && !AC.busy) break; await new Promise(r=>setTimeout(r,250)); }
    if(AC.error) return {err:AC.error};
    const before=AC.segs.map(s=>[Math.round(s.start*10)/10, Math.round(s.end*10)/10]);
    const gaps=abWindows(AC.segs, AC.duration)
                 .map(g=>[Math.round(g.start*10)/10, Math.round(g.end*10)/10]);

    avBallRun();
    t0=Date.now();
    while(Date.now()-t0<240000){ if(AC.ball && !AC.ball.busy) break; await new Promise(r=>setTimeout(r,400)); }
    const B=AC.ball||{};
    if(B.error) return {err:B.error, before, gaps};
    return {before, gaps,
      after:AC.segs.map(s=>[Math.round(s.start*10)/10, Math.round(s.end*10)/10]),
      bridged:AC.bridged, stretched:AC.stretched,
      spans:(B.spans||[]).map(s=>[Math.round(s.start*10)/10, Math.round(s.end*10)/10]),
      frames:B.frames, seconds:Math.round(B.seconds), wall:B.wall, method:B.method};
  });
  await browser.close(); server.close();

  const truth=JSON.parse(fs.readFileSync(path.join(FIX,'ball-truth.json'),'utf8'));
  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# the ball, in the gaps');
  if(out.err){ console.log('  ERROR '+out.err); process.exit(1); }
  console.log('  by ear alone:   '+out.before.map(s=>s[0]+'-'+s[1]).join('  '));
  console.log('  watched:        '+out.gaps.map(s=>s[0]+'-'+s[1]).join('  '));
  console.log('  ball found in:  '+(out.spans.length?out.spans.map(s=>s[0]+'-'+s[1]).join('  '):'nothing'));
  console.log('  after:          '+out.after.map(s=>s[0]+'-'+s[1]).join('  '));
  console.log('  '+out.frames+' frames over '+out.seconds+'s in '+out.wall+'s ('+out.method+
              ')   stretched '+out.stretched+', joined '+out.bridged);

  const covers=(list,a,b)=>list.some(s=>s[0]<=a+1.2 && s[1]>=b-1.2);
  ok(out.before.length>2,'by ear the silent rally is split','audio gave '+out.before.length+' clips');
  ok(out.frames>50,'frames were read out of the gaps','n='+out.frames);
  ok(out.spans.length>0,'the ball was found somewhere');
  ok(covers(out.spans, 10, 14),'the ball is found through the silent stretch',
     out.spans.map(s=>s[0]+'-'+s[1]).join(' '));
  ok(!out.spans.some(s=>s[0]<32.5 && s[1]>27.5),'and not found in the gap where nobody is playing',
     out.spans.map(s=>s[0]+'-'+s[1]).join(' '));
  ok(covers(out.after, 4, 19),'the silent rally comes back as one clip',
     out.after.map(s=>s[0]+'-'+s[1]).join(' '));
  ok(out.after.length===2,'and the two real rallies stay two clips',
     out.after.length+' clips: '+out.after.map(s=>s[0]+'-'+s[1]).join(' '));

  /* the case the complaint described: a rally that runs on into silence with
     nothing after it to bridge to */
  const second=out.after[out.after.length-1];
  ok(out.before[out.before.length-1][1] < 40,
     'by ear the second rally stops early', 'ended '+out.before[out.before.length-1][1]+'s');
  ok(second && second[1] >= 40.5,'the ball stretches it out to where the point really ended',
     second?('ends '+second[1]+'s, wanted >=40.5'):'no clip');
  ok(out.stretched>0,'and the panel says a clip was stretched','stretched='+out.stretched);

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
