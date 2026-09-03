/* Records the test fixture: a synthetic match with a real soundtrack, so the
   whole pipeline — strike detection, clustering, the picture pass — can be run
   against a real decoded file rather than a tensor somebody made up.

   Recorded in real time by Chromium's own MediaRecorder because playwright's
   bundled ffmpeg is built with no audio encoder at all. Takes about a minute.
   Wall-clock driven, so the media clock still matches the plan if a frame is
   late.  node test/make-fixture.js  */
/* A synthetic match WITH a soundtrack, recorded in real time by Chromium's
   own MediaRecorder — the bundled ffmpeg has no audio encoder. Wall-clock
   driven, so the media clock matches the plan even if rendering stutters. */
const {chromium}=require('./playwright.js');
const fs=require('fs'), path=require('path');
const OUT=path.join(__dirname,'fixtures','match-av.webm');

const PLAN=[
  {start:3,  end:11, type:'rally'},
  {start:15, end:21, type:'adjacent'},
  {start:25, end:34, type:'rally'},
  {start:38, end:43, type:'walk'},
  {start:47, end:55, type:'rally'},
];
const DUR=58;
function strikes(){
  const o=[]; let s=20260903;
  const R=()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for(const p of PLAN){
    if(p.type==='walk') continue;                  // nobody is hitting anything
    for(let t=p.start+0.6;t<p.end-0.4;t+=0.8+R()*0.35) o.push(Math.round(t*100)/100);
  }
  return o.sort((a,b)=>a-b);
}
const STRIKES=strikes();

