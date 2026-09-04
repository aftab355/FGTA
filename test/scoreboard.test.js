/* Does the score actually reach the exported video?

   The reconstruction itself is measured in score.test.js, in node, over two
   hundred matches. This is the other half: that what it works out gets drawn,
   into the file, in the right place — checked by looking at the pixels where
   the bug is against the same pixels of the source.

   Needs the fixture:  node test/make-fixture.js
   Then:               node test/scoreboard.test.js */
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

    /* A whole match is not what this fixture is, so the board is supplied
       directly — what is under test here is the drawing and the muxing, not
       the reconstruction, which score.test.js measures over 200 matches. */
    AC.score={a:'Ada', b:'Bo', result:{board:AC.segs.map((s,i)=>({
      rally:i, setsA:1, setsB:0, gamesA:i, gamesB:1, point:2, points:6,
      server:i%2?'a':'b', winner:'a', tiebreak:false, pts:null }))}};

    const renderOnce=async()=>{
      acRenderCut();
      const t=Date.now();
      while(Date.now()-t<300000){ if(AC.render && !AC.render.busy) break; await new Promise(r=>setTimeout(r,400)); }
      const R=AC.render||{};
      if(R.error||!R.url) throw new Error(R.error||'no file produced');
      return {url:R.url, bytes:R.bytes, wall:R.wall};
    };
    const withBug=await renderOnce();
    /* the control: the same clips, the same encoder, no board. Anything that
       differs in that corner is the scoreboard and nothing else. */
    const keptScore=AC.score; AC.score=null; AC.render=null;
    const without=await renderOnce();
    AC.score=keptScore;
    const R=withBug;

    /* sample the corner the bug is drawn into, in the output and in the
       source, and compare */
    const grab=async(src, at)=>{
      const v=document.createElement('video');
      v.src=src; v.muted=true; v.preload='auto';
      document.body.appendChild(v);
      await new Promise(res=>{ v.addEventListener('loadedmetadata',res,{once:true}); setTimeout(res,12000); });
      await new Promise(res=>{ const f=()=>{v.removeEventListener('seeked',f);res();};
        v.addEventListener('seeked',f); setTimeout(res,8000);
        try{ v.currentTime=at; }catch(e){ res(); } });
      const W=v.videoWidth||320, H=v.videoHeight||180;
      const c=document.createElement('canvas'); c.width=W; c.height=H;
      c.getContext('2d').drawImage(v,0,0,W,H);
      /* bottom-left eighth, where the bug lives */
      const d=c.getContext('2d').getImageData(Math.round(W*0.03), Math.round(H*0.62),
                                              Math.round(W*0.42), Math.round(H*0.30)).data;
      let lum=0, dark=0, pink=0;
      for(let i=0;i<d.length;i+=4){
        const y=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
        lum+=y; if(y<60) dark++;
        if(d[i]>140 && d[i+2]>70 && d[i+1]<90) pink++;
      }
      const n=d.length/4;
      v.remove();
      return {lum:Math.round(lum/n), darkFrac:+(dark/n).toFixed(3), pink, W, H};
    };
    const outC=await grab(withBug.url, 2.0);
    const plainC=await grab(without.url, 2.0);
    return {bytes:R.bytes, wall:R.wall, clips:AC.segs.filter(s=>s.keep).length,
            out:outC, src:plainC};
  });
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# the score, in the exported picture');
  if(out.err){ console.log('  ERROR '+out.err); process.exit(1); }
  console.log('  rendered '+out.clips+' clips, '+(out.bytes/1048576).toFixed(1)+' MB in '+out.wall+'s');
  console.log('  bug corner  — output: luma '+out.out.lum+', '+(out.out.darkFrac*100).toFixed(0)+
              '% dark, '+out.out.pink+' pink px');
  console.log('  same corner — same render, no score: luma '+out.src.lum+', '+
              (out.src.darkFrac*100).toFixed(0)+'% dark, '+out.src.pink+' pink px');

  ok(out.bytes>50000,'a video came out', out.bytes+' bytes');
  ok(out.out.darkFrac > out.src.darkFrac + 0.08,
     'the scoreboard darkens its corner, and the same render without a score does not',
     out.out.darkFrac+' vs '+out.src.darkFrac);
  ok(out.out.lum < out.src.lum - 10,'and dims it', out.out.lum+' vs '+out.src.lum);
  ok(out.out.pink > out.src.pink,'with its border showing',
     out.out.pink+' vs '+out.src.pink+' pink pixels');
  ok(out.src.darkFrac < 0.15,'and with no score there is nothing drawn there at all',
     (out.src.darkFrac*100).toFixed(0)+'% dark in the control');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
