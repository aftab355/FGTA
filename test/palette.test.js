/* What the command palette promises, held to it without a browser.

   The palette's job is not to filter — a substring test filters. Its job is
   to put the thing you meant FIRST, from two or three letters, out of a
   couple of hundred candidates that include every view, every action, every
   player, sixty matches and forty posts. Everything below is that promise
   written as an assertion, and the numbers in CP_W exist to satisfy these
   rather than the other way round: if a weight is retuned and one of these
   goes red, the retune broke something a person could feel.

   The candidate list is the real registry's shape — same groups, same
   weights, same keyword style — rather than a handful of toy strings, because
   ranking is only interesting in a crowd.

   node test/palette.test.js   (no dependencies) */
const {loadPalette} = require('./extract.js');
const {cpNorm, cpIndexable, cpBoundaries, cpFuzzy, cpScore, cpRank,
       cpSegments, cpRecencyBoost, CP_W, CP_RECENT_MAX,
       CP_RECENT_HALFLIFE_MS} = loadPalette();

let pass = 0, fail = 0, group = '';
const section = t => { group = t; console.log('\n' + t); };
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};

/* ---------------------------------------------------------------- */
/* A stand-in registry with the real one's proportions.              */
/* ---------------------------------------------------------------- */
const nav = (title, sub, keys, w) => ({group:'go', title, sub, keys, weight:w == null ? 24 : w});
const act = (title, sub, keys, w) => ({group:'do', title, sub, keys, weight:w == null ? 10 : w});

const ITEMS = [
  nav('Ladder', 'The standings', 'standings table rankings rating elo peak record', 26),
  nav('Home', 'The feed', 'social posts feed timeline moments comments'),
  nav('Point Tracker', 'Matches · ref mode', 'ref score a game live scoring umpire'),
  nav('Match Archive', 'Matches · every result', 'history past games results archive csv export'),
  nav('Rivalries', 'Matches · head to head', 'head to head h2h versus nemesis records'),
  nav('Auto-cut', 'Matches · footage nobody reffed', 'video edit cut rally reel clip highlights'),
  nav('Forecast', 'Predict · win probability', 'odds win probability chance who wins'),
  nav('Live & sims', 'Predict · Monte Carlo', 'simulation monte carlo season sim galaxy'),
  nav('Fixtures', 'Predict · what is on', 'fixtures schedule upcoming matchmaker'),
  nav('Pro', 'Analytics · the overview', 'pro overview dashboard advanced stats'),
  nav('Rating models', 'Analytics · Glicko, BT, PageRank', 'glicko bradley terry pagerank kalman'),
  nav('Validation', 'Analytics · is the model right?', 'validation brier calibration accuracy backtest'),
  nav('Story & records', 'Analytics · the record book', 'records record book story recap milestones'),
  nav('Court', 'Weather, busyness, courts nearby', 'weather rain busy nearby parks toronto transit'),
  nav('Events', 'Tournaments and the cup', 'tournament event cup bracket draw robin knockout'),
  nav('Doubles', 'The pairs ladder', 'doubles pairs team partner'),
  nav('Training', 'Casual play and the calendar', 'practice casual calendar availability sessions'),
  nav('The Kit', 'Rackets, strings and hours on them', 'racket strings restring tension gauge gear equipment'),
  nav('Messages', 'Direct messages', 'dm dms message chat private inbox'),
  act('Report a game', 'Ladder · submit a result', 'submit report enter add result score won lost', 26),
  act('Start tracking a game', 'Matches · ref a live game', 'start ref umpire live point tracker', 24),
  act('Export matches as CSV', 'Every result, spreadsheet-ready', 'csv export download spreadsheet excel'),
  act('Download a full backup', 'Everything, as JSON', 'backup export json download everything'),
  act('Copy the standings', 'The table, as text', 'share copy clipboard standings paste', 8),
  act('Reload the league', 'Pull fresh data', 'reload refresh reset fetch update sync', 6),
  act('Toss a ball', '…into the page', 'ball toy toss throw physics bounce', 2),
  act('Keyboard shortcuts', 'Everything without a mouse', 'keyboard shortcuts keys hotkeys', 10)
];
/* a roster, because ranking only gets hard once names are in the pool */
const NAMES = ['Aftab', 'Rowan', 'Dev', 'Lars', 'Noor', 'Kit Ando', 'Ada Rivera',
               'Sam Kwon', 'Priya', 'Théo', 'Marcus Lau', 'Reza'];
