/* Pulls a sentinel-delimited region straight out of index.html so the tests
   run the shipped code rather than a copy of it that can drift. If a sentinel
   moves, this throws rather than silently testing nothing. */
const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..','index.html');

function region(name){
  const src=fs.readFileSync(APP,'utf8');
  const a=`/* ==== ${name}-START ====`, b=`/* ==== ${name}-END ==== */`;
  const i=src.indexOf(a), j=src.indexOf(b);
  if(i<0) throw new Error('sentinel '+a+' not found in index.html');
  if(j<i) throw new Error('sentinel '+b+' not found after '+a);
  return src.slice(i, j+b.length);
}
function loadCore(){
  const code=region('AV-CORE');
  const names=['AV_GX','AV_GY','AV_CELLS','AV_DEF','avPct','avMedian','avMad','avClamp',
               'avROI','avSeries','avCorr','avStrikeTrain','avSync','avMeasure','avScore','avApply'];
  return new Function(code+'\nreturn {'+names.join(',')+'};')();
}
module.exports={region,loadCore,APP};
