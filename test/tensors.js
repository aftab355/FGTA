/* Synthetic motion tensors with known ground truth. Not a substitute for
   real footage — see vision-video.test.js for the same questions asked of a
   real decoded video — but it is the only way to ask the awkward ones: a
   recording where NOTHING is on camera, a camera parked behind one player,
   a tree in shot. Every scenario here is a thing the detector got wrong at
   some point. */
/* synthetic motion tensors with known ground truth */
const {AV_GX,AV_CELLS}=require('./extract.js').loadCore();
const FPS=15;
function rnd(seed){ let s=seed; return ()=>((s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff); }

// cell blocks
const box=(x0,x1,y0,y1)=>{const o=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)o.push(y*AV_GX+x);return o;};
const LEFT=box(4,6,4,6), RIGHT=box(9,11,4,6), BALL=box(7,8,3,5);
const TREE=box(14,15,0,1), NEAR=box(0,1,7,8);

function build(plan,seed=7){
  const R=rnd(seed);
  const dur=plan.reduce((a,s)=>Math.max(a,s.end),0)+3;
  const n=Math.round(dur*FPS);
  const grid=new Float64Array(n*AV_CELLS);
  const T=new Float64Array(n), shift=new Float64Array(n);
  const strikes=[];
  for(let k=0;k<n;k++){ T[k]=k/FPS; shift[k]=R()*0.4; }

  const hit=(k,cells,amp)=>{ const b=k*AV_CELLS; for(const c of cells) grid[b+c]+=amp*(0.6+0.8*R()); };

  for(let k=0;k<n;k++) hit(k,Array.from({length:AV_CELLS},(_,i)=>i),0.8); // sensor noise everywhere

  for(const s of plan){
    // strike train ~ every 0.9s, regardless of type: audio heard them all
    for(let t=s.start+0.4;t<s.end-0.2;t+=0.85+R()*0.3) strikes.push(Math.round(t*100)/100);
    for(let k=0;k<n;k++){
      const t=T[k]; if(t<s.start||t>s.end) continue;
      const nearStrike=strikes.some(x=>Math.abs(x-t)<0.12);
      if(s.type==='rally'){
        hit(k,LEFT, 34+(nearStrike?26:0));
        hit(k,RIGHT,32+(nearStrike?24:0));
        hit(k,BALL, 12);
      } else if(s.type==='rally-far'){          // camera behind one player
        hit(k,LEFT, 40+(nearStrike?30:0));
        hit(k,RIGHT,3);
      } else if(s.type==='walk'){
        hit(k,LEFT, 22);
      } else if(s.type==='wind'){
        hit(k,TREE, 30);
      } else if(s.type==='adjacent'){
        /* the whole point: audio heard a full rally, the frame is empty */
      } else if(s.type==='tiny'){               // locked-off wide shot
        hit(k,LEFT,2.2); hit(k,RIGHT,2.0);
      }
    }
  }
  strikes.sort((a,b)=>a-b);
  const segs=plan.map((s,i)=>({n:i+1,start:s.start,end:s.end,type:s.type}));
  return {grid,n,T,dt:{shift},strikes,segs,dur};
}
module.exports={build,FPS};