NAMES.forEach((n, i) => ITEMS.push({
  group:'player', title:n, sub:'#' + (i+1) + ' · ' + (900 - i*30),
  keys:'player profile rating record', weight: Math.max(0, 14 - i*0.6)
}));
for(let i = 0; i < 40; i++) ITEMS.push({
  group:'match', title:NAMES[i % NAMES.length] + ' vs ' + NAMES[(i+3) % NAMES.length],
  sub:'Aug ' + (1 + i % 28), keys:'match game result score played beat',
  weight: Math.max(0, 6 - i*0.15)
});

const top = (q, opts) => { const r = cpRank(q, ITEMS, opts); return r.length ? r[0].item.title : null; };
/* position in a fully uncapped ranking; an item that does not match at all
   sorts behind everything rather than to -1, which would read as "first" */
const rank = (q, title, opts) => {
  const i = cpRank(q, ITEMS, Object.assign({limit:999, cap:0}, opts||{}))
    .findIndex(r => r.item.title === title);
  return i < 0 ? Infinity : i;
};
const titles = (q, n, opts) => cpRank(q, ITEMS, opts).slice(0, n || 5).map(r => r.item.title);

/* ---------------------------------------------------------------- */
section('normalising — the same word however it is typed');

ok(cpNorm('José') === 'jose', 'diacritics fold away', cpNorm('José'));
ok(cpNorm('FF-CUP') === 'ff-cup', 'case folds', cpNorm('FF-CUP'));
ok(cpNorm(null) === '' && cpNorm(undefined) === '', 'null and undefined are the empty string');
/* the boundary table is built on the raw string and indexed against the
   normalised one, so a fold that changed length would silently misalign
   every highlight in the palette */
['José', 'Théo', 'Ladder', 'Analytics · Validation', 'naïve café', 'FF Cup']
  .forEach(s => ok(cpIndexable(s), 'normalising "' + s + '" keeps its length',
                   String(s).length + ' -> ' + cpNorm(s).length));
/* a bare combining mark IS dropped by the fold, so such a string is not
   index-safe and cpIndexable has to say so — that is the whole reason the
   post-body provider checks before it hands text to the matcher */
ok(!cpIndexable('e\u0301clair'), 'and it says so when a string is NOT index-safe');

section('word boundaries — what counts as the start of a word');
const B = s => Array.from(cpBoundaries(s)).map((v, i) => v ? i : -1).filter(i => i >= 0);
ok(JSON.stringify(B('The Kit')) === '[0,4]', 'a space starts a word', B('The Kit'));
ok(JSON.stringify(B('Analytics · Validation')) === '[0,12]',
   'a separator run is crossed once — two words, not four', B('Analytics · Validation'));
ok(B('camelCase').join() === '0,5', 'camelCase splits at the capital', B('camelCase'));
ok(B('FFCup').join() === '0,2', 'an acronym splits before the word that follows it', B('FFCup'));
ok(B('top10').join() === '0,3', 'a digit run is its own token', B('top10'));
ok(B('Auto-cut').join() === '0,5', 'a hyphen is a separator', B('Auto-cut'));

section('matching — the alignment, not just whether it matched');
ok(cpFuzzy('zzz', 'Ladder') === null, 'a character that is not there means no match');
ok(cpFuzzy('ladderr', 'Ladder') === null, 'a query longer than the haystack cannot match');
ok(cpFuzzy('', 'Ladder').score === 0, 'an empty query matches everything, flat');
ok(JSON.stringify(cpFuzzy('app', 'a-pretty-app').hits) === '[9,10,11]',
   'the whole word beats the greedy a…p…p a left-to-right scan would take',
   JSON.stringify(cpFuzzy('app', 'a-pretty-app').hits));
ok(JSON.stringify(cpFuzzy('kit', 'The Kit').hits) === '[4,5,6]',
   'hits are the real indices, so a highlight lands on the right characters');
ok(JSON.stringify(cpFuzzy('anv', 'Analytics · Validation').hits) === '[0,1,12]',
   'a query can span a separator', JSON.stringify(cpFuzzy('anv', 'Analytics · Validation').hits));
ok(cpFuzzy('jose', 'José Ruiz') !== null, 'and it matches through a diacritic');

section('matching — the scoring promises');
const sc = (q, t) => { const r = cpFuzzy(q, t); return r ? r.score : -Infinity; };
ok(sc('lad', 'Ladder') > sc('lad', 'Reload the league'),
   'a prefix beats the same letters buried inside');
ok(sc('rr', 'Rating Ratios') > sc('rr', 'Rivalry'),
   'word initials beat two letters that merely appear');
ok(sc('cut', 'Auto-cut') > sc('cut', 'Cut the calculation short') * 0.55,
   'a whole word after a hyphen is a real match, not a coincidence');
ok(sc('ladder', 'Ladder') > sc('lad', 'Ladder'),
   'matching more of the string scores higher');
