/* The string model, and the claim underneath it: the hours are already on
   record, so nobody has to guess at them.

   Two things are being checked, and they are different in kind.

   The DECAY CURVE is arithmetic with no ground truth available — nobody has
   put a tension meter on anybody's racket here — so what can be asserted is
   its shape, not its accuracy: monotone in both clocks, bounded at both ends,
   and each material's two clocks arranged so the one that is supposed to run
   out first actually does. Those are exactly the properties a careless retune
   of a constant would break, and they are the properties the panel's ordering
   ("this bed is further gone than that one") actually rests on.

   THE HOURS are a different matter. Those come from real rows, with a stated
   order of preference — the ref's own clock, then the scoreline, then an
   assumption — and every one of those readers has a way to be wrong that
   would put silent nonsense on the page: a ref who never pressed stop, a
   match tiebreak that reads as a fifteen-game set, a practice row from a
   deployment that skipped the `players` migration. All of those are here.

   node test/kit.test.js   (no dependencies) */
const {loadKit} = require('./extract.js');
const K = loadKit();
const {KIT_STRINGS, KIT_FLOOR, KIT_RESTRING_AT, KIT_MIN_PER_GAME,
       KIT_MATCH_FALLBACK_MIN, KIT_RATE_DEFAULT,
       kitTensionClockHours, kitRemaining, kitTension, kitTerms, kitPlayability,
       kitBinding, kitBand, kitHoursUntil, kitMatchMinutes, kitPracticeMinutes,
       kitHoursFor, kitWeeklyRate, kitAssess} = K;

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};
const MATS = Object.keys(KIT_STRINGS);
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 1e-6 : eps);
const DAY = 86400000;
const iso = daysAgo => new Date(Date.now() - daysAgo * DAY).toISOString();

/* ---------------------------------------------------------------- */
section('the curve is bounded — a tension can never read as more than it was strung at');
MATS.forEach(m => {
  ok(near(kitRemaining(m, 0, 0), 1), m + ': a bed off the machine has lost nothing',
     kitRemaining(m, 0, 0).toFixed(4));
  const far = kitRemaining(m, 1e4, 1e5);
  ok(far >= KIT_FLOOR - 1e-9 && far < KIT_FLOOR + 0.02,
     m + ': and it bottoms out at the floor rather than at zero', far.toFixed(4));
  ok(kitRemaining(m, 5, 5) <= 1 && kitRemaining(m, 5, 5) > 0,
     m + ': every reading in between is a fraction of the reference');
});
ok(kitRemaining('poly', -5, -5) === kitRemaining('poly', 0, 0),
   'negative hours and days are clamped, not extrapolated into the future');
ok(kitRemaining('a-string-nobody-has', 4, 4) === kitRemaining('poly', 4, 4),
   'an unknown material falls back to the default rather than throwing');

section('the curve only ever goes one way');
MATS.forEach(m => {
  let monoH = true, monoD = true;
  for(let h = 0; h < 60; h += 0.5){
    if(kitRemaining(m, h + 0.5, 3) > kitRemaining(m, h, 3) + 1e-12) monoH = false;
    if(kitPlayability({material:m, tension:52}, h + 0.5, 3) >
       kitPlayability({material:m, tension:52}, h, 3) + 1e-12) monoH = false;
  }
  for(let d = 0; d < 400; d += 2){
    if(kitRemaining(m, 3, d + 2) > kitRemaining(m, 3, d) + 1e-12) monoD = false;
    if(kitPlayability({material:m, tension:52}, 3, d + 2) >
       kitPlayability({material:m, tension:52}, 3, d) + 1e-12) monoD = false;
  }
  ok(monoH, m + ': more hours never means more tension or a better score');
  ok(monoD, m + ': neither does more time — strings do not tighten in the bag');
});

section('playability spans the whole scale, and the bands cover it');
MATS.forEach(m => {
  const job = {material:m, tension:52};
  ok(near(kitPlayability(job, 0, 0), 100), m + ': a fresh bed reads 100',
     kitPlayability(job, 0, 0).toFixed(2));
  ok(kitPlayability(job, 1e4, 1e4) === 0, m + ': and a finished one reads 0');
});
for(let s = 0; s <= 100; s += 5) ok(!!kitBand(s), 'a score of ' + s + ' has a band');
ok(kitBand(100).key === 'peak' && kitBand(0).key === 'dead',
   'the two ends are named what you would expect');
ok(kitBand(-5).key === 'dead', 'and nothing falls off the bottom of the table');

