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

/* The command palette's matcher and ranker. Pure by construction — strings
   and plain item records in, scores and an order out — so the whole thing
   loads with no DOM, no app state and no stubs at all. */
function loadPalette(){
  const code=region('CP-CORE');
  const names=['cpNorm','cpIndexable','cpBoundaries','cpFuzzy','cpScore','cpRank',
               'cpSegments','cpRecencyBoost','CP_W','CP_FIELD','CP_MIN_SCORE',
               'CP_RECENT_MAX','CP_RECENT_HALFLIFE_MS'];
  return new Function(code+'\nreturn {'+names.join(',')+'};')();
}

/* The string-decay model. Pure arithmetic plus three readers over match and
   practice rows, so the test hands it rows rather than a database. */
function loadKit(){
  const code=region('KIT-CORE');
  const names=['KIT_STRINGS','KIT_MAT','KIT_FLOOR','KIT_BEDIN_DAYS','KIT_BANDS',
               'KIT_RESTRING_AT','KIT_HORIZON','KIT_RATE_DEFAULT','KIT_MIN_PER_GAME',
               'KIT_MATCH_FALLBACK_MIN','kitTensionClockHours','kitRemaining','kitTension',
               'kitTerms','kitPlayability','kitBinding','kitBand','kitHoursUntil',
               'kitMatchMinutes','kitPracticeMinutes','kitHoursFor','kitWeeklyRate','kitAssess',
               'KIT_WX_REF_C','KIT_WX_LB_PER_C','KIT_WX_MAX_LB','KIT_WX_SENS',
               'kitFeelShift','kitFeelNote'];
  return new Function(code+'\nreturn {'+names.join(',')+'};')();
}

/* The rating engine: margin of victory, the per-player K, and the replay
   that turns a list of matches into a table. Two regions, because
   computeStandings() lives a few hundred lines above the constants it uses
   and moving code to suit a test would be the wrong way round.

   Everything the engine reaches for outside those regions comes in as
   something the caller controls: the match list, the two event filters, and
   the three tuning constants. Nothing is stubbed that the engine actually
   computes. */
function loadElo(opts){
  const o = opts || {};
  const code = region('ELO-ENGINE') + '\n' + region('ELO-STANDINGS');
  const names = ['MOV_ENABLED','MOV_START','MOV_MIN','MOV_MAX','BLOWOUT_FLOOR_START',
                 'BLOWOUT_FLOOR_MULT','movMultiplier','DYNK_ENABLED','DYNK_START','DYNK_STEPS',
                 'DYNK_SETTLED_K','DYNK_MIN','DYNK_MAX','DYNK_RUST','DYNK_RUST_CAP',
                 'DYNK_FULL_GAMES','DYNK_FORMAT_MIN','dynKApplies','formatReliability','playerK',
                 'matchKPair','kTracker','lastPlayedMap','playerLiveK','preGameRatings',
                 'matchKOf','winProb','computeStandings','invalidateStandings'];
  const pre = [
    'const K = ' + (o.K == null ? 32 : o.K) + ';',
    'let DIVISOR = ' + (o.divisor == null ? 400 : o.divisor) + ';',
    'const START = ' + (o.start == null ? 500 : o.start) + ';',
    'let ELO_DRIFT = 0;',
    /* the engine reads a module-level `matches`; the test owns it */
    'let matches = arguments[0].matches;',
    'let tournaments = arguments[0].tournaments || [];',
    'const countsForElo = arguments[0].countsForElo || (() => true);',
    'const countsForAnalysis = arguments[0].countsForAnalysis || (() => true);'
  ].join('\n');
  const api = new Function(pre + '\n' + code +
    '\nreturn {' + names.join(',') +
    ',setMatches:(m)=>{matches=m; invalidateStandings();}, drift:()=>ELO_DRIFT,' +
    ' setDivisor:(d)=>{DIVISOR=d;}, K, START, get DIVISOR(){return DIVISOR;}};')(
      {matches: o.matches || [], tournaments: o.tournaments,
       countsForElo: o.countsForElo,
       countsForAnalysis: o.countsForAnalysis});
  return api;
}

/* The outbox. The classifier is the interesting part — everything else in
   the queue hangs off whether a failure is read as "refused" or "never
   arrived" — and it is pure, so the test hands it errors rather than a
   network. */
function loadOutbox(){
  const code=region('OQ-CORE');
  const names=['OQ_KEY','OQ_MAX','OQ_MAX_AGE_MS','OQ_MAX_ATTEMPTS','OQ_BACKOFF',
               'oqBackoff','oqClassify','oqItem','oqExpired','oqParse','oqDue',
               'oqAfterAttempt','oqSummary'];
  return new Function(code+'\nreturn {'+names.join(',')+'};')();
}

