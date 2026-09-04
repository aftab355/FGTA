/* Can the picture tell which END the serve came from?

   This is the measurement docs/scoring.md route B rests on, and it is the one
   that cannot be settled from a rulebook — it depends entirely on whether the
   camera sees enough of the court. So it is asked of a real decoded video with
   a court in perspective, through the shipped page.

   Needs the fixture:  node test/make-serve-fixture.js
   Then:               node test/serve-vision.test.js  */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..'), SCRATCH=path.join(__dirname,'fixtures');
const MIME={'.html':'text/html','.js':'text/javascript','.webm':'video/webm','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

function serve(rq,rs){
  let rel=decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
  let f = rel.startsWith('serve.') ? path.join(SCRATCH,rel) : path.join(APP,rel);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
  const size=fs.statSync(f).size, type=MIME[path.extname(f)]||'application/octet-stream';
  const m=/^bytes=(\d*)-(\d*)$/.exec(rq.headers.range||'');
  if(m){
    const start=m[1]?parseInt(m[1],10):0, end=m[2]?parseInt(m[2],10):size-1;
    if(start>=size||end>=size||start>end){ rs.writeHead(416,{'Content-Range':'bytes */'+size}); return rs.end(); }
    rs.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes',
      'Content-Range':'bytes '+start+'-'+end+'/'+size,'Content-Length':end-start+1});
    return fs.createReadStream(f,{start,end}).pipe(rs);
  }
  rs.writeHead(200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':size});
  fs.createReadStream(f).pipe(rs);
}

if(!fs.existsSync(path.join(SCRATCH,'serve.webm'))){
  console.error('No fixture. Run:  node test/make-serve-fixture.js');
  process.exit(2);
}