section('the bed-in is not charged against the string');
{
  /* a bed that has settled but never been hit is still a good bed — it is
     what "strung at 52" has always meant. The first draft charged the ~10%
     settling loss to playability and reported a new racket as a third gone. */
  const job = {material:'poly', tension:52};
  const settled = kitPlayability(job, 0, 3);       // three days, no tennis
  ok(settled > 95, 'three days on the shelf with no play is still ~100',
     settled.toFixed(1));
  ok(kitTension(job, 0, 3) < 50,
     'even though the tension itself really has dropped',
     kitTension(job, 0, 3).toFixed(1) + ' lb of 52');
  ok(kitTension(job, 0, 3) > 45, 'by about a tenth, which is what settling is',
     kitTension(job, 0, 3).toFixed(1));
}
ok(kitTension({material:'poly', tension:0}, 3, 3) === 0,
   'a job with no recorded tension reports no tension rather than NaN');
ok(kitTension({material:'poly'}, 3, 3) === 0, 'and neither does a missing one');

section('the two clocks are set so the intended one runs out first');
/* This is the claim each row of KIT_STRINGS is making about its string, and
   it is the assertion that stops a retune of hTau or life from quietly
   reversing it. poly and hybrid go dead intact; everything else wears out. */
const EXPECT = {poly:'tension', hybrid:'tension', multi:'life', syn:'life',
                gut:'life', kevlar:'life'};
MATS.forEach(m => {
  const tc = kitTensionClockHours(m), life = KIT_STRINGS[m].life;
  const binds = tc < life ? 'tension' : 'life';
  ok(binds === EXPECT[m], m + ': ' + EXPECT[m] + ' is what finishes it',
     'tension clock ' + tc.toFixed(1) + 'h vs ' + life + 'h of life');
  /* and neither clock may be more than about double the other, or the
     shorter one is the only one doing any work and the other is a comment */
  const ratio = Math.max(tc, life) / Math.min(tc, life);
  ok(ratio < 2, m + ': and the other clock is close enough to matter',
     'ratio ' + ratio.toFixed(2));
});
ok(kitBinding({material:'poly', tension:52}, 30, 5) === 'tension',
   'a spent poly bed says the tension went');
ok(kitBinding({material:'kevlar', tension:52}, 56, 5) === 'life',
   'a spent kevlar bed says it wore out');
{
  const t = kitTerms({material:'poly', tension:52}, 4, 10);
  ok(t.fTension >= 0 && t.fTension <= 1 && t.fLife >= 0 && t.fLife <= 1,
     'both clock fractions stay inside [0,1]');
  ok(near(kitPlayability({material:'poly', tension:52}, 4, 10),
          100 * Math.min(t.fTension, t.fLife)),
     'and the score really is the smaller of the two');
}

section('the countdown — how much longer, honestly');
MATS.forEach(m => {
  const job = {material:m, tension:52};
  const h = kitHoursUntil(job, 0, 0, KIT_RESTRING_AT, 7 / 3);
  ok(h != null && h > 0 && h < 60, m + ': a fresh bed has hours left, and a plausible number of them',
     h == null ? 'never' : h.toFixed(1) + 'h');
});
ok(kitHoursUntil({material:'poly', tension:52}, 200, 400, KIT_RESTRING_AT, 2) === 0,
   'a bed already past the line has nothing left to count down');
{
  /* the whole reason the countdown takes a rate rather than only hours: a
     bed that comes out once a fortnight is ageing on the shelf between
     outings, so it has FEWER hours left than one played every day */
  const job = {material:'poly', tension:52};
  const often  = kitHoursUntil(job, 0, 0, KIT_RESTRING_AT, 7 / 8);   // 8h a week
  const rarely = kitHoursUntil(job, 0, 0, KIT_RESTRING_AT, 7 / 0.5); // 30min a week
  ok(rarely < often, 'playing rarely costs the bed hours it never got to use',
     rarely.toFixed(1) + 'h vs ' + often.toFixed(1) + 'h');
}
ok(kitHoursUntil({material:'gut', tension:55}, 0, 0, 1, 0) === null ||
   kitHoursUntil({material:'gut', tension:55}, 0, 0, 1, 0) > 0,
   'a bed that never reaches the target inside the horizon says so with a null');

section('a bed left in the bag all winter dies anyway');
{
  const job = {material:'poly', tension:52};
  ok(kitPlayability(job, 0, 30) > kitPlayability(job, 0, 120),
     'three months unplayed is worse than one');
  ok(kitPlayability(job, 0, 200) < 20, 'and a winter finishes it',
     kitPlayability(job, 0, 200).toFixed(1));
  ok(kitPlayability({material:'gut', tension:55}, 0, 200) >
     kitPlayability({material:'poly', tension:52}, 0, 200),
     'gut survives the same winter better, which is what it is for');
}

