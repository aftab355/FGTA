/* The picture pass's judgement, over synthetic tensors, run against the code
   as it is shipped in index.html.  node test/vision-core.test.js  */
const {avROI,avSeries,avApply,AV_DEF}=require('./extract.js').loadCore();
const {build}=require('./tensors.js');

let pass=0,fail=0;
const ok=(c,m,extra)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(extra?'   ['+extra+']':''));} };

function run(name,plan,check,seed){
  const S=build(plan,seed);
  const roi=avROI(S.grid,S.n);
  const ser=avSeries(S.grid,S.n,roi);
  const res=avApply(S.segs,S.T,S.dt,ser,S.strikes);
  console.log('\n# '+name+'   roi x'+roi.x0+'-'+roi.x1+' y'+roi.y0+'-'+roi.y1+
              ' mid='+roi.mid+' useBoth='+res.useBoth+' inconclusive='+res.inconclusive);
  res.per.forEach((r,i)=>console.log('   seg'+(i+1)+' '+S.segs[i].type.padEnd(9)+
    ' conf='+(r.conf==null?'--':r.conf.toFixed(2))+
    ' A='+(r.A!=null?r.A.toFixed(2):'-')+' B='+(r.B!=null?r.B.toFixed(2):'-')+
    ' C='+(r.C!=null?r.C.toFixed(2):'-')+'  '+r.reason));
  check(res,S,roi,ser);
}

const T=AV_DEF.thresh;

run('mixed match: real rallies, next court over, someone walking back',[
  {start:5,  end:14, type:'rally'},
  {start:20, end:26, type:'adjacent'},
  {start:32, end:41, type:'rally'},
  {start:47, end:52, type:'walk'},
  {start:58, end:70, type:'rally'},
  {start:76, end:82, type:'adjacent'},
], (res,S)=>{
  ok(!res.inconclusive,'pass is conclusive');
  S.segs.forEach((s,i)=>{
    const c=res.per[i].conf;
    if(s.type==='rally') ok(c>=T,'rally '+(i+1)+' kept', 'conf='+c.toFixed(2));
    if(s.type==='adjacent') ok(c<T,'next-court '+(i+1)+' dropped','conf='+c.toFixed(2));
    if(s.type==='walk') ok(c<T,'walk-back dropped','conf='+c.toFixed(2));
  });
  ok(res.drops===3,'exactly the 3 junk clips pre-dropped','drops='+res.drops);
});

run('a tree in shot, and the next court busy behind it',[
  {start:4,  end:13, type:'rally'},
  {start:19, end:27, type:'wind'},
  {start:33, end:42, type:'rally'},
  {start:48, end:55, type:'wind'},
], (res)=>{
  ok(res.per[0].conf>=T && res.per[2].conf>=T,'both real rallies kept');
  ok(res.per[1].conf<T && res.per[3].conf<T,'wind-only clips dropped');
});

run('long continuous rallies — C must not punish steady motion',[
  {start:5,  end:38, type:'rally'},
  {start:44, end:74, type:'rally'},
  {start:80, end:88, type:'adjacent'},
], (res)=>{
  ok(res.per[0].conf>=T && res.per[1].conf>=T,'30s rallies survive');
  ok(res.per[2].conf<T,'next-court still dropped');
});

run('camera behind one player — bilateral test must switch itself off',[
  {start:5,  end:14, type:'rally-far'},
  {start:20, end:29, type:'rally-far'},
  {start:35, end:41, type:'adjacent'},
  {start:47, end:56, type:'rally-far'},
], (res)=>{
  ok(res.useBoth===false,'B disabled — the framing cannot show both halves');
  ok(res.per[0].conf>=T && res.per[1].conf>=T && res.per[3].conf>=T,'one-sided rallies still kept');
  ok(res.per[2].conf<T,'next-court still dropped');
});

run('locked-off wide shot where nobody is more than a few pixels',[
  {start:5,  end:14, type:'tiny'},
  {start:20, end:29, type:'tiny'},
  {start:35, end:44, type:'tiny'},
], (res)=>{
  ok(res.inconclusive,'declares itself blind');
  ok(res.drops===0,'and drops nothing');
});

run('every candidate is the next court (nothing of yours on camera)',[
  {start:5,  end:14, type:'adjacent'},
  {start:20, end:29, type:'adjacent'},
], (res)=>{
  ok(res.inconclusive,'declares itself blind rather than confidently keeping junk');
});


/* ---- not fitted to one random draw ---- */
{
  const {avROI,avSeries,avApply,AV_DEF}=require('./extract.js').loadCore();
  const plan=[{start:5,end:14,type:'rally'},{start:20,end:26,type:'adjacent'},
              {start:32,end:41,type:'rally'},{start:47,end:52,type:'walk'},
              {start:58,end:70,type:'rally'},{start:76,end:82,type:'adjacent'},
              {start:88,end:97,type:'rally'},{start:103,end:110,type:'wind'}];
  const want=['keep','drop','keep','drop','keep','drop','keep','drop'];
  let bad=0, worstKeep=1, bestDrop=0;
  for(let seed=1;seed<=24;seed++){
    const S=build(plan,seed);
    const roi=avROI(S.grid,S.n), ser=avSeries(S.grid,S.n,roi);
    const res=avApply(S.segs,S.T,S.dt,ser,S.strikes);
    if(res.inconclusive){ bad++; continue; }
    res.per.forEach((r,i)=>{
      const got=r.conf>=AV_DEF.thresh?'keep':'drop';
      if(want[i]==='keep') worstKeep=Math.min(worstKeep,r.conf); else bestDrop=Math.max(bestDrop,r.conf);
      if(got!==want[i]) bad++;
    });
  }
  console.log('\n# 24 seeds x 8 clips');
  console.log('   worst real rally  conf='+worstKeep.toFixed(2)+
              '   best junk clip conf='+bestDrop.toFixed(2)+
              '   threshold='+AV_DEF.thresh);
  ok(bad===0,'192 verdicts, no misclassifications','wrong='+bad);
  ok(worstKeep-bestDrop>0.15,'margin either side of the threshold is not knife-edge',
     'margin='+(worstKeep-bestDrop).toFixed(2));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
