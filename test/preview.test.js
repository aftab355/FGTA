/* The preview must still show a picture after the panel re-renders.

   Every render rewrites the panel's innerHTML, which destroys the <video> and
   builds a new one. Pointing the new element at the file is not enough — with
   preload="metadata" it has decoded nothing and sits at zero showing BLACK
   until something seeks it. The mount path always seeked; the re-bind path did
   not. So the preview only had to be re-rendered once to go black and stay
   there, and the picture, ball and score panels re-render constantly.

   Needs the fixture:  node test/make-fixture.js
   Then:               node test/preview.test.js */
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
    if(m){ const a=m[1]?+m[1]:0,b=m[2]?+m[2]:size-1;
      rs.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes',
        'Content-Range':'bytes '+a+'-'+b+'/'+size,'Content-Length':b-a+1});
      return fs.createReadStream(f,{start:a,end:b}).pipe(rs); }
    rs.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':size});
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();
  page.on('pageerror',e=>{ if(!/supabase/.test(e.message)) console.log('  [pageerror] '+e.message); });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);

  const out=await page.evaluate(async()=>{
    try{ localStorage.setItem('fgta_autocut_vision', JSON.stringify({on:false})); }catch(e){}
    document.getElementById('view-autocut').style.display='';
    const r=await fetch('/match-av.webm'); const b=await r.blob();
    await acLoad(new File([b],'match-av.webm',{type:'video/webm'}));
    let t0=Date.now();
    while(Date.now()-t0<120000){ if(AC && !AC.busy) break; await new Promise(r=>setTimeout(r,250)); }
    if(AC.error) return {err:AC.error};

    const look=async()=>{
      /* give the element a moment to land on the frame it was seeked to */
      for(let i=0;i<40;i++){
        const v=document.getElementById('acVideo');
        if(v && v.readyState>=2 && v.videoWidth>0) break;
        await new Promise(r=>setTimeout(r,150));
      }
      await new Promise(r=>setTimeout(r,600));
      const v=document.getElementById('acVideo');
      if(!v||!v.videoWidth) return {lum:0, w:0, t:0, ready:v?v.readyState:-1};
      const c=document.createElement('canvas'); c.width=80; c.height=45;
      const g=c.getContext('2d'); g.drawImage(v,0,0,80,45);
      const d=g.getImageData(0,0,80,45).data;
      let lum=0, mx=0;
      for(let i=0;i<d.length;i+=4){ const y=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8; lum+=y; if(y>mx)mx=y; }
      return {lum:Math.round(lum/(d.length/4)), max:mx, w:v.videoWidth,
              t:Math.round(v.currentTime*10)/10, ready:v.readyState};
    };

    const first=await look();
    /* now do what the picture, ball and score panels all do */
    renderAutoCut(); renderAutoCut();
    const afterRender=await look();
    /* and what moving a slider does */
    acSetTune('lead', 2);
    const afterTune=await look();
    /* and stepping to another clip */
    acGo(1);
    const afterGo=await look();
    return {first, afterRender, afterTune, afterGo,
            clips:AC.segs.length, starts:acKept().map(s=>Math.round(s.start*10)/10)};
  });
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# the preview, after the panel redraws');
  if(out.err){ console.log('  ERROR '+out.err); process.exit(1); }
  console.log('  clips at '+out.starts.join(', '));
  for(const [k,v] of Object.entries({'on load':out.first,'after re-render':out.afterRender,
                                     'after a slider':out.afterTune,'after next clip':out.afterGo}))
    console.log('  '+k.padEnd(17)+' luma '+String(v.lum).padStart(3)+'  peak '+String(v.max||0).padStart(3)+
                '  at '+v.t+'s  readyState '+v.ready);

  ok(out.first.lum>18,'it shows a picture when the file first loads', 'luma '+out.first.lum);
  ok(out.afterRender.lum>18,'and still does after the panel redraws twice',
     'luma '+out.afterRender.lum);
  ok(out.afterTune.lum>18,'and after a setting changes', 'luma '+out.afterTune.lum);
  ok(out.afterGo.lum>18,'and after stepping to the next clip', 'luma '+out.afterGo.lum);
  ok(out.afterRender.t>0.2,'a redraw leaves it on the clip, not back at zero',
     'at '+out.afterRender.t+'s');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
