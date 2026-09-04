/* Does the detector still hear a rally once the serve is over?

   The complaint this exists for: "it ends the clip the moment someone returns
   a serve." That is what a floor set too high looks like — the serve is the
   loudest thing in a rally by a distance, so a threshold that clears the
   ambience can also clear every groundstroke after it, and maxGap then closes
   the cluster two strikes in.

   The other fixtures cannot catch that, because they play every strike at
   about the same level. This one has the range real tennis has.

   Needs the fixture:  node test/make-dynamics-fixture.js
   Then:               node test/dynamics.test.js */
const {chromium}=require('./playwright.js');
const http=require('http'), fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..'), FIX=path.join(__dirname,'fixtures');
const MIME={'.html':'text/html','.js':'text/javascript','.webm':'video/webm','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
if(!fs.existsSync(path.join(FIX,'dynamics.webm'))){
  console.error('No fixture. Run:  node test/make-dynamics-fixture.js'); process.exit(2);
}

(async()=>{
  const server=http.createServer((rq,rs)=>{
    let rel=decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,'')||'index.html';
    let f=/\.webm$/.test(rel)?path.join(FIX,rel):path.join(APP,rel);
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
    const size=fs.statSync(f).size, type=MIME[path.extname(f)]||'application/octet-stream';
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
  const truth=JSON.parse(fs.readFileSync(path.join(FIX,'dynamics-truth.json'),'utf8'));

  const out=await page.evaluate(async(truth)=>{
    const r=await fetch('/dynamics.webm'); const b=await r.blob();
    await acLoad(new File([b],'dynamics.webm',{type:'audio/webm'}));
    const t0=Date.now();
    while(Date.now()-t0<120000){ if(AC && !AC.busy) break; await new Promise(r=>setTimeout(r,250)); }
    if(AC.error) return {err:AC.error};
    const inR=(t)=>truth.plan.some(p=>t>=p.start-0.4 && t<=p.end+0.4);
    /* An audio-only fixture's recorder starts a moment before the scheduled
       strikes do, so the recording's clock is offset from the plan's by a
       constant nobody chose. Estimate it once from the loudest strikes rather
       than widening the tolerance until everything matches. */
    const offsetOf=(hits)=>{
      const d=[];
      for(const s of truth.strikes){
        if(s.g<0.8) continue;
        let best=null;
        for(const t of hits) if(best===null||Math.abs(t-s.t)<Math.abs(best)) best=t-s.t;
        if(best!==null && Math.abs(best)<1.5) d.push(best);
      }
      d.sort((a,b)=>a-b);
      return d.length?d[d.length>>1]:0;
    };
    const rows=[];
    const was=AC.tune.noiseSig;
    for(const sig of [0,2,3,4,5]){
      AC.tune.noiseSig=sig; acRecompute();
      const hits=AC.hits.map(h=>h.t);
      const off=offsetOf(hits);
      const found=(s)=>hits.some(t=>Math.abs(t-s.t-off)<0.16);
      const loud=truth.strikes.filter(s=>s.g>=0.7), mid=truth.strikes.filter(s=>s.g>=0.5&&s.g<0.7),
            soft=truth.strikes.filter(s=>s.g<0.5);
      rows.push({sig, n:hits.length, dead:hits.filter(t=>!inR(t)).length, clips:AC.segs.length,
                 loud:loud.filter(found).length+'/'+loud.length,
                 mid:mid.filter(found).length+'/'+mid.length,
                 soft:soft.filter(found).length+'/'+soft.length,
                 recall:truth.strikes.filter(found).length/truth.strikes.length,
                 spans:AC.segs.map(s=>Math.round(s.start)+'-'+Math.round(s.end)).join(' ')});
    }
    AC.tune.noiseSig=was; acRecompute();
    const hits=AC.hits.map(h=>h.t);
    const off=offsetOf(hits);
    const found=(s)=>hits.some(t=>Math.abs(t-s.t-off)<0.16);
    return {rows, shipped:was, offset:Math.round(off*100)/100, duration:Math.round(AC.duration*10)/10,
            clips:AC.segs.length, strikes:hits.length,
            dead:hits.filter(t=>!inR(t)).length,
            recall:truth.strikes.filter(found).length/truth.strikes.length,
            spans:AC.segs.map(s=>Math.round(s.start)+'-'+Math.round(s.end)).join(' ')};
  }, truth);
  await browser.close(); server.close();

  let pass=0,fail=0;
  const ok=(c,m,x)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(x?'   ['+x+']':''));} };
  console.log('\n# a rally with the dynamic range of real tennis');
  if(out.err){ console.log('  ERROR '+out.err); process.exit(1); }
  console.log('  '+truth.strikes.length+' strikes played across '+truth.plan.length+' rallies, '+out.duration+'s');
  console.log('  sigmas   found  dead  clips  loud    mid     soft    recall');
  for(const r of out.rows) console.log('    '+String(r.sig).padStart(2)+'      '+
    String(r.n).padStart(4)+'  '+String(r.dead).padStart(4)+'  '+String(r.clips).padStart(5)+
    '  '+r.loud.padEnd(6)+'  '+r.mid.padEnd(6)+'  '+r.soft.padEnd(6)+'  '+
    Math.round(r.recall*100)+'%');
  console.log('  shipped default ('+out.shipped+'): '+out.clips+' clips  ['+out.spans+']'+
              '   (recording clock offset '+out.offset+'s)');

  ok(out.recall>0.85,'most of the rally is still heard after the serve',
     Math.round(out.recall*100)+'% of strikes found');
  ok(out.clips===truth.plan.length,'each rally comes out as one clip, not a stub',
     out.clips+' clips, wanted '+truth.plan.length);
  ok(out.dead<=2,'and the gaps stay quiet', out.dead+' in the dead time');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