(async()=>{
  const server=http.createServer(serve);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();
  page.on('pageerror',e=>{ if(!/supabase/.test(e.message)) console.log('  [pageerror] '+e.message); });
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2000);

  const truthIn=JSON.parse(fs.readFileSync(path.join(SCRATCH,'serve-truth.json'),'utf8'));
  const out=await page.evaluate(async(truth)=>{
    const r=await fetch('/serve.webm'); const b=await r.blob();
    const file=new File([b],'serve.webm',{type:'video/webm'});
    const url=URL.createObjectURL(file);

    /* The rally boundaries here come from the PLAN, not from the audio
       detector. That is isolation, not convenience: the subject of this test
       is a picture measurement, and gating it on the audio front-end's tuning
       would mean a failure here could be either. The end-to-end path is what
       vision-video.test.js is for.

       It is also not hypothetical. This fixture's court ambience over-triggers
       the strike detector badly enough that at the DEFAULT threshold the whole
       recording comes back as one clip, and even at 3.2 of a possible 4 it is
       three clips instead of six — see the diagnostic printed below, which is
       here precisely because that is worth knowing rather than working around
       quietly. */
    const segs=truth.plan.map((p,i)=>({n:i+1, start:p.start, end:p.end}));
    const strikes=truth.strikes.map(s=>s.t);
    const scan=await avScanVideo(url, avWindows(segs, truth.duration), {budget:12});
    const roi=avROI(scan.grid, scan.n);
    const ser=avSeries(scan.grid, scan.n, roi);
    /* avApply rather than avMeasure per segment: the near/far decision is
       made across the whole recording, not clip by clip. */
    const res=avApply(segs, scan.T, scan.dt, ser, strikes, AV_DEF);
    const per=res.per;

    /* and separately, why the audio front-end struggles on this one: how the
       loudest onsets in the DEAD time compare with the loudest in the rallies */
    let audio=null;
    try{
      await acLoad(file);
      const t0=Date.now();
      while(Date.now()-t0<120000){ if(AC && !AC.busy) break; await new Promise(r=>setTimeout(r,250)); }
      if(AC && AC.o){
        const hop=AC.hopMs, inR=[], inD=[];
        for(let i=0;i<AC.o.length;i++){
          const t=i*hop/1000;
          (truth.plan.some(p=>t>=p.start&&t<=p.end)?inR:inD).push(AC.o[i]);
        }
        const pct=(a,q)=>{ const c=a.slice().sort((x,y)=>x-y); return c[Math.floor(c.length*q)]||0; };
        /* where the detections actually ARE: in the rallies, or in the dead
           time between them. This is what says whether over-detection is
           extra hits inside real rallies (harmless to the cut) or phantom
           ones in the gaps (which bridge them and destroy the segmentation) */
        const hits=AC.hits.map(h=>h.t);
        const inRally=hits.filter(t=>truth.plan.some(p=>t>=p.start&&t<=p.end)).length;
        audio={strikes:AC.strikes, clips:AC.segs.length,
               hitsInRally:inRally, hitsInDead:hits.length-inRally,
               realStrikes:truth.strikes.length,
               perMin:Math.round(AC.strikes/(AC.duration/60)),
               rallyP995:pct(inR,0.995), deadP995:pct(inD,0.995),
               deadP999:pct(inD,0.999), floorFrac:AC.tune.floorFrac};
      }
    }catch(e){ audio={err:String(e&&e.message||e)}; }

    URL.revokeObjectURL(url);
    return {
      error:null, duration:scan.seconds, frames:scan.samples, audio,
      roi:{y0:roi.y0,y1:roi.y1,midY:roi.midY,x0:roi.x0,x1:roi.x1},
      cells:{near:ser.nearCells, far:ser.farCells},
      split:res.serve?{cut:Math.round(res.serve.cut*1000)/1000,
                       gap:Math.round(res.serve.gap*1000)/1000,
                       near:res.serve.near, far:res.serve.far}:null,
      segs:segs.map((s,i)=>({start:s.start, end:s.end,
        serveEnd:per[i].seen?per[i].serveEnd:null,
        serveConf:per[i].seen?Math.round(per[i].serveConf*100)/100:null,
        shift:per[i].seen?Math.round(per[i].serveShift*1000)/1000:null}))
    };
  }, truthIn);
  await browser.close(); server.close();

  const truth=JSON.parse(fs.readFileSync(path.join(SCRATCH,'serve-truth.json'),'utf8'));
  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };

  console.log('\n# which end did the serve come from');
  console.log('  court rows '+(out.roi?out.roi.y0+'-'+out.roi.y1+' split at '+out.roi.midY:'?')+
              '   cells near/far '+(out.cells?out.cells.near+'/'+out.cells.far:'?')+
              '   '+out.frames+' frames');
  console.log('  ends split at '+(out.split?out.split.cut+' (gap '+out.split.gap+
              ', '+out.split.near+' near / '+out.split.far+' far)':'NOT FOUND'));
  if(out.audio && !out.audio.err){
    const a=out.audio;
    console.log('  audio front-end on this fixture: '+a.strikes+' strikes ('+a.perMin+
      '/min) in '+a.clips+' clip'+(a.clips===1?'':'s')+
      '  ·  loudest onsets: rallies '+a.rallyP995.toFixed(3)+
      ', dead time '+a.deadP995.toFixed(3)+' (p99.9 '+a.deadP999.toFixed(3)+')');
    console.log('    of those '+a.strikes+' detections: '+a.hitsInRally+' inside a rally, '+
      a.hitsInDead+' in the dead time between them ('+a.realStrikes+' were actually played)');
  }
  let right=0, judged=0;
  out.segs.forEach(s=>{
    const t=truth.plan.find(p=>s.start<p.end&&s.end>p.start);
    const want=t?(t.end_==='near'?1:-1):null;
    const got=s.serveEnd;
    const mark=want==null?'  ':(got===want?'ok':'XX');
    if(want!=null && got!=null && got!==0){ judged++; if(got===want) right++; }
    console.log('   '+mark+'  '+String(s.start).padStart(5)+'-'+String(s.end).padEnd(5)+
      ' want '+(t?t.end_:'??').padEnd(4)+' got '+(got===1?'near':got===-1?'far ':'--  ')+
      '  shift '+(s.shift==null?'-':(s.shift>=0?'+':'')+s.shift)+
      '  conf '+(s.serveConf==null?'-':s.serveConf));
  });

  ok(out.frames>200,'frames came out of the fixture','n='+out.frames);
  ok(out.cells && out.cells.near>0 && out.cells.far>0,
     'the court split into a near half and a far half',
     out.cells?out.cells.near+'/'+out.cells.far:'no series');
  ok(judged>=truth.plan.length-1,'nearly every rally got a verdict',judged+'/'+truth.plan.length);
  ok(out.split,'the clips split into two serving ends',
     out.split?'':'no gap wide enough');
  ok(right===judged && judged>0,'every verdict matches the end the serve was played from',
     right+'/'+judged+' correct');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