(async()=>{
  fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required',
          '--disable-background-timer-throttling','--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows','--use-gl=swiftshader']});
  const page=await browser.newPage();
  page.on('pageerror',e=>console.log('  [pageerror] '+e.message));
  await page.setContent('<body style="margin:0"><canvas id=c width=320 height=180></canvas></body>');

  console.log('  recording '+DUR+'s in real time…');
  const b64=await page.evaluate(async({PLAN,STRIKES,DUR})=>{
    const c=document.getElementById('c'), x=c.getContext('2d'), W=c.width, H=c.height;
    const ac=new AudioContext({sampleRate:48000});
    const dest=ac.createMediaStreamDestination();

    // a struck ball: 6ms of noise, hard attack, fast decay — broadband, like the real thing
    const mk=(ms,gain)=>{ const n=Math.round(ac.sampleRate*ms/1000);
      const b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,6)*gain;
      return b; };
    const CLICK=mk(6,0.95);
    // court ambience: wind and distant traffic, all low frequency
    const amb=ac.createBufferSource(); {
      const n=ac.sampleRate*4, b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
      let lp=0; for(let i=0;i<n;i++){ lp=lp*0.995+(Math.random()*2-1)*0.005; d[i]=lp*3.2; }
      amb.buffer=b; amb.loop=true;
    }
    const ag=ac.createGain(); ag.gain.value=0.35; amb.connect(ag).connect(dest); amb.start();

    const t0=ac.currentTime+0.35;
    for(const t of STRIKES){
      const s=ac.createBufferSource(); s.buffer=CLICK;
      const g=ac.createGain(); g.gain.value=0.75+Math.random()*0.25;
      s.connect(g).connect(dest); s.start(t0+t);
    }
    // players chatting through the dead time, to give the audio detector something to reject
    for(const p of PLAN){
      if(p.type!=='adjacent') continue;
      for(let t=p.start;t<p.end;t+=0.55){
        const o=ac.createOscillator(), g=ac.createGain();
        o.frequency.value=110+Math.random()*90; o.type='sawtooth';
        g.gain.value=0.0001; g.gain.linearRampToValueAtTime(0.05,t0+t+0.05);
        g.gain.linearRampToValueAtTime(0.0001,t0+t+0.4);
        o.connect(g).connect(dest); o.start(t0+t); o.stop(t0+t+0.45);
      }
    }

    const stream=new MediaStream([...c.captureStream(30).getVideoTracks(),
                                  ...dest.stream.getAudioTracks()]);
    const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:900000});
    const chunks=[];
    rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    const stopped=new Promise(r=>rec.onstop=r);

    let seed=4242;
    const R=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
    const draw=(t)=>{
      const seg=PLAN.find(s=>t>=s.start&&t<=s.end);
      const shx=Math.round(2.5*Math.sin(t*1.7)+1.5*Math.sin(t*0.6));
      const shy=Math.round(1.8*Math.sin(t*1.1+1));
      x.save(); x.translate(shx,shy);
      x.fillStyle='#2f6b3a'; x.fillRect(-8,-8,W+16,H+16);
      x.fillStyle='#3a7d47'; x.fillRect(30,45,W-60,H-70);
      x.strokeStyle='#e8f0e8'; x.lineWidth=2;
      x.strokeRect(30,45,W-60,H-70); x.beginPath(); x.moveTo(W/2,45); x.lineTo(W/2,H-25); x.stroke();
      seed=4242; for(let i=0;i<260;i++){ const px=(R()*W)|0, py=(R()*H)|0;
        x.fillStyle='rgba(0,0,0,'+(0.05+R()*0.06).toFixed(3)+')'; x.fillRect(px,py,2,2); }
      const near=STRIKES.some(s=>Math.abs(s-t)<0.10);
      const draww=(cx,cy,w,h,col)=>{ x.fillStyle=col; x.fillRect(cx-w/2,cy-h,w,h); };
      if(seg&&seg.type==='rally'){
        const ph=t-seg.start;
        draww(95+18*Math.sin(ph*3.1),130+10*Math.sin(ph*1.3),16+(near?8:0),46,'#f2f2f2');
        draww(225+18*Math.sin(ph*3.1+2.2),128+10*Math.sin(ph*1.1+1),16+(near?8:0),46,'#1d2b4a');
        const bx=160+120*Math.sin(ph*3.6), by=100-22*Math.abs(Math.sin(ph*3.6));
        x.fillStyle='#f5e642'; x.beginPath(); x.arc(bx,by,4,0,7); x.fill();
      } else if(seg&&seg.type==='walk'){
        const ph=t-seg.start;
        draww(95+26*ph/5,130,16,46,'#f2f2f2'); draww(225,128,16,46,'#1d2b4a');
      } else {
        draww(95+0.4*Math.sin(t*0.7),130,16,46,'#f2f2f2');
        draww(225+0.4*Math.sin(t*0.5),128,16,46,'#1d2b4a');
      }
      x.restore();
      const im=x.getImageData(0,0,W,H), dd=im.data;
      for(let i=0;i<dd.length;i+=4){ const nz=(Math.random()*10)-5; dd[i]+=nz; dd[i+1]+=nz; dd[i+2]+=nz; }
      x.putImageData(im,0,0);
    };

    draw(0);
    rec.start(1000);
    const wall0=performance.now();
    await new Promise(res=>{
      const loop=()=>{
        const t=(performance.now()-wall0)/1000;
        if(t>=DUR){ res(); return; }
        draw(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    rec.stop(); await stopped;
    const blob=new Blob(chunks,{type:'video/webm'});
    const buf=await blob.arrayBuffer();
    let s=''; const u=new Uint8Array(buf);
    for(let i=0;i<u.length;i+=8192) s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));
    return btoa(s);
  },{PLAN,STRIKES,DUR});

  await browser.close();
  fs.writeFileSync(OUT, Buffer.from(b64,'base64'));
  fs.writeFileSync(path.join(__dirname,'fixtures','truth-av.json'),
    JSON.stringify({plan:PLAN,strikes:STRIKES,duration:DUR},null,1));
  console.log('  wrote '+OUT+'  '+(fs.statSync(OUT).size/1024).toFixed(0)+' KB, '+STRIKES.length+' strikes');
})().catch(e=>{console.error(e);process.exit(1);});