/* ---------------------------------------------------------------- */
section('hours from a match — tier 1, the ref\'s own clock');
const tracked = (mins, extra) => Object.assign({
  status:'approved', p1:'Aftab', p2:'Rowan', created_at:iso(3), sets:'6-4, 6-3',
  rallies: JSON.stringify({v:1, a:'Aftab', b:'Rowan',
    startedAt:new Date(Date.now() - 3*DAY).toISOString(),
    endedAt:new Date(Date.now() - 3*DAY + mins*60000).toISOString(), points:[]})
}, extra || {});
{
  const r = kitMatchMinutes(tracked(78));
  ok(r.source === 'tracked' && near(r.minutes, 78, 0.01),
     'a reffed match is timed to the second, not estimated', JSON.stringify(r));
  ok(kitMatchMinutes(tracked(600)).source === 'scoreline',
     'a ref who never pressed stop does not put ten hours on the strings',
     kitMatchMinutes(tracked(600)).source);
  ok(kitMatchMinutes(tracked(1)).source === 'scoreline',
     'and a stray one-minute reading falls back too');
  ok(kitMatchMinutes({status:'approved', sets:'6-4', rallies:'{not json'}).source === 'scoreline',
     'an unreadable rallies blob is simply not tier 1');
  ok(kitMatchMinutes({status:'approved', sets:'6-4',
      rallies: JSON.stringify({startedAt:iso(2)})}).source === 'scoreline',
     'nor is one with a start and no end');
  /* the tracker stores rallies as a string; a client that already parsed it
     must work identically or the two paths disagree about the same match */
  const parsed = JSON.parse(tracked(78).rallies);
  ok(near(kitMatchMinutes({rallies:parsed, sets:'6-4'}).minutes, 78, 0.01),
     'a pre-parsed rallies object reads the same as the string');
}

section('hours from a match — tier 2, the scoreline');
{
  const g = s => kitMatchMinutes({status:'approved', sets:s});
  ok(near(g('6-4, 6-3').minutes, 19 * KIT_MIN_PER_GAME),
     'a straight-sets win is its game count', g('6-4, 6-3').minutes.toFixed(1));
  ok(g('6-4, 4-6, 7-5').minutes > g('6-4, 6-3').minutes,
     'and three sets is longer than two');
  /* the same correction the dynamic K makes: 10-8 in the sets column is a
     match tiebreak, the shortest thing anybody plays, not an 18-game set */
  ok(g('6-4, 3-6, 10-8').minutes < g('6-4, 3-6, 7-5').minutes,
     'a match tiebreak counts as the short thing it is, not the long thing it looks like',
     g('6-4, 3-6, 10-8').minutes.toFixed(1) + ' vs ' + g('6-4, 3-6, 7-5').minutes.toFixed(1));
  ok(g('rubbish').source === 'assumed', 'an unparseable scoreline is not tier 2');
  ok(g('').source === 'assumed', 'and neither is an empty one');
}

section('hours from a match — tier 3, it happened and nobody wrote it down');
ok(kitMatchMinutes({status:'approved'}).minutes === KIT_MATCH_FALLBACK_MIN,
   'a bare approved match is still an hour of tennis');
ok(kitMatchMinutes(null).source === 'assumed', 'and a null row does not throw');

section('minutes from a practice session');
ok(kitPracticeMinutes({players:[{name:'Aftab',minutes:60},{name:'Dev',minutes:45}]}, 'Dev') === 45,
   'each player gets their own minutes out of the session');
ok(kitPracticeMinutes({players:[{name:'aftab',minutes:60}]}, 'Aftab') === 60,
   'and the name match is case-insensitive');
ok(kitPracticeMinutes({players:[{name:'Aftab',minutes:60},{name:'Aftab',minutes:30}]}, 'Aftab') === 90,
   'a player listed twice in one session is added up, not picked from');
ok(kitPracticeMinutes({players:[{name:'Dev',minutes:45}]}, 'Aftab') === 0,
   'somebody who was not there gets nothing');
/* a deployment that skipped the `players` migration still has the session's
   first player in scalar columns, and that row still counts */
ok(kitPracticeMinutes({name:'Aftab', minutes:55}, 'Aftab') === 55,
   'a row from before the players column existed still counts');
