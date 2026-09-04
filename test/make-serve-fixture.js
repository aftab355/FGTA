/* A second fixture, for the serve-end measurement: a court in PERSPECTIVE.
   The first fixture films two players side by side, which is useless here —
   near/far only means anything when the near player is several times larger
   in frame, because that size bias is exactly what the measurement has to
   see past.

   Serve ends follow what a camera fixed behind one baseline actually sees:
   near, near, far, far, near, far — because ends change after odd games while
   the serve changes every game, so the serving END moves in pairs.

   node test/make-serve-fixture.js   (~1 min, needs playwright + chromium) */
const {chromium}=require('./playwright.js');
const fs=require('fs'), path=require('path');
const OUT=path.join(__dirname,'fixtures','serve.webm');

const PLAN=[
  {start:3,  end:9,  end_:'near'},
  {start:13, end:19, end_:'near'},
  {start:23, end:29, end_:'far'},
  {start:33, end:39, end_:'far'},
  {start:43, end:49, end_:'near'},
  {start:53, end:59, end_:'far'},
];
const DUR=63;
function strikes(){
  const o=[]; let s=7771;
  const R=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for(const p of PLAN){
    // first contact is the serve, 1.2s in, then a rally
    o.push({t:Math.round((p.start+1.2)*100)/100, serve:true});
    for(let t=p.start+2.2;t<p.end-0.3;t+=0.85+R()*0.3) o.push({t:Math.round(t*100)/100});
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
  await page.setContent('<body style="margin:0"><canvas id=c width=320 height=180></canvas></body>');
  console.log('  recording '+DUR+'s in real time…');

  const b64=await page.evaluate(async({PLAN,STRIKES,DUR})=>{
    const c=document.getElementById('c'), x=c.getContext('2d'), W=c.width, H=c.height;
    const ac=new AudioContext({sampleRate:48000});
    const dest=ac.createMediaStreamDestination();
    const mk=(ms,g)=>{ const n=Math.round(ac.sampleRate*ms/1000);
      const b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,6)*g; return b; };
    const CLICK=mk(6,0.95);
    const amb=ac.createBufferSource(); {
      const n=ac.sampleRate*4, b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      let lp=0; for(let i=0;i<n;i++){ lp=lp*0.995+(Math.random()*2-1)*0.005; d[i]=lp*3.2; }
      amb.buffer=b; amb.loop=true;
    }
    const ag=ac.createGain(); ag.gain.value=0.35; amb.connect(ag).connect(dest); amb.start();
    const t0=ac.currentTime+0.35;
    for(const s of STRIKES){
      const src=ac.createBufferSource(); src.buffer=CLICK;
      const g=ac.createGain(); g.gain.value=0.75+Math.random()*0.25;
      src.connect(g).connect(dest); src.start(t0+s.t);
    }
    const stream=new MediaStream([...c.captureStream(30).getVideoTracks(),
                                  ...dest.stream.getAudioTracks()]);
    const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:900000});
    const chunks=[]; rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    const stopped=new Promise(r=>rec.onstop=r);

    let seed=4242;
    const R=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
    /* perspective: near baseline wide at the bottom, far baseline narrow near
       the top, and a near player about three times the height of the far one */
    const NEAR={y:152, w:22, h:58}, FAR={y:74, w:9, h:22};

    const draw=(t)=>{
      const seg=PLAN.find(s=>t>=s.start&&t<=s.end);
      const shx=Math.round(2.2*Math.sin(t*1.7)+1.3*Math.sin(t*0.6));
      const shy=Math.round(1.5*Math.sin(t*1.1+1));
      x.save(); x.translate(shx,shy);
      x.fillStyle='#2c5f36'; x.fillRect(-8,-8,W+16,H+16);
      x.fillStyle='#3a7d47';
      x.beginPath(); x.moveTo(28,168); x.lineTo(W-28,168); x.lineTo(W-118,62); x.lineTo(118,62); x.closePath(); x.fill();
      x.strokeStyle='#e8f0e8'; x.lineWidth=1.6; x.stroke();
      x.beginPath(); x.moveTo(70,116); x.lineTo(W-70,116); x.stroke();      // net
      x.beginPath(); x.moveTo(W/2,168); x.lineTo(W/2,62); x.stroke();       // centre
      seed=4242;
      for(let i=0;i<240;i++){ const px=(R()*W)|0, py=(R()*H)|0;
        x.fillStyle='rgba(0,0,0,'+(0.05+R()*0.06).toFixed(3)+')'; x.fillRect(px,py,2,2); }

      const serveT = seg ? seg.start+1.2 : null;
      const serving = seg && t>=seg.start+0.3 && t<=seg.start+1.7;   // toss and swing
      const rallying = seg && t>seg.start+1.7;

      const put=(P,cx,lift,col)=>{ x.fillStyle=col;
        x.fillRect(cx-P.w/2, P.y-P.h-lift, P.w, P.h); };

      let nx=W/2-42, fx=W/2+18, nLift=0, fLift=0;
      if(seg){
        const ph=t-seg.start;
        if(serving){
          // the striker moves a lot; the receiver waits
          const k=(t-(seg.start+0.3))/1.4;
          if(seg.end_==='near'){ nx+=26*Math.sin(k*7); nLift=10*Math.sin(k*3.1); fx+=0.5*Math.sin(t); }
          else { fx+=13*Math.sin(k*7); fLift=5*Math.sin(k*3.1); nx+=0.6*Math.sin(t); }
        } else if(rallying){
          nx+=30*Math.sin(ph*3.0); fx+=14*Math.sin(ph*3.0+2.2);
        }
      }
      put(NEAR,nx,nLift,'#f2f2f2');
      put(FAR ,fx,fLift,'#1d2b4a');
      if(seg && rallying){
        const ph=t-seg.start, u=(Math.sin(ph*3.4)+1)/2;
        const bx=(1-u)*(W/2-30)+u*(W/2+10), by=(1-u)*150+u*80;
        x.fillStyle='#f5e642'; x.beginPath(); x.arc(bx,by,3.2,0,7); x.fill();
      }
      x.restore();
      const im=x.getImageData(0,0,W,H), dd=im.data;
      for(let i=0;i<dd.length;i+=4){ const nz=(Math.random()*10)-5; dd[i]+=nz; dd[i+1]+=nz; dd[i+2]+=nz; }
      x.putImageData(im,0,0);
    };

    draw(0); rec.start(1000);
    const w0=performance.now();
    await new Promise(res=>{
      const loop=()=>{ const t=(performance.now()-w0)/1000;
        if(t>=DUR){ res(); return; } draw(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    rec.stop(); await stopped;
    const buf=await new Blob(chunks,{type:'video/webm'}).arrayBuffer();
    let s=''; const u=new Uint8Array(buf);
    for(let i=0;i<u.length;i+=8192) s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));
    return btoa(s);
  },{PLAN,STRIKES,DUR});

  await browser.close();
  fs.writeFileSync(OUT, Buffer.from(b64,'base64'));
  fs.writeFileSync(path.join(__dirname,'fixtures','serve-truth.json'),
    JSON.stringify({plan:PLAN,strikes:STRIKES,duration:DUR},null,1));
  console.log('  wrote '+OUT+'  '+(fs.statSync(OUT).size/1024).toFixed(0)+' KB');
})().catch(e=>{console.error(e);process.exit(1);});
