/* The streamed read has to agree with the in-memory one, or "it handles big
   files now" means "it handles big files differently". Both paths are run
   over the same fixture and their strike times compared.

   Needs the fixture:  node test/make-fixture.js  first.
   Then:               node test/bigfile.test.js  */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..'), SCRATCH=path.join(__dirname,'fixtures');
const MIME={'.html':'text/html','.js':'text/javascript','.webm':'video/webm','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

function serve(rq,rs){
  let rel=decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
  let f = rel.startsWith('match-av') ? path.join(SCRATCH,rel) : path.join(APP,rel);
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

if(!fs.existsSync(path.join(SCRATCH,'match-av.webm'))){
  console.error('No fixture. Run:  node test/make-fixture.js');
  process.exit(2);
}

(async()=>{
  const server=http.createServer(serve);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port;
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
  const page=await browser.newPage();
  page.on('pageerror',e=>console.log('  [pageerror] '+e.message));
  await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2000);

  const out=await page.evaluate(async()=>{
    const r=await fetch('/match-av.webm'); const b=await r.blob();
    const file=new File([b],'match-av.webm',{type:'video/webm'});
    const url=URL.createObjectURL(file);

    // 1. the path a file that fits takes
    const mem=await acDecodeInMemory(file);
    const memHits=acPickOnsets(acOnsetStrength(mem.env), mem.env, acTune(), mem.hopMs, mem.map)
                    .map(h=>Math.round(h.t*1000)/1000);

    // 2. the path a 10GB file takes — with a watch on whether anything reads
    //    the whole file, which is the thing that must not happen
    let wholeFileReads=0;
    const realAB=Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer=function(){ if(this.size>1e6) wholeFileReads++; return realAB.apply(this,arguments); };
    const runs={};
    for(const rate of [1,4,8,16]){
      const t0=performance.now();
      try{
        const s=await acStreamAudio(url,{rate});
        const hits=acPickOnsets(acOnsetStrength(s.env), s.env, acTune(), s.hopMs, s.map)
                     .map(h=>Math.round(h.t*1000)/1000);
        runs[rate]={ok:true, hits, hopMs:Math.round(s.hopMs*100)/100, frames:s.n,
                    duration:Math.round(s.duration*100)/100, stalls:s.stalls,
                    wall:Math.round(performance.now()-t0)};
      }catch(e){ runs[rate]={ok:false, err:String(e&&e.message||e), wall:Math.round(performance.now()-t0)}; }
    }
    Blob.prototype.arrayBuffer=realAB;
    URL.revokeObjectURL(url);
    return {memHits, memDur:Math.round(mem.duration*100)/100, runs, wholeFileReads,
            memHop:mem.hopMs, streamRate:AC_STREAM_RATE};
  });

  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  const truth=JSON.parse(fs.readFileSync(path.join(SCRATCH,'truth-av.json'),'utf8'));

  console.log('\n# the same recording, loaded vs. played through');
  console.log('  in memory: '+out.memHits.length+' strikes, hop '+out.memHop+'ms, '+out.memDur+'s');
  for(const rate of [1,4,8,16]){
    const r=out.runs[rate];
    if(!r.ok){ console.log('  '+String(rate).padStart(2)+'x: FAILED — '+r.err); continue; }
    // how well each in-memory strike is matched by a streamed one
    /* signed, so a systematic pipeline latency shows up as a bias rather than
       hiding inside an absolute value */
    const sig=out.memHits.map(t=>{
      let best=null;
      for(const u of r.hits) if(best===null||Math.abs(u-t)<Math.abs(best)) best=u-t;
      return best;
    }).sort((a,b)=>a-b);
    const bias=sig[sig.length>>1]||0;
    const errs=sig.map(Math.abs).sort((a,b)=>a-b);
    const med=errs[errs.length>>1]||0, worst=errs[errs.length-1]||0;
    console.log('  '+String(rate).padStart(2)+'x: '+String(r.hits.length).padStart(3)+' strikes, hop '+
      String(r.hopMs).padStart(5)+'ms, '+String(r.frames).padStart(6)+' frames, dur '+r.duration+
      's, '+r.stalls+' stalls, '+(r.wall/1000).toFixed(1)+'s wall  ·  bias '+
      (bias*1000>=0?'+':'')+(bias*1000).toFixed(0)+'ms, |median| '+
      (med*1000).toFixed(0)+'ms, worst '+(worst*1000).toFixed(0)+'ms');
  }

  ok(out.wholeFileReads===0,'the streamed path never reads the file into memory',
     'arrayBuffer calls='+out.wholeFileReads);
  ok(out.memHits.length>=truth.strikes.length*0.8,'the in-memory path hears the strikes',
     out.memHits.length+' vs '+truth.strikes.length+' played');

  ok(out.streamRate<=4,'the shipped default rate is one of the faithful ones',
     'AC_STREAM_RATE='+out.streamRate);
  for(const rate of [1,4]){
    const r=out.runs[rate];
    ok(r.ok, rate+'x streamed read completes', r.ok?'':r.err);
    if(!r.ok) continue;
    ok(Math.abs(r.duration-out.memDur)<0.5, rate+'x agrees on the length of the recording',
       r.duration+' vs '+out.memDur);
    const ratio=r.hits.length/out.memHits.length;
    ok(ratio>0.85&&ratio<1.2, rate+'x finds the same strikes as loading it',
       r.hits.length+' vs '+out.memHits.length);
    const errs=out.memHits.map(t=>Math.min(...r.hits.map(u=>Math.abs(u-t)))).sort((a,b)=>a-b);
    ok(errs[errs.length>>1]<0.15, rate+'x puts them within a fraction of the lead-in padding',
       'median offset '+(errs[errs.length>>1]*1000).toFixed(0)+'ms');
  }
  /* 8x and 16x are printed above rather than asserted: they are the reason the
     default is 4, and the numbers are quoted in the comment on AC_STREAM_RATE. */
  const rD=out.runs[out.streamRate];
  if(rD&&rD.ok) ok(rD.wall < (58000/out.streamRate)*1.6,
    'the default rate really is about '+out.streamRate+'x faster than real time',
    (rD.wall/1000).toFixed(1)+'s for a 58s recording');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