ok(kitPracticeMinutes({name:'Aftab', minutes:'55'}, 'Aftab') === 55, 'even typed as a string');
ok(kitPracticeMinutes(null, 'Aftab') === 0 && kitPracticeMinutes({}, null) === 0,
   'and the empty cases are zero rather than NaN');

section('adding it all up for one player, over one window');
const DATA = {
  matches: [
    tracked(90, {created_at: iso(10)}),                                  // 1.5h tracked
    {status:'approved', p1:'Rowan', p2:'Aftab', created_at:iso(5), sets:'6-0, 6-1'},
    {status:'approved', p1:'Aftab', p2:'Dev',   created_at:iso(40), sets:'6-4, 6-4'},
    {status:'pending',  p1:'Aftab', p2:'Dev',   created_at:iso(2), sets:'6-4, 6-4'},
    {status:'approved', p1:'Dev',   p2:'Rowan', created_at:iso(2), sets:'6-4, 6-4'}
  ],
  practice: [
    {created_at: iso(8),  players:[{name:'Aftab',minutes:90},{name:'Dev',minutes:90}]},
    {created_at: iso(45), players:[{name:'Aftab',minutes:60}]},
    {created_at: iso(1),  players:[{name:'Dev',minutes:60}]}
  ]
};
{
  const all = kitHoursFor('Aftab', null, null, DATA);
  ok(all.matches === 3, 'every approved match the player was in counts', all.matches);
  ok(all.sessions === 2, 'and every session they logged minutes for', all.sessions);
  ok(all.sources.tracked > 1.4 && all.sources.tracked < 1.6,
     'the tracked match contributes its real 1.5 hours', all.sources.tracked.toFixed(2));
  ok(near(all.hours, all.sources.tracked + all.sources.scoreline +
                     all.sources.assumed + all.sources.practice, 1e-9),
     'and the tiers add up to the total, so the panel can show the split honestly');

  const recent = kitHoursFor('Aftab', Date.now() - 14 * DAY, null, DATA);
  ok(recent.matches === 2 && recent.sessions === 1,
     'a window really does exclude what fell outside it',
     recent.matches + ' matches, ' + recent.sessions + ' sessions');
  ok(recent.hours < all.hours, 'so a window is always a subset of everything');

  ok(kitHoursFor('Aftab', null, null, DATA).hours ===
     kitHoursFor('aftab', null, null, DATA).hours, 'the player name is case-insensitive');
  ok(kitHoursFor('', null, null, DATA).hours === 0, 'nobody is nobody, not everybody');
  ok(kitHoursFor('Nobody At All', null, null, DATA).hours === 0,
     'a name with no rows gets zero rather than the league average');
  ok(kitHoursFor('Aftab', null, null, {}).hours === 0, 'and no data at all is zero, not a crash');
  /* the pending match must not count: strings do not wear out waiting for an
     admin, and a rejected result would otherwise leave phantom hours behind */
  const withPending = DATA.matches.filter(m => m.status === 'pending').length;
  ok(withPending === 1 && all.matches === 3,
     'a match still waiting for approval is not on anybody\'s strings yet');
}

section('the weekly rate — what turns hours left into a date');
{
  const r = kitWeeklyRate('Aftab', DATA);
  ok(r > 0, 'a player who has been playing has a rate', r.toFixed(2) + ' h/wk');
  ok(kitWeeklyRate('Nobody', DATA) === KIT_RATE_DEFAULT,
     'somebody brand new gets the default rather than a dash or a divide by zero');
  ok(kitWeeklyRate('Aftab', {}) === KIT_RATE_DEFAULT, 'and so does an app with no data yet');
}

