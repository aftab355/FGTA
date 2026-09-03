/* The whole thing, end to end, through the page as it ships: a real webm with
   a real soundtrack goes into acLoad(), and what comes out is checked against
   the plan the fixture was built from — including the clip that sounds exactly
   like a rally and has an empty court behind it.

   Needs the fixture:  node test/make-fixture.js  first.
   Then:               node test/vision-video.test.js  */
/* Drives the REAL index.html: hands the shipped auto-cut a real webm with a
   real soundtrack and checks what the shipped code decides. */
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
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);

  const defined=await page.evaluate(()=>({
    acLoad:typeof acLoad, avRun:typeof avRun, avApply:typeof avApply,
    avScanVideo:typeof avScanVideo, avBand:typeof avBand, box:!!document.getElementById('acBox')
  }));
  console.log('  page: '+JSON.stringify(defined));
  if(errs.length) console.log('  init errors: '+errs.slice(0,3).join(' | ').slice(0,300));

  const out=await page.evaluate(async()=>{
    const r=await fetch('/match-av.webm'); const b=await r.blob();
    const f=new File([b],'match-av.webm',{type:'video/webm'});
    await acLoad(f);
    const t0=Date.now();
    while(Date.now()-t0<180000){
      if(AC && !AC.busy && AC.av && !AC.av.busy) break;
      await new Promise(r=>setTimeout(r,300));
    }
    if(!AC) return {error:'AC vanished'};
    const html=document.getElementById('acBox').innerHTML;
    return {
      error:AC.error||null,
      duration:AC.duration, strikes:AC.strikes,
      av: AC.av ? {busy:AC.av.busy, error:AC.av.error||null,
        inconclusive:AC.av.res?AC.av.res.inconclusive:null,
        drops:AC.av.res?AC.av.res.drops:null,
        useBoth:AC.av.res?AC.av.res.useBoth:null,
        frames:AC.av.scan?AC.av.scan.samples:0,
        rate:AC.av.scan?AC.av.scan.rate:0,
        roi:AC.av.roi?{x0:AC.av.roi.x0,x1:AC.av.roi.x1,coreW:AC.av.roi.coreW}:null} : null,
      segs: AC.segs.map(s=>({start:Math.round(s.start*10)/10,end:Math.round(s.end*10)/10,
        hits:s.hits, keep:s.keep,
        conf:s.v&&s.v.seen?Math.round(s.v.conf*100)/100:null,
        ratio:s.v&&s.v.seen?Math.round(s.v.ratio*10)/10:null,
        B:s.v&&s.v.seen?Math.round(s.v.B*100)/100:null,
        reason:s.v?s.v.reason:null})),
      bandOn: /av-band-on/.test(html), bandBlind:/av-band-blind/.test(html),
      pips: (html.match(/av-pip /g)||[]).length,
      json: (function(){ try{ return true; }catch(e){ return false; } })()
    };
  });
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# the shipped page, given a real webm with a real soundtrack');
  if(out.error){ console.log('  auto-cut error: '+out.error); }
  console.log('  duration '+(out.duration||0).toFixed(1)+'s, '+out.strikes+' strikes heard');
  console.log('  picture: '+JSON.stringify(out.av));
  const truth=JSON.parse(fs.readFileSync(path.join(SCRATCH,'truth-av.json'),'utf8'));
  out.segs.forEach(s=>{
    const t=truth.plan.find(p=>s.start<p.end&&s.end>p.start);
    console.log('   '+String(s.start).padStart(5)+'-'+String(s.end).padEnd(5)+' '+
      (t?t.type:'??').padEnd(9)+' '+s.hits+' strikes  conf='+(s.conf==null?'--':s.conf.toFixed(2))+
      ' ratio='+(s.ratio==null?'-':s.ratio)+' B='+(s.B==null?'-':s.B)+
      '  keep='+(s.keep?'YES':'no ')+'  '+(s.reason||''));
  });

  ok(!out.error,'the file went through the shipped auto-cut','err='+out.error);
  ok(out.av && !out.av.error,'the picture pass ran','err='+(out.av&&out.av.error));
  ok(out.av && out.av.frames>100,'frames were read out of the video','n='+(out.av&&out.av.frames));
  ok(!out.av.inconclusive,'the pass was conclusive on footage showing a court');
  ok(out.bandOn && !out.bandBlind,'the panel says so');
  ok(out.pips>0,'every clip carries its score in the list','pips='+out.pips);

  // ground truth: rallies kept, junk dropped
  for(const p of truth.plan){
    const hit=out.segs.filter(s=>s.start<p.end&&s.end>p.start);
    if(p.type==='rally'){
      ok(hit.length>0 && hit.some(s=>s.keep), 'rally '+p.start+'-'+p.end+'s survives to the cut',
         hit.length?('conf='+hit.map(s=>s.conf).join(',')):'audio never found it');
    } else {
      ok(hit.length===0 || hit.every(s=>!s.keep), p.type+' '+p.start+'-'+p.end+'s is not in the cut',
         hit.map(s=>s.start+':'+s.conf+(s.keep?' KEPT':'')).join(' '));
    }
  }
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