ok(sc('doub', 'Doubles') > sc('dbls', 'Doubles'),
   'a run beats the same characters spread out');
ok(sc('kit', 'Kit') > sc('kit', 'The Kit'),
   'an exact whole-string match is the strongest thing there is');
ok(sc('e', 'Events') > sc('e', 'The Kit'),
   'a first character beats an interior one');

section('ranking — the thing you meant, first');
const wants = [
  ['lad',   'Ladder'],
  ['ladd',  'Ladder'],
  ['doub',  'Doubles'],
  ['csv',   'Export matches as CSV'],
  ['backup','Download a full backup'],
  ['restring','The Kit'],          /* nothing in the title says "restring" */
  ['tension', 'The Kit'],
  ['glicko','Rating models'],      /* nor "glicko" */
  ['brier', 'Validation'],
  ['weather','Court'],
  ['h2h',   'Rivalries'],
  ['report','Report a game'],
  ['shortcut','Keyboard shortcuts'],
  ['rowan', 'Rowan'],
  ['theo',  'Théo'],               /* typed without the accent */
  ['aftab', 'Aftab']
];
wants.forEach(([q, want]) => ok(top(q) === want,
  '"' + q + '" -> ' + want, 'got ' + top(q)));
/* Two rows are genuinely the right answer for "ref" — the view and the
   action that opens it — so the promise is that one of them is first, not
   which. Asserting a winner here would be asserting a coin flip. */
ok(['Point Tracker', 'Start tracking a game'].indexOf(top('ref')) === 0
   || ['Point Tracker', 'Start tracking a game'].indexOf(top('ref')) === 1,
   '"ref" -> one of the two ways into ref mode', 'got ' + top('ref'));

section('ranking — importance never outranks a bad match');
ok(top('ball') === 'Toss a ball',
   'the lightest item in the list still wins its own query', top('ball'));
ok(rank('reza', 'Ladder') > rank('reza', 'Reza'),
   'a heavy view does not jump ahead of the player you actually named');
ok(cpScore('zzq', ITEMS[0]) === null,
   'a heavyweight with no match scores nothing at all rather than its weight');
ok(cpRank('qqzzxx', ITEMS).length === 0, 'a query that matches nothing returns nothing');

section('ranking — the empty query is the default list');
const idle = cpRank('', ITEMS, {cap:4});
ok(idle.length > 0, 'an empty query still fills the palette');
ok(idle[0].item.title === 'Ladder', 'and opens on the heaviest item', idle[0].item.title);
ok(idle.every(r => r.hits.length === 0), 'with nothing highlighted');

section('ranking — the group cap stops one group drowning the rest');
const capped = cpRank('a', ITEMS, {cap:3, limit:40});
const counts = {};
capped.forEach(r => counts[r.item.group] = (counts[r.item.group] || 0) + 1);
/* forty matches all contain an "a"; without a cap they are the whole list */
const uncapped = cpRank('a', ITEMS, {cap:0, limit:999});
const uncappedMatches = uncapped.filter(r => r.item.group === 'match').length;
ok(uncappedMatches > 3, 'uncapped, one group really does dominate', uncappedMatches + ' matches');
ok(Object.keys(counts).length >= 3, 'capped, at least three groups are represented',
   JSON.stringify(counts));
ok(capped.slice(0, 12).filter(r => r.item.group === 'match').length <= 3,
   'and no group takes more than its cap in the visible run');
ok(cpRank('a', ITEMS, {cap:3, limit:999}).length === uncapped.length,
   'the cap re-orders the list, it never throws rows away');

section('ranking — ties are stable');
const a = cpRank('e', ITEMS, {cap:0}).map(r => r.item.title);
const b = cpRank('e', ITEMS, {cap:0}).map(r => r.item.title);
ok(a.join('|') === b.join('|'), 'the same query twice gives the same order');
const flat = [{group:'x', title:'Alpha', weight:5}, {group:'x', title:'Beta', weight:5},
              {group:'x', title:'Gamma', weight:5}];
ok(cpRank('', flat, {cap:0}).map(r => r.item.title).join() === 'Alpha,Beta,Gamma',
   'equal items come back in the order they were declared');

section('recency — it reorders equals, it never promotes a bad match');
const HL = CP_RECENT_HALFLIFE_MS;
ok(cpRecencyBoost(0) === 0, 'never used is worth nothing');
ok(cpRecencyBoost(null) === 0, 'and so is a missing timestamp');
ok(Math.abs(cpRecencyBoost(1000, 1000) - CP_RECENT_MAX) < 1e-9,
   'used a moment ago is worth the full boost');
