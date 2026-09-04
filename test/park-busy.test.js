/* The per-park busyness model, run against the code as it is shipped in
   index.html.  node test/park-busy.test.js

   The model is a model — most of what it says is a judgement call and there is
   nothing to check it against. What IS checkable is that it never says
   something false about the world: that the sun sets after it rises wherever
   you read the page from, that an unlit court goes dark at dusk, that a park
   with no winter play is not offered to you in January, and that it never
   claims more free courts than the park has. Those are the tests.            */
/* The parks are in Toronto and so are the numbers, so the test pins the zone
   rather than inheriting whatever the machine running it happens to be on. */
process.env.TZ = 'America/Toronto';

const {loadParkBusy} = require('./extract.js');

let pass=0, fail=0;
const ok=(c,m,extra)=>{ if(c){pass++;console.log('  ok   '+m);} else {fail++;console.log('  FAIL '+m+(extra?'   ['+extra+']':''));} };
const near=(a,b,tol)=>Math.abs(a-b)<=tol;

const M = loadParkBusy();

/* a park, shaped the way the court table shapes them */
const park = o => Object.assign({
  name:"Test Park", addr:"1 Test St", courts:4, lit:false, access:0, club:"",
  winter:false, lat:43.68, lon:-79.39
}, o);

const TORONTO = { lat:43.68, lon:-79.39 };
const hm = t => Math.floor(t)+":"+String(Math.round((t%1)*60)).padStart(2,'0');

/* ------------------------------------------------------------------ the sun */
console.log('\n# sunrise and sunset');
/* published Toronto times, EST/EDT as the day falls */
[['2026-03-21', 7+21/60, 19+30/60],
 ['2026-06-21', 5+35/60, 21+ 2/60],
 ['2026-09-04', 6+43/60, 19+50/60],
 ['2026-12-21', 7+48/60, 16+43/60]].forEach(([d,rise,set])=>{
  const s = M.pbSun(new Date(d+'T12:00:00'), TORONTO.lat, TORONTO.lon);
  ok(near(s.sunrise, rise, 0.09), d+' sunrise '+hm(s.sunrise)+' ≈ '+hm(rise));
  ok(near(s.sunset,  set,  0.09), d+' sunset  '+hm(s.sunset)+' ≈ '+hm(set));
});

/* The one that bit: a June sunset in Toronto is after midnight UTC, so reading
   each time's own local clock hour gave a sunset of 1am, "before" sunrise, and
   an empty daylight window for every unlit court in the city. It has to hold
   for a reader in any timezone, not just this one. */
console.log('\n# sunset is always after sunrise, wherever the page is read');
['America/Toronto','UTC','Europe/Berlin','Australia/Sydney','America/Vancouver'].forEach(zone=>{
  process.env.TZ = zone;
  const Z = loadParkBusy();          // a fresh copy, so nothing is cached across zones
  let worst = null, bad = 0;
  for(let d=0; d<365; d++){
    const day = new Date(2026, 0, 1+d);
    const s = Z.pbSun(day, TORONTO.lat, TORONTO.lon);
    const len = s.sunset - s.sunrise;
    if(!(len > 8 && len < 16)){ bad++; worst = day.toDateString()+' len '+len.toFixed(2); }
  }
  ok(bad===0, 'every day of 2026 has a sane daylight window, read from '+zone, worst||'');
  process.env.TZ = 'America/Toronto';
});

/* --------------------------------------------------------------- daylight */
console.log('\n# lights are what separate one park from another after dusk');
{
  const sept = new Date('2026-09-04T12:00:00');
  const unlit = park({lit:false}), lit = park({lit:true});
  const cu = M.pbDayCurve(unlit, 5, sept), cl = M.pbDayCurve(lit, 5, sept);
  ok(cu[19] > 0,  'unlit court still playable at 7pm (sunset 7:50)');
  ok(cu[21] === 0,'unlit court is dark at 9pm');
  ok(cl[21] > 0,  'lit court is not');
  ok(cl[23] === 0,'and lit play still stops at lights-out');
  ok(cu[4] === 0 && cl[4] === 0, 'nobody is on court at 4am');

  const dec = new Date('2026-12-18T12:00:00');   // sunset 4:43pm
  const cud = M.pbDayCurve(park({lit:false, winter:true}), 5, dec);
  const cld = M.pbDayCurve(park({lit:true, winter:true}), 5, dec);
  ok(cud[18] === 0,           'in December the unlit court is dark by 6pm');
  ok(cud[17] < cld[17]/5,     'and the 5pm hour is mostly gone — the sun sets inside it');
  ok(cld[18] > 0,             'a lit one plays through the same evening');
}

/* ----------------------------------------------------------------- season */
console.log('\n# the season');
{
  ok(M.pbSeasonMult(park({winter:false}), 6) === 1, 'July is the full season');
  ok(M.pbSeasonMult(park({winter:false}), 11) === 0, 'December closes a summer-only site');
  ok(M.pbSeasonMult(park({winter:true}),  11) > 0,  'a winter-play site stays open');

  /* pbWeek always works from today, so drive the closure through the curve it
     is built out of rather than pretending the clock has moved */
  const dec = new Date('2026-12-18T12:00:00');
  const summerOnly = M.pbDayCurve(park({lit:true, winter:false}), 5, dec);
  ok(Math.max.apply(null, summerOnly) === 0, 'a summer-only site has no playable hour in December');
  const winterSite = M.pbDayCurve(park({lit:true, winter:true}), 5, dec);
  ok(Math.max.apply(null, winterSite) > 0,   'a winter-play site still does');
}

