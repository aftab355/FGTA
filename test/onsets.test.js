/* Does the strike detector tell silence from strikes?

   Both fixtures, both with ground truth, checking the thing that was broken:
   detections in the DEAD TIME between rallies. Phantom strikes there are not
   a cosmetic problem — two of them inside maxGap weld a rally to its
   neighbour, and a handful turn a whole match into one clip.

   Needs both fixtures:
     node test/make-fixture.js
     node test/make-serve-fixture.js
   Then: node test/onsets.test.js */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..'), FIX=path.join(__dirname,'fixtures');
const MIME={'.html':'text/html','.js':'text/javascript','.webm':'video/webm','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

const CASES=[
  {file:'match-av.webm', truth:'truth-av.json',    name:'flat court, six-second gaps', clips:[3,5]},
  {file:'serve.webm',    truth:'serve-truth.json', name:'perspective, noisy ambience', clips:[5,7]}
];
for(const c of CASES) if(!fs.existsSync(path.join(FIX,c.file))){
  console.error('Missing fixture '+c.file+'. Run the make-*.js scripts first.'); process.exit(2);
}

(async()=>{
  const server=http.createServer((rq,rs)=>{
    let rel=decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
    let f = /\.webm$/.test(rel) ? path.join(FIX,rel) : path.join(APP,rel);
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
    const size=fs.statSync(f).size, type=MIME[path.extname(f)]||'application/octet-stream';
    const m=/^bytes=(\d*)-(\d*)$/.exec(rq.headers.range||'');
    if(m){ const s=m[1]?+m[1]:0, e=m[2]?+m[2]:size-1;
      rs.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes',
        'Content-Range':'bytes '+s+'-'+e+'/'+size,'Content-Length':e-s+1});
      return fs.createReadStream(f,{start:s,end:e}).pipe(rs); }
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

  const results=[];
  for(const c of CASES){
    const truth=JSON.parse(fs.readFileSync(path.join(FIX,c.truth),'utf8'));
    const plan=truth.plan.map(p=>({start:p.start,end:p.end}));
    const played=truth.strikes.length;
    results.push(await page.evaluate(async({file,plan,played})=>{
      try{ localStorage.setItem('fgta_autocut_vision', JSON.stringify({on:false})); }catch(e){}
      const r=await fetch('/'+file); const b=await r.blob();
      await acLoad(new File([b],file,{type:'video/webm'}));
      const t0=Date.now();
      while(Date.now()-t0<120000){ if(AC && !AC.busy) break; await new Promise(r=>setTimeout(r,250)); }
      if(AC.error) return {file, err:AC.error};
      const inR=(t)=>plan.some(p=>t>=p.start-0.35 && t<=p.end+0.35);
      /* how the choice of sigmas behaves either side of the shipped default,
         so the default is picked from evidence rather than asserted */
      const sweep=[];
      const was=AC.tune.noiseSig;
      for(const sig of [0,3,4,5,6,8,10]){
        AC.tune.noiseSig=sig; acRecompute();
        const h=AC.hits.map(x=>x.t);
        sweep.push({sig, n:h.length, rally:h.filter(inR).length,
                    dead:h.filter(t=>!inR(t)).length, clips:AC.segs.length});
      }
      AC.tune.noiseSig=was; acRecompute();
      const hits=AC.hits.map(h=>h.t);
      return {file, played, sweep,
        duration:Math.round(AC.duration*10)/10,
        strikes:hits.length, inRally:hits.filter(inR).length, inDead:hits.filter(t=>!inR(t)).length,
        clips:AC.segs.length,
        perMin:Math.round(hits.length/(AC.duration/60)),
        split:AC.split?{cut:+AC.split.floor.toFixed(3), typical:+AC.split.typical.toFixed(4),
                        loudest:+AC.split.loudest.toFixed(2), used:+AC.split.used.toFixed(3),
                        peaks:AC.split.peaks}:null};
    },{file:c.file, plan, played}));
  }
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# telling silence from strikes');
  CASES.forEach((c,i)=>{
    const r=results[i];
    console.log('\n  '+c.name+'  ('+c.file+')');
    if(r.err){ console.log('    ERROR '+r.err); fail++; return; }
    console.log('    '+r.played+' played · '+r.strikes+' detected ('+r.perMin+'/min) · '+
                r.inRally+' in rallies, '+r.inDead+' in the dead time · '+r.clips+' clips');
    console.log('    sigmas:  '+r.sweep.map(s=>s.sig+'→'+s.n+'('+s.dead+'d,'+s.clips+'c)').join('  '));
    console.log('    split: '+(r.split
      ? 'typical peak '+r.split.typical+', loudest '+r.split.loudest+', floor '+r.split.cut+
        ' (used '+r.split.used+') from '+r.split.peaks+' peaks'
      : 'none found — falling back to the old floor'));

    ok(r.inDead<=2, c.file+': the silence between rallies is quiet',
       r.inDead+' phantom strikes in the dead time');
    ok(r.inRally>=r.played*0.7, c.file+': the strikes that were played are still found',
       r.inRally+' of '+r.played);
    ok(r.strikes<=r.played*1.6, c.file+': and not many more than were played',
       r.strikes+' vs '+r.played);
    ok(r.clips>=c.clips[0] && r.clips<=c.clips[1], c.file+': the rallies come out as separate clips',
       r.clips+' clips, wanted '+c.clips[0]+'-'+c.clips[1]);
  });
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