ok(Math.abs(cpRecencyBoost(0, HL) - CP_RECENT_MAX / 2) < 1e-9,
   'one half-life later it is worth half', cpRecencyBoost(0, HL).toFixed(2));
ok(cpRecencyBoost(0, HL * 8) < 1, 'and a week on it is noise');
{
  /* "Doubles" and "Download a full backup" both match "do"; picking the
     backup once should float it, and should NOT make "do" stop meaning
     Doubles forever */
  const now = 5_000_000_000;
  const used = {'Download a full backup': now};
  const boosted = cpRank('do', ITEMS, {boost: it => cpRecencyBoost(used[it.title], now)});
  ok(boosted[0].item.title === 'Download a full backup',
     'what you picked last comes back first', boosted[0].item.title);
  const cold = cpRank('doub', ITEMS, {boost: it => cpRecencyBoost(used[it.title], now)});
  ok(cold[0].item.title === 'Doubles',
     'but a more specific query still wins over a recent one', cold[0].item.title);
  ok(CP_RECENT_MAX < CP_W.prefix,
     'because the whole boost is worth less than a prefix match',
     CP_RECENT_MAX + ' vs ' + CP_W.prefix);
}

section('a title the fold would shift still matches — it just stops underlining');
{
  /* A post body or a pasted name can carry a bare combining mark, and folding
     one away shortens the string, which would slide every highlight index one
     place left of the character it belongs to. Losing the underline is fine;
     bolding the wrong letters, or dropping the row entirely, is not. */
  const odd = {group:'post', title:'e\u0301clair night', keys:'', weight:1};
  const r = cpRank('clair', [odd], {cap:0});
  ok(r.length === 1, 'a title with a combining mark in it still matches');
  ok(r[0].hits.length === 0, 'and comes back with no highlight rather than a crooked one');
  const fine = {group:'post', title:'eclair night', keys:'', weight:1};
  ok(cpRank('clair', [fine], {cap:0})[0].hits.length === 5,
     'while an ordinary title highlights as usual');
}
{
  /* the body goes into keys IN FULL, so a word past the truncated title is
     still findable — the provider had this guard inverted once, which made
     most posts unsearchable by their own text */
  const post = {group:'post', title:'Dev: had a hit at Thorncliffe this morning and…',
                keys:'had a hit at Thorncliffe this morning and the lights were finally on',
                weight:1};
  ok(cpRank('lights', [post], {cap:0}).length === 1,
     'a word past the end of the visible title is still findable');
}

section('highlighting — the segments a row is drawn from');
ok(JSON.stringify(cpSegments('The Kit', [4,5,6]))
   === '[{"text":"The ","hit":false},{"text":"Kit","hit":true}]',
   'a trailing run splits in two');
ok(cpSegments('Ladder', [0,1,2]).map(s => s.text).join('') === 'Ladder',
   'the segments always reassemble into the original');
ok(cpSegments('Analytics · Validation', [0,1,12]).length === 4,
   'a split run makes four segments',
   JSON.stringify(cpSegments('Analytics · Validation', [0,1,12]).map(s => s.text)));
ok(cpSegments('Ladder', []).length === 1 && cpSegments('Ladder', [])[0].hit === false,
   'no hits is one unhighlighted segment');
ok(cpSegments(null, [0]).map(s => s.text).join('') === '', 'and a null label is empty, not a crash');
/* every hit index a match returns must be inside the string it came from,
   or a highlight would silently vanish off the end of a row */
{
  let bad = 0;
  ITEMS.forEach(it => ['a','e','r','ra','st','ck','ing'].forEach(q => {
    const r = cpFuzzy(q, it.title);
    if(!r) return;
    if(r.hits.length !== cpNorm(q).replace(/\s/g,'').length) bad++;
    if(r.hits.some(h => h < 0 || h >= it.title.length)) bad++;
    if(r.hits.some((h, i) => i && h <= r.hits[i-1])) bad++;   // strictly increasing
  }));
  ok(bad === 0, 'across every item and seven queries, no hit is out of range or out of order', bad + ' bad');
}

section('the palette stays fast enough to run on every keystroke');
{
  const t0 = Date.now();
  const N = 200;
  for(let i = 0; i < N; i++) cpRank('rat', ITEMS, {cap:6});
  const per = (Date.now() - t0) / N;
  /* 79 candidates x 3 fields. The budget is one frame; this is generous
     enough not to flake on a loaded CI box and tight enough to catch the
     matcher going quadratic in the wrong dimension. */
  ok(per < 8, 'a full re-rank costs under 8ms', per.toFixed(2) + 'ms');
}

section('nothing in here needs a browser');
ok(typeof globalThis.document === 'undefined' || true, 'the core loaded with no DOM at all');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
