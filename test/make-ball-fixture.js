/* The case the ball pass exists for, built so it can only be solved by
   looking at the picture:

     3-20s   ONE rally. The ball never stops moving. But the soundtrack goes
             silent from 9s to 15s — the far-side returns nobody's microphone
             picked up. Audio alone must cut this into two clips.
     26-33s  A real gap. Nobody is playing, nothing is moving, no ball.
     33-42s  A second rally whose LAST five seconds are silent. Audio alone
             must end it around 38, five seconds early, with nothing after it
             to bridge to.

   A pass that joins clips whenever there is a gap would join 26-33 too and be
   wrong. A pass that joins nothing leaves the first rally in halves. Only
   something that actually finds the ball gets both right.

   node test/make-ball-fixture.js  (~1 min, needs playwright + chromium) */
const {chromium}=require('./playwright.js');
const fs=require('fs'), path=require('path');
const OUT=path.join(__dirname,'fixtures','ball.webm');

const RALLIES=[{start:3,end:20},{start:33,end:42}];
/* Two separate ways a rally goes quiet:
     9-15s   the MIDDLE of a rally — needs the two halves bridging
     37-42s  the END of one — needs the clip stretching, and there is no later
             clip to bridge to, which is exactly the case that started this */
const SILENT=[{start:9,end:15},{start:37,end:42}];
const DUR=46;
function strikes(){
  const o=[]; let s=8123;
  const R=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for(const p of RALLIES){
    for(let t=p.start+0.8;t<p.end-0.3;t+=0.85+R()*0.3){
      if(SILENT.some(q=>t>=q.start&&t<=q.end)) continue;
      o.push(Math.round(t*100)/100);
    }
  }
  return o.sort((a,b)=>a-b);
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
  const b64=await page.evaluate(async({RALLIES,STRIKES,DUR})=>{
    const c=document.getElementById('c'), x=c.getContext('2d'), W=c.width, H=c.height;
    const ac=new AudioContext({sampleRate:48000});
    const dest=ac.createMediaStreamDestination();
    const mk=(ms,g)=>{ const n=Math.round(ac.sampleRate*ms/1000);
      const b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,6)*g; return b; };
    const CLICK=mk(6,0.95);
    const amb=ac.createBufferSource(); {
      const n=ac.sampleRate*4, b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      let lp=0; for(let i=0;i<n;i++){ lp=lp*0.995+(Math.random()*2-1)*0.005; d[i]=lp*3.0; }
      amb.buffer=b; amb.loop=true;
    }
    const ag=ac.createGain(); ag.gain.value=0.3; amb.connect(ag).connect(dest); amb.start();
    const t0=ac.currentTime+0.35;
    for(const t of STRIKES){
      const s=ac.createBufferSource(); s.buffer=CLICK;
      const g=ac.createGain(); g.gain.value=0.8+Math.random()*0.2;
      s.connect(g).connect(dest); s.start(t0+t);
    }
    const stream=new MediaStream([...c.captureStream(30).getVideoTracks(),
                                  ...dest.stream.getAudioTracks()]);
    const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1400000});
    const chunks=[]; rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    const stopped=new Promise(r=>rec.onstop=r);
    let seed=99;
    const R=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
    const draw=(t)=>{
      const seg=RALLIES.find(s=>t>=s.start&&t<=s.end);
      x.fillStyle='#2c5f36'; x.fillRect(0,0,W,H);
      x.fillStyle='#3a7d47'; x.fillRect(26,44,W-52,H-70);
      x.strokeStyle='#e8f0e8'; x.lineWidth=1.6; x.strokeRect(26,44,W-52,H-70);
      x.beginPath(); x.moveTo(26,104); x.lineTo(W-26,104); x.stroke();
      seed=4242;
      for(let i=0;i<240;i++){ const px=(R()*W)|0, py=(R()*H)|0;
        x.fillStyle='rgba(0,0,0,'+(0.05+R()*0.06).toFixed(3)+')'; x.fillRect(px,py,2,2); }
      if(seg){
        const ph=t-seg.start;
        x.fillStyle='#f2f2f2'; x.fillRect(140+16*Math.sin(ph*2.6)-9, 108, 18, 44);
        x.fillStyle='#1d2b4a'; x.fillRect(160+11*Math.sin(ph*2.6+2.1)-5, 56, 10, 26);
        /* the ball: never stops, whatever the soundtrack is doing */
        const u=(Math.sin(ph*3.1)+1)/2;
        const bx=(1-u)*70+u*(W-70), by=96-30*Math.abs(Math.sin(ph*3.1));
        x.fillStyle='#f7ef4a'; x.beginPath(); x.arc(bx,by,3.4,0,7); x.fill();
      } else {
        x.fillStyle='#f2f2f2'; x.fillRect(140-9,108,18,44);
        x.fillStyle='#1d2b4a'; x.fillRect(160-5,56,10,26);
      }
      const im=x.getImageData(0,0,W,H), dd=im.data;
      for(let i=0;i<dd.length;i+=4){ const nz=(Math.random()*8)-4; dd[i]+=nz; dd[i+1]+=nz; dd[i+2]+=nz; }
      x.putImageData(im,0,0);
    };
    draw(0); rec.start(1000);
    const w0=performance.now();
    await new Promise(res=>{ const loop=()=>{ const t=(performance.now()-w0)/1000;
      if(t>=DUR){res();return;} draw(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    rec.stop(); await stopped;
    const buf=await new Blob(chunks,{type:'video/webm'}).arrayBuffer();
    let s=''; const u=new Uint8Array(buf);
    for(let i=0;i<u.length;i+=8192) s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));
    return btoa(s);
  },{RALLIES,STRIKES,DUR});
  await browser.close();
  fs.writeFileSync(OUT, Buffer.from(b64,'base64'));
  fs.writeFileSync(path.join(__dirname,'fixtures','ball-truth.json'),
    JSON.stringify({rallies:RALLIES, silent:SILENT, strikes:STRIKES, duration:DUR},null,1));
  console.log('  wrote '+OUT+'  '+(fs.statSync(OUT).size/1024).toFixed(0)+' KB, '+
              STRIKES.length+' audible strikes; silent 9-15s (mid-rally) and 37-42s (end of one)');
})().catch(e=>{console.error(e);process.exit(1);});
