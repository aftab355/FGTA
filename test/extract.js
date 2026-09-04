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
function loadAudio(){
  const code=region('AC-CORE');
  const names=['acEnvelope','acOnsetStrength','acPercentile','acNoiseFloor',
               'acPickOnsets','acCluster','acSegments'];
  return new Function('const AC_HOP_MS=10;\n'+code+'\nreturn {'+names.join(',')+'};')();
}
function loadBall(){
  const code=region('AV-BALL');
  const names=['abGaps','abTails','abWindows','abBlobs','abTrack','abExtend','abBridge'];
  return new Function('const AB_W=256,AB_H=144,AB_PIX=16,AB_MIN=2,AB_MAX=70,AB_BOX=18,'+
                      'AB_GATE=40,AB_MINSTEP=2.2,AB_MINLEN=3,AB_MAXGAP=9,AB_PAD=1.0,AB_REACH=5;\n'+
                      code+'\nreturn {'+names.join(',')+'};')();
}
function loadScore(){
  const code=region('SCORE-CORE')+'\n'+region('SCORE-ASSIGN');
  const names=['scGameLengths','scRuns','scSplit','scFrame','scExpectedGames',
               'scExpectedRuns','scPartition','scPickSplit','scGameOdds','scHoldOf','scHoldToPoint',
               'scSetOrders','scBestOrder','scScore'];
  return new Function(code+'\nreturn {'+names.join(',')+'};')();
}

/* The park-busyness model. It leans on a handful of things that live outside
   its region — the competition map built from the court table, the shared
   weather read, the home court's own feed — so they come in as stubs the test
   controls rather than as a second copy of the model. */
function loadParkBusy(opts){
  const o = opts || {};
  const code = region('PARK-BUSY');
  const names = ['PB_WEEKDAY','PB_WEEKEND','PB_DOW','PB_SEASON','pbSeasonMult','pbClubMult',
                 'pbSun','pbDaylightFrac','pbDayCurve','pbWeek','pbOcc','pbFreeCourts',
                 'pbWeatherMult','pbNextOpen','pbVerdict','pbIsHome','pbHomeWeek','pbNow'];
  const pre = [
    'const PB_PRESSURE = arguments[0].pressure;',
    'const NEARBY_HOME = arguments[0].home;',
    'const courtState  = arguments[0].courtState;',
    'const CT_DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];',
    'let ctWx = arguments[0].wx;',
    'const CT_WX_ADJUST = { storm:0.35, heavyRain:0.45, rain:0.6, snow:0.5, fog:0.85 };',
    'const ctWxCategory = arguments[0].wxCategory || (()=>"clear");',
    'const ctTempMultiplier = arguments[0].tempMult || (()=>1);',
    'const ctWindMultiplier = arguments[0].windMult || (()=>1);',
    'const ctWxLabel = ()=>null, ctTempLabel = ()=>null, ctWindLabel = ()=>null;',
    'const ctHour24 = l => { const m=String(l).trim().match(/^(\\d{1,2})\\s*([ap])\\.?\\s*m\\.?$/i);' +
      ' if(!m) return null; let h=Number(m[1])%12; if(m[2].toLowerCase()==="p") h+=12; return h; };'
  ].join('\n');
  return new Function(pre+'\n'+code+'\nreturn {'+names.join(',')+'};')({
    pressure: o.pressure || new Map(),
    home: o.home || "nowhere at all",
    courtState: o.courtState || { data:null, live:false },
    wx: o.wx || null,
    wxCategory: o.wxCategory, tempMult: o.tempMult, windMult: o.windMult
  });
}

module.exports={region,loadCore,loadScore,loadBall,loadAudio,loadParkBusy,APP};