/* ------------------------------------------------------- percent vs. full */
console.log('\n# percent of peak is within-park; "full" is what compares');
{
  const c = park({name:"Cmp", lit:true, winter:true, courts:6});
  const w = M.pbWeek(c);
  let bad = 0;
  w.pct.forEach(day => day.forEach(v => { if(v < 0 || v > 100 || !Number.isInteger(v)) bad++; }));
  ok(bad === 0, 'every hour of the week is an integer 0-100');
  ok(Math.max.apply(null, w.pct.map(d=>Math.max.apply(null,d))) === 100,
     'the park peaks at exactly 100% of its own peak');

  let over = 0;
  w.pct.forEach(day => day.forEach(v => {
    const free = M.pbFreeCourts(c, v, w.peakOcc);
    if(free < 0 || free > c.courts) over++;
  }));
  ok(over === 0, 'free courts never go negative or exceed the court count');
  ok(M.pbFreeCourts(c, 0, w.peakOcc) === c.courts, 'an empty hour leaves every court free');
}

/* ------------------------------------------------------------- occupancy */
console.log('\n# occupancy knows what month it is, percent of peak does not');
{
  const c = park({name:"Seas", lit:true, winter:true, courts:6});
  const july = M.pbWeek(c);            // cached per calendar day, so vary the park
  /* pbWeek caches on today's date; compare the two ceilings directly instead */
  const summer = M.pbSeasonMult(c, 6), winter = M.pbSeasonMult(c, 0);
  ok(summer > winter, 'a January evening is not as full as a July one ('+summer+' vs '+winter+')');
  ok(july.peakOcc > 0 && july.peakOcc <= 0.95, 'the occupancy ceiling stays under 100%', String(july.peakOcc));
  ok(M.pbOcc(100, 0.84) === 84 && M.pbOcc(0, 0.84) === 0, 'occupancy scales percent of peak');
}

/* ------------------------------------------------------------------ verdicts */
console.log('\n# what it tells you');
{
  ok(M.pbVerdict(5).t  === 'Wide open',  'an empty park reads empty');
  ok(M.pbVerdict(95).t === 'Packed',     'a full one reads full');
  ok(M.pbVerdict(null).t === 'Closed',   'and no reading is not a quiet park');

  /* The other one that bit. At 11pm every court at an unlit park is technically
     free, and "Wide open · ~12 of 12 free" is exactly the wrong thing to put in
     front of somebody standing in the dark. Freeze the clock there and check
     the row says so. */
  const _Date = global.Date;
  const at = iso => {
    const fixed = new _Date(iso).getTime();
    global.Date = class extends _Date {
      constructor(...a){ if(!a.length) super(fixed); else super(...a); }
      static now(){ return fixed; }
    };
  };
  try{
    at('2026-07-15T23:30:00-04:00');
    const N = loadParkBusy();
    const b = N.pbNow(park({name:"Dark", lit:false, winter:true, courts:12}));
    ok(b.dark === true,                'an unlit park at 11:30pm is dark, not quiet');
    ok(b.verdict.t !== 'Wide open',    'and it does not read as wide open', b.verdict.t);
    ok(/^opens /.test(b.next||''),     'it says when it opens instead', String(b.next));
    ok(b.occ === 0,                    'with nothing pretending to be a busyness reading');

    at('2026-07-15T19:00:00-04:00');
    const D = loadParkBusy();
    const day = D.pbNow(park({name:"Day", lit:false, winter:true, courts:12}));
    ok(day.dark === false && day.occ > 0, 'the same park at 7pm is an ordinary busy park');
    ok(day.free >= 0 && day.free <= 12,   'and its free-court count is inside the park');
  } finally { global.Date = _Date; }
}

/* ------------------------------------------------------------------ weather */
console.log('\n# weather only ever makes a court quieter');
{
  const wet = loadParkBusy({ wx:{code:63, precip:4, temp:9, wind:10},
                             wxCategory:()=> 'heavyRain' });
  const m = wet.pbWeatherMult();
  ok(m.mult < 1 && m.mult > 0, 'heavy rain pulls the number down, not up', String(m.mult));
  ok(M.pbWeatherMult().mult === 1, 'and with no reading it changes nothing');
}

/* -------------------------------------------------- the one real feed we have */
console.log('\n# the home court reads its real curve, not the model');
{
  const graph = { friday:[{time:"6 a.m.", busyness_score:55},{time:"7 p.m.", busyness_score:100}] };
  const H = loadParkBusy({
    home: "165 grenoble dr",
    courtState: { data:{ popular_times:{ graph_results:graph } }, live:false }
  });
  const home = park({name:"Home", addr:"165 Grenoble Dr", lit:true, winter:true});
  ok(H.pbIsHome(home) === true, 'the home row is matched on its street address');
  const w = H.pbHomeWeek();
  ok(w && w.real === true, 'and it comes back flagged as real');
  ok(w.pct[5][6] === 55 && w.pct[5][19] === 100, "Google's own numbers survive the trip");
  ok(H.pbHomeWeek.call(null) !== undefined, 'no feed is handled without throwing');

  const none = loadParkBusy({ home:"165 grenoble dr", courtState:{data:null, live:false} });
  ok(none.pbHomeWeek() === null, 'and with the feed down it falls back to the model');
  ok(none.pbNow(home).real === false, 'which the row then labels as modelled');
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail ? 1 : 0);