/* The three rating models that are not Elo — Bradley–Terry, the bootstrap
   and PageRank. The bootstrap replays seasons through the real Elo engine,
   so the ELO-ENGINE region comes in with them rather than being stubbed:
   a bootstrap tested against a fake Elo would be testing nothing.

   The render functions in the region are declarations only, so they load
   fine here without a DOM; the test never calls them. */
function loadModels(opts){
  const o = opts || {};
  const code = region('ELO-ENGINE') + '\n' + region('MODELS');
  const names = ['bradleyTerry','bootstrapRatings','pageRankDominance'];
  const pre = [
    'const K = 32;',
    'let DIVISOR = ' + (o.divisor == null ? 400 : o.divisor) + ';',
    'const START = ' + (o.start == null ? 500 : o.start) + ';',
    'let matches = arguments[0].matches;',
    'const countsForElo = arguments[0].countsForElo || (() => true);',
    'const countsForAnalysis = arguments[0].countsForAnalysis || (() => true);'
  ].join('\n');
  return new Function(pre + '\n' + code + '\nreturn {' + names.join(',') +
    ', setMatches:(m)=>{matches=m;}, START, get DIVISOR(){return DIVISOR;}};')(
      {matches: o.matches || [], countsForElo: o.countsForElo,
       countsForAnalysis: o.countsForAnalysis});
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

/* The Robin+ format engine and the forecast that simulates it. The two
   regions are loaded together on purpose: the whole point of the forecast
   is that it settles imagined results with the same rules that settle real
   ones, so a test that gave it its own copy of those rules would be
   testing nothing. Everything the pair reaches outside itself — the match
   table, the ladder, the draw solver — is injected. */
function loadRobinPlus(opts){
  const o = opts || {};
  const code = region('RP-ENGINE') + '\n' + region('RP-FORECAST');
  const names = ['rpGame','rpWinner','rpParseScore','rpRowFlipped','rpSetsFor','rpPoints','rpRecord',
                 'rpRealResult','rpGroupTable','rpH2H','rpRankRows','rpGroupComplete','rpQualification',
                 'rpSplitOnH2H','rpPlayoffPlan','rpPlayoffResolve','rpBracket','rpSnapshot',
                 'rpfMarginModel','rpfMargins','rpfDrawRate','rpfPlay','rpfRunOnce','rpfRunPlayoff',
                 'rpfForecast','rpfSwing','rpRng'];
  const pre = [
    'const DIVISOR = arguments[0].divisor;',
    'const RP_ROUND_QUAL = "qual";',
    'const matches = arguments[0].matches;',
    'const rpShapeOf = arguments[0].shapeOf;',
    'const rpRead = arguments[0].read;',
    'const rpContext = arguments[0].context;',
    'const rpSolveRing = arguments[0].solveRing;',
    'const computeStandings = arguments[0].standings;',
    'const predictiveRating = arguments[0].predictiveRating;',
    'const countsForAnalysis = () => true;',
    'const rpRng = arguments[0].rng;'
  ].join('\n');
  return new Function(pre + '\n' + code + '\nreturn {' + names.join(',') + '};')({
    divisor: o.divisor || 400,
    matches: o.matches || [],
    shapeOf: o.shapeOf || (st => (st && st.shape) || 'ring'),
    read: o.read || (() => null),
    context: o.context || (players => ({
      players, rating: () => 1000, spread: 1, winProb: () => 0.5,
      quality: () => 1, rematch: () => 0, metCount: () => false
    })),
    solveRing: o.solveRing || (players => ({order: players.map((p,i)=>(
      {p1:p, p2:players[(i+1)%players.length], round:'r'+(i+1)}))})),
    standings: o.standings || (() => []),
    predictiveRating: o.predictiveRating || (() => 1000),
    rng: o.rng || (seed => { let a = seed >>> 0; return function(){
      a = (a + 0x6D2B79F5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    }; })
  });
}

/* The two questions an event answers: does it move the ladder, and did it
   happen? They used to be one function and one answer, which is how three
   weeks of cup tennis went missing from every stat in the app. */
function loadEloScope(tournaments){
  const code = region('ELO-SCOPE');
  const names = ['tournamentCountsElo','tournamentCountsStats','tournEloLabel',
                 'countsForElo','countsForAnalysis'];
  return new Function('const tournaments = arguments[0];\n' + code +
                      '\nreturn {' + names.join(',') + '};')(tournaments || []);
}

module.exports={region,loadCore,loadScore,loadBall,loadAudio,loadParkBusy,loadRobinPlus,loadEloScope,loadPalette,loadKit,loadElo,loadOutbox,loadModels,APP};
