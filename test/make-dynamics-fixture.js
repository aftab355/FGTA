/* A fixture with a REALISTIC DYNAMIC RANGE, which the other two do not have.

   Both existing fixtures play every strike at roughly the same level, so a
   detector that only ever finds loud strikes passes them. Real tennis is not
   like that: the serve is the loudest thing in the rally by a distance, a
   groundstroke off the far baseline reaches the microphone much quieter, and
   a touch at the net is quieter still. If a floor is set too high the serve
   and maybe the return survive and the rest of the rally is lost — which
   ends the clip two strikes in.

   Audio only, because that is what is being tested, and because it records
   in a fraction of the time.

   node test/make-dynamics-fixture.js  (~1 min, needs playwright + chromium) */
const {chromium}=require('./playwright.js');
const fs=require('fs'), path=require('path');
const OUT=path.join(__dirname,'fixtures','dynamics.webm');

const PLAN=[{start:3,end:12},{start:17,end:27},{start:32,end:41},{start:46,end:57}];
const DUR=61;
function strikes(){
  const o=[]; let s=515151;
  const R=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for(const p of PLAN){
    let t=p.start+0.9, i=0;
    while(t<p.end-0.3){
      /* serve loudest, then alternating near and far groundstrokes, with the
         far side much quieter, and the odd soft touch */
      let g;
      if(i===0) g=1.0;
      else if(i%2===1) g=0.55+R()*0.15;        // far baseline
      else g=0.75+R()*0.2;                     // near
      if(i>2 && R()<0.18) g=0.3+R()*0.1;       // a touch
      o.push({t:Math.round(t*100)/100, g:Math.round(g*100)/100});
      t+=0.8+R()*0.35; i++;
    }
  }
  return o.sort((a,b)=>a.t-b.t);
}
const STRIKES=strikes();

(async()=>{
  fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling',
    '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const page=await browser.newPage();
  page.on('pageerror',e=>console.log('  [pageerror] '+e.message));
  await page.setContent('<body></body>');
  console.log('  recording '+DUR+'s of audio in real time…');
  const b64=await page.evaluate(async({STRIKES,DUR})=>{
    const ac=new AudioContext({sampleRate:48000});
    const dest=ac.createMediaStreamDestination();
    const mk=(ms,g)=>{ const n=Math.round(ac.sampleRate*ms/1000);
      const b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,6)*g; return b; };
    const CLICK=mk(6,1.0);
    const amb=ac.createBufferSource(); {
      const n=ac.sampleRate*4, b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      let lp=0; for(let i=0;i<n;i++){ lp=lp*0.995+(Math.random()*2-1)*0.005; d[i]=lp*3.2; }
      amb.buffer=b; amb.loop=true;
    }
    const ag=ac.createGain(); ag.gain.value=0.35; amb.connect(ag).connect(dest); amb.start();
    const t0=ac.currentTime+0.35;
    for(const s of STRIKES){
      const src=ac.createBufferSource(); src.buffer=CLICK;
      const g=ac.createGain(); g.gain.value=s.g*0.95;
      src.connect(g).connect(dest); src.start(t0+s.t);
    }
    const rec=new MediaRecorder(dest.stream,{mimeType:'audio/webm;codecs=opus'});
    const chunks=[]; rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    const stopped=new Promise(r=>rec.onstop=r);
    rec.start(1000);
    await new Promise(r=>setTimeout(r, DUR*1000));
    rec.stop(); await stopped;
    const buf=await new Blob(chunks,{type:'audio/webm'}).arrayBuffer();
    let s=''; const u=new Uint8Array(buf);
    for(let i=0;i<u.length;i+=8192) s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));
    return btoa(s);
  },{STRIKES,DUR});
  await browser.close();
  fs.writeFileSync(OUT, Buffer.from(b64,'base64'));
  fs.writeFileSync(path.join(__dirname,'fixtures','dynamics-truth.json'),
    JSON.stringify({plan:PLAN,strikes:STRIKES,duration:DUR},null,1));
  console.log('  wrote '+OUT+'  '+(fs.statSync(OUT).size/1024).toFixed(0)+' KB, '+
              STRIKES.length+' strikes from '+Math.min(...STRIKES.map(s=>s.g))+' to '+
              Math.max(...STRIKES.map(s=>s.g)));
})().catch(e=>{console.error(e);process.exit(1);});
