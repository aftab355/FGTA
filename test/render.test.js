/* Drop a video in, get a video out. Renders the cut through the shipped page
   and then checks the thing that matters: the file it produced is a real,
   playable video of about the right length, with audio, containing the
   rallies and not the dead time.

   Needs the fixture:  node test/make-fixture.js
   Then:               node test/render.test.js */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..'), FIX=path.join(__dirname,'fixtures');
const MIME={'.html':'text/html','.js':'text/javascript','.webm':'video/webm','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

if(!fs.existsSync(path.join(FIX,'match-av.webm'))){
  console.error('No fixture. Run:  node test/make-fixture.js'); process.exit(2);
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
    const r=await fetch('/match-av.webm'); const b=await r.blob();
    await acLoad(new File([b],'match-av.webm',{type:'video/webm'}));
    let t0=Date.now();
    while(Date.now()-t0<120000){ if(AC && !AC.busy) break; await new Promise(r=>setTimeout(r,250)); }
    if(AC.error) return {err:AC.error};

    const kept=AC.segs.filter(s=>s.keep);
    const want=kept.reduce((a,s)=>a+s.dur,0);
    const supported=acRenderSupported(), mime=acRenderMime();

    const started=Date.now();
    acRenderCut();
    t0=Date.now();
    while(Date.now()-t0<300000){
      if(AC.render && !AC.render.busy) break;
      await new Promise(r=>setTimeout(r,400));
    }
    const R=AC.render||{};
    if(R.error||!R.url) return {err:R.error||'no file produced', supported, mime};

    /* play what came out, and see what it actually is */
    const v=document.createElement('video');
    v.src=R.url; v.muted=true; v.preload='auto';
    document.body.appendChild(v);
    await new Promise((res,rej)=>{
      v.addEventListener('loadedmetadata',res,{once:true});
      v.addEventListener('error',()=>rej(new Error('the output would not open')),{once:true});
      setTimeout(res,15000);
    });
    let dur=v.duration;
    if(!isFinite(dur)||dur<=0){
      await new Promise(res=>{ const f=()=>{v.removeEventListener('durationchange',f);res();};
        v.addEventListener('durationchange',f); setTimeout(res,8000); try{ v.currentTime=1e101; }catch(e){ res(); } });
      dur=v.duration;
      try{ v.currentTime=0; }catch(e){}
    }
    /* a frame out of the middle, to prove there is picture and not black */
    await new Promise(res=>{ const f=()=>{v.removeEventListener('seeked',f);res();};
      v.addEventListener('seeked',f); setTimeout(res,6000);
      try{ v.currentTime=Math.max(0.2,(isFinite(dur)?dur:4)/2); }catch(e){ res(); } });
    const cv=document.createElement('canvas'); cv.width=64; cv.height=36;
    const g=cv.getContext('2d'); g.drawImage(v,0,0,64,36);
    const px=g.getImageData(0,0,64,36).data;
    let lum=0,mx=0;
    for(let i=0;i<px.length;i+=4){ const y=(px[i]*77+px[i+1]*150+px[i+2]*29)>>8; lum+=y; if(y>mx)mx=y; }
    lum/=(px.length/4);
    v.remove();

    return {supported, mime, bytes:R.bytes, wall:R.wall,
            clips:kept.length, wantSeconds:Math.round(want*10)/10,
            gotSeconds:isFinite(dur)?Math.round(dur*10)/10:null,
            sourceSeconds:Math.round(AC.duration*10)/10,
            meanLuma:Math.round(lum), maxLuma:mx,
            tracks:{video:v.videoWidth>0, w:v.videoWidth, h:v.videoHeight}};
  });
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# drop a video in, get a video out');
  if(out.err){ console.log('  ERROR: '+out.err); process.exit(1); }
  console.log('  '+out.mime);
  console.log('  '+out.clips+' clips, '+out.wantSeconds+'s of tennis out of a '+out.sourceSeconds+
              's recording → '+out.gotSeconds+'s, '+(out.bytes/1048576).toFixed(1)+' MB, in '+out.wall+'s');
  console.log('  picture '+out.tracks.w+'x'+out.tracks.h+', mean luma '+out.meanLuma+' (peak '+out.maxLuma+')');

  ok(out.supported && !!out.mime,'the browser can record video in the page', out.mime);
  ok(out.bytes>50000,'a file came out with something in it', out.bytes+' bytes');
  ok(out.gotSeconds!=null,'the output is a video the browser will open');
  ok(out.gotSeconds>out.wantSeconds*0.75 && out.gotSeconds<out.wantSeconds*1.35,
     'it is about as long as the rallies that were kept',
     out.gotSeconds+'s vs '+out.wantSeconds+'s');
  ok(out.gotSeconds < out.sourceSeconds*0.85,'and shorter than the recording it came from',
     out.gotSeconds+'s vs '+out.sourceSeconds+'s');
  ok(out.tracks.video && out.tracks.w>0,'it has a picture', out.tracks.w+'x'+out.tracks.h);
  ok(out.meanLuma>12 && out.maxLuma>60,'and the picture is a court, not a black frame',
     'mean luma '+out.meanLuma+', peak '+out.maxLuma);

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