section('one string job, assessed end to end');
{
  const job = {owner:'Aftab', material:'poly', tension:52, strung_at: iso(12)};
  const a = kitAssess(job, DATA);
  ok(near(a.days, 12, 0.01), 'it knows how long ago it was strung', a.days.toFixed(2));
  ok(a.hours > 0, 'and how much tennis has been played on it since', a.hours.toFixed(2) + 'h');
  ok(a.hours < kitHoursFor('Aftab', null, null, DATA).hours,
     'counting only the tennis played AFTER it went on');
  ok(a.tension < 52 && a.tension > 30, 'the tension has dropped but not fallen off a cliff',
     a.tension.toFixed(1));
  ok(a.score >= 0 && a.score <= 100 && a.band, 'there is a score and a band for it',
     a.score.toFixed(1) + ' ' + a.band.key);
  ok(a.binding === 'tension' || a.binding === 'life', 'and a reason it is going');
  ok(a.brokenIn === (a.hours >= a.material.breakIn),
     'break-in is reported separately, exactly as the hours imply');
  ok(a.daysLeft == null || a.daysLeft >= 0, 'the countdown is never negative');
  ok(near(a.used.hours, a.hours), 'the hours and their provenance describe the same total');

  const fresh = kitAssess({owner:'Aftab', material:'poly', tension:52,
                           strung_at: new Date().toISOString()}, DATA);
  ok(fresh.score > a.score, 'a bed strung today beats one strung twelve days ago',
     fresh.score.toFixed(1) + ' vs ' + a.score.toFixed(1));
  ok(fresh.brokenIn === false && fresh.breakInLeft > 0,
     'and it says so rather than claiming to be at its best');
}
{
  /* the panel sorts on this, so two beds of different materials strung on the
     same day and played the same amount must order the way the strings do */
  const when = iso(21);
  const s = m => kitAssess({owner:'Aftab', material:m, tension:52, strung_at:when}, DATA).score;
  ok(s('gut') > s('poly'), 'after three weeks, gut is in better shape than poly',
     s('gut').toFixed(1) + ' vs ' + s('poly').toFixed(1));
  ok(s('multi') > s('poly'), 'and so is multifilament');
}
{
  const a = kitAssess({owner:'Aftab', material:'poly', tension:52}, DATA);
  ok(a && a.score >= 0, 'a job with no stringing date still assesses rather than throwing',
     a.score.toFixed(1));
  const b = kitAssess({}, {});
  ok(b && isFinite(b.score), 'and so does an empty one');
}

section('what the bed feels like today, which is not what it measures');
{
  const F = (m, t) => K.kitFeelShift(m, t);
  ok(F('poly', K.KIT_WX_REF_C) === 0, 'at the reference temperature the bed plays as strung');
  ok(F('poly', 2) > 0, 'cold makes it play tighter', F('poly', 2).toFixed(2));
  ok(F('poly', 33) < 0, 'and heat makes it play looser', F('poly', 33).toFixed(2));
  ok(F('poly', 2) > F('gut', 2),
     'poly cares about the cold far more than gut does — one of the reasons people play gut in it',
     F('poly', 2).toFixed(2) + ' vs ' + F('gut', 2).toFixed(2));
  let mono = true;
  for(let t = -30; t < 45; t++) if(F('poly', t + 1) > F('poly', t) + 1e-12) mono = false;
  ok(mono, 'and the shift falls monotonically as it warms up');
  ok(Math.abs(F('poly', -60)) <= K.KIT_WX_MAX_LB + 1e-9
     && Math.abs(F('poly', 60)) <= K.KIT_WX_MAX_LB + 1e-9,
     'weather nobody plays tennis in is capped rather than extrapolated',
     F('poly', -60).toFixed(2) + ' / ' + F('poly', 60).toFixed(2));
  /* NO READING MUST NEVER READ AS MILD. A missing temperature and a mild
     afternoon both produce a shift of zero, so the two are told apart by the
     note being absent — which is what the card renders on. */
  ok(F('poly', null) === 0 && F('poly', undefined) === 0 && F('poly', NaN) === 0,
     'no reading is no shift');
  ok(K.kitFeelNote('poly', null) === null, 'and no sentence at all');
  ok(K.kitFeelNote('poly', K.KIT_WX_REF_C) !== null,
     'while a mild afternoon does get a sentence, saying exactly that',
     K.kitFeelNote('poly', K.KIT_WX_REF_C));
  ok(/tighter/.test(K.kitFeelNote('poly', -5)), 'the cold sentence says tighter');
  ok(/looser/.test(K.kitFeelNote('poly', 34)), 'and the hot one says looser');
  ok(F('a-string-nobody-has', 2) === F('poly', 2) || F('a-string-nobody-has', 2) > 0,
     'an unknown material still gets a sensible shift rather than NaN',
     F('a-string-nobody-has', 2));
}
{
  /* the temperature is a parameter, not a global read, so an assessment
     without one is identical in every other respect */
  const job = {owner:'Aftab', material:'poly', tension:52, strung_at: iso(9)};
  const warm = kitAssess(job, DATA, null, 30);
  const cold = kitAssess(job, DATA, null, 0);
  const none = kitAssess(job, DATA);
  ok(near(warm.score, cold.score) && near(warm.score, none.score),
     'the temperature changes how it FEELS, never the playability score');
  ok(cold.feelShift > warm.feelShift, 'but it does change the feel', 
     cold.feelShift.toFixed(2) + ' vs ' + warm.feelShift.toFixed(2));
  ok(none.feelShift === 0 && none.feelNote === null,
     'and an assessment with no reading carries neither');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
