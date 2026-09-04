/* The Robin+ format engine, and the forecast that simulates it.

   Two things are being checked, and the second is the reason the first
   matters. One: teaching the engine to read results through an accessor,
   so a simulation can feed it imagined ones, did not change what it says
   about real ones. Two: the forecast built on top actually respects the
   event in front of it — it never re-imagines a played game, it never
   gives a title to somebody who has already been knocked out, and its
   probabilities are probabilities.

   node test/robin-plus.test.js   (no dependencies) */
const {loadRobinPlus, loadEloScope} = require('./extract.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if(c){ pass++; console.log('  ok   '+m); }
                          else { fail++; console.log('  FAIL '+m + (x!==undefined?'   ['+x+']':'')); } };
const near = (a, b, tol) => Math.abs(a-b) <= tol;

/* ---------- a five-player ring ---------------------------------- */
const FIELD = ['Ana','Bo','Cy','Dee','Eli'];
const RING  = [['Ana','Bo'],['Bo','Cy'],['Cy','Dee'],['Dee','Eli'],['Eli','Ana']];
const T     = {id: 7, name:'Test Cup'};

function makeState(){
  return {
    v: 2, roster: FIELD.slice(), shape: 'ring', seed: 1,
    cycle: FIELD.slice(),
    order: RING.map(([p1,p2], i) => ({p1, p2, round: 'grp'+(i+1)}))
  };
}

/* every game the fixtures ask for, as ordinary match rows. `flip` stores the
   row the other way round from the fixture, which is what really happens when
   the loser reports the result. */
let nextId = 1;
function row(round, p1, p2, winner, sets, flip){
  const a = flip ? p2 : p1, b = flip ? p1 : p2;
  return {id: nextId++, tournament_id: T.id, round, status:'approved',
          p1: a, p2: b, outcome: winner === a ? 1 : 0, sets: flip ? flipSets(sets) : sets};
}
function flipSets(s){
  return String(s||'').split(',').map(x=>{ const b = x.trim().split('-'); return b[1]+'-'+b[0]; }).join(', ');
}

const POWER = {Ana: 1300, Bo: 1200, Cy: 1100, Dee: 1000, Eli: 900};

function load(matches){
  return loadRobinPlus({
    matches,
    read: () => makeState(),
    standings: () => FIELD.map(n=>({name:n, rating:POWER[n], games:10})),
    predictiveRating: n => POWER[n] !== undefined ? POWER[n] : 1000,
    context: players => ({
      players, rating: n => POWER[n] || 1000, spread: 400,
      winProb: () => 0.5, quality: () => 1, rematch: () => 0, metCount: () => false
    })
  });
}

/* ================================================================
   1. the accessor is a no-op on real results
   ================================================================ */
console.log('\nthe engine reads real results the same way it always did');
{
  const state = makeState();
  const played = [
    row('grp1','Ana','Bo','Ana','6-2'),
    row('grp2','Bo','Cy','Bo','6-4'),
    row('grp3','Cy','Dee','Cy','6-3', true),   // stored the other way round
    row('grp4','Dee','Eli','Dee','6-1'),
    row('grp5','Eli','Ana','Ana','6-0')
  ];
  const rp = load(played);

  const table = rp.rpGroupTable(T, state);
  const by = {}; table.forEach(r => by[r.name] = r);

  ok(by.Ana.w === 2 && by.Ana.l === 0, 'Ana won both her games', JSON.stringify(by.Ana));
  ok(by.Cy.w === 1 && by.Cy.l === 1, 'the flipped row still credits Cy with the win, not Dee',
     'Cy '+by.Cy.w+'-'+by.Cy.l+', Dee '+by.Dee.w+'-'+by.Dee.l);
  // Cy lost 4-6 to Bo and won 6-3 against Dee, so 10 games taken and 9 conceded
  ok(by.Cy.gw === 10 && by.Cy.gl === 9, 'and its games land on the right side of the table',
     by.Cy.gw+'/'+by.Cy.gl);

  // the same table, built through an explicitly-passed real accessor
  const viaAccessor = rp.rpGroupTable(T, state, rp.rpRealResult(T));
  ok(JSON.stringify(viaAccessor) === JSON.stringify(table),
     'passing the real accessor explicitly changes nothing');

  const q = rp.rpQualification(T, state);
  ok(q.complete === true, 'the group is complete');
  ok(q.rows[0].name === 'Ana', 'Ana tops the group', q.rows.map(r=>r.name).join(' '));
  const decided = q.qualified.length + (q.bubble ? q.bubble.tied.length : 0);
  ok(decided >= 4, 'four places are accounted for, by qualification or by a decider', decided);
}

/* ================================================================
   2. the forecast respects what has already happened
   ================================================================ */
console.log('\nthe forecast never re-imagines a played game');
{
  const rp = load([]);
  const state = makeState();
  const f = rp.rpfForecast(T, state, {runs: 800});
  ok(!!f, 'an untouched draw still forecasts');
  ok(f.rows.length === 5, 'every player in the field gets a row', f.rows.length);

  const title = f.rows.reduce((s,r)=>s+r.title, 0);
  const final = f.rows.reduce((s,r)=>s+r.final, 0);
  const qual  = f.rows.reduce((s,r)=>s+r.qualify, 0);
  ok(near(title, 1, 0.001), 'exactly one champion per simulated tournament', title.toFixed(4));
  ok(near(final, 2, 0.001), 'exactly two finalists', final.toFixed(4));
  ok(near(qual, 4, 0.001), 'exactly four qualify', qual.toFixed(4));

  ok(f.rows[0].name === 'Ana', 'the strongest player is the favourite',
     f.rows.map(r=>r.name+' '+(r.title*100).toFixed(0)+'%').join(', '));
  const eli = f.rows.find(r=>r.name==='Eli');
  ok(eli.title < f.rows[0].title, 'the weakest is not',
     'Eli '+(eli.title*100).toFixed(1)+'% vs Ana '+(f.rows[0].title*100).toFixed(1)+'%');
}

console.log('\na finished event forecasts itself');
{
  const played = [
    row('grp1','Ana','Bo','Ana','6-2'),
    row('grp2','Bo','Cy','Bo','6-4'),
    row('grp3','Cy','Dee','Cy','6-3'),
    row('grp4','Dee','Eli','Dee','6-1'),
    row('grp5','Eli','Ana','Ana','6-0'),
    // Eli is out on record; the bracket then runs its course
    {id: 90, tournament_id: T.id, round:'semi1', status:'approved', p1:'Ana', p2:'Dee', outcome:1, sets:'6-1'},
    {id: 91, tournament_id: T.id, round:'semi2', status:'approved', p1:'Cy', p2:'Bo', outcome:1, sets:'7-5'},
    {id: 92, tournament_id: T.id, round:'final', status:'approved', p1:'Cy', p2:'Ana', outcome:1, sets:'7-6'}
  ];
  const rp = load(played);
  const f = rp.rpfForecast(T, makeState(), {runs: 400});
  const by = {}; f.rows.forEach(r => by[r.name] = r);
  ok(by.Cy.title === 1, 'the player who actually won the final has the title, not the favourite',
     'Cy '+by.Cy.title+', Ana '+by.Ana.title);
  ok(by.Eli.qualify === 0 && by.Eli.title === 0, 'the player who went out in the group has nothing',
     'Eli qualify '+by.Eli.qualify);
}

console.log('\na semi-final stored the other way round still advances the winner');
{
  const played = [
    row('grp1','Ana','Bo','Ana','6-2'),
    row('grp2','Bo','Cy','Bo','6-4'),
    row('grp3','Cy','Dee','Cy','6-3'),
    row('grp4','Dee','Eli','Dee','6-1'),
    row('grp5','Eli','Ana','Ana','6-0'),
    // Dee beat Ana, reported by Dee's opponent, so Ana leads the row
    {id: 95, tournament_id: T.id, round:'semi1', status:'approved', p1:'Ana', p2:'Dee', outcome:0, sets:'4-6'}
  ];
  const rp = load(played);
  const f = rp.rpfForecast(T, makeState(), {runs: 600});
  const by = {}; f.rows.forEach(r => by[r.name] = r);
  ok(by.Ana.final === 0 && by.Ana.title === 0,
     'Ana lost her semi, so she cannot reach the final', 'Ana final '+by.Ana.final);
  ok(by.Dee.final === 1, 'Dee is in the final in every run', 'Dee final '+by.Dee.final);
}

/* ================================================================
   3. determinism and the swing
   ================================================================ */
console.log('\nthe same event forecasts the same way twice');
{
  const rp = load([]);
  const a = rp.rpfForecast(T, makeState(), {runs: 500});
  const b = rp.rpfForecast(T, makeState(), {runs: 500});
  ok(JSON.stringify(a.rows) === JSON.stringify(b.rows),
     're-rendering the page does not re-roll the odds');
}

console.log('\nwhat one game is worth');
{
  const rp = load([]);
  const state = makeState();
  const base = rp.rpfForecast(T, state, {runs: 800});
  const swing = rp.rpfSwing(T, state, state.order[0], base);   // Ana v Bo
  ok(!!swing, 'the next fixture has a swing');
  ok(swing.p1IfWin > swing.p1IfLose,
     'winning your opening game is worth more than losing it',
     'Ana win '+(swing.p1IfWin*100).toFixed(1)+'% vs lose '+(swing.p1IfLose*100).toFixed(1)+'%');
  ok(swing.p2IfWin > swing.p2IfLose, 'and that holds for the other side too',
     'Bo win '+(swing.p2IfWin*100).toFixed(1)+'% vs lose '+(swing.p2IfLose*100).toFixed(1)+'%');
}

console.log('\nthe margin model reads the event it is in');
{
  const rp = load([]);
  const tight = rp.rpfMarginModel([1,1,2,1,2,1]);
  const wide  = rp.rpfMarginModel([6,5,6,6,4,6]);
  ok(tight.mean < wide.mean, 'a group of close games predicts closer games',
     tight.mean.toFixed(2)+' vs '+wide.mean.toFixed(2));
  const thin = rp.rpfMarginModel([4]);
  ok(thin.mean === 3 && thin.sd === 2, 'one scoreline is not a model — it falls back');
}

/* ================================================================
   4. a four-player group: nobody is cut, the table seeds the bracket
   ================================================================ */
console.log('\nfour players: the group seeds instead of cutting');
{
  const FOUR = ['Ana','Bo','Cy','Dee'];
  const pairs = [];
  for(let i=0;i<FOUR.length;i++) for(let j=i+1;j<FOUR.length;j++) pairs.push([FOUR[i],FOUR[j]]);
  const order = pairs.map(([p1,p2],i)=>({p1,p2,round:'grp'+(i+1),leg:1}))
    .concat(pairs.map(([p1,p2],i)=>({p1:p2,p2:p1,round:'grp'+(i+7),leg:2})));
  const state = {v:2, roster:FOUR.slice(), shape:'drr', seed:3, cycle:FOUR.slice(), order};
  const rp = loadRobinPlus({
    matches: [],
    standings: () => FOUR.map(n=>({name:n, rating:POWER[n], games:10})),
    predictiveRating: n => POWER[n],
    context: players => ({players, rating: n => POWER[n]||1000, spread:400,
      winProb:()=>0.5, quality:()=>1, rematch:()=>0, metCount:()=>false})
  });
  const f = rp.rpfForecast({id: 8}, state, {runs: 600});
  ok(!!f, 'a four-player double round robin forecasts');
  ok(f.rows.every(r => r.qualify === 1), 'everybody reaches the bracket, because nobody can be cut',
     f.rows.map(r=>r.name+' '+r.qualify).join(' '));
  ok(near(f.rows.reduce((s,r)=>s+r.title,0), 1, 0.001), 'still exactly one champion');
  ok(f.rows[0].name === 'Ana', 'and the strongest is still the favourite',
     f.rows.map(r=>r.name+' '+(r.title*100).toFixed(0)+'%').join(', '));
  const seeds = f.rows.map(r=>r.seed);
  ok(seeds.every(x => x >= 1 && x <= 4), 'every average seed lands inside the bracket', seeds.map(x=>x.toFixed(2)).join(' '));
}

/* ================================================================
   5. what an event does to the ladder, and what it does to everything else
   ================================================================ */
console.log('\nan exhibition is invisible to the ladder and visible to everything else');
{
  const scope = loadEloScope([
    {id: 1, name:'FF Cup',       counts_elo: false},
    {id: 2, name:'Club champs',  counts_elo: true},
    {id: 3, name:'Handicap night', counts_elo: false, counts_stats: false}
  ]);

  ok(scope.countsForElo({}) === true && scope.countsForAnalysis({}) === true,
     'a plain ladder game counts for both');

  ok(scope.countsForElo({tournament_id:1}) === false,
     'a cup game does not move the ladder');
  ok(scope.countsForAnalysis({tournament_id:1}) === true,
     'but it did happen, so the stats and the models see it');

  ok(scope.countsForElo({tournament_id:2}) === true &&
     scope.countsForAnalysis({tournament_id:2}) === true,
     'a rated event counts for both');

  ok(scope.countsForAnalysis({tournament_id:3}) === false,
     'counts_stats:false is the escape hatch, and it works');

  ok(scope.countsForAnalysis({tournament_id: 99}) === true,
     'a game whose event has been deleted was still played');

  ok(/stats/.test(scope.tournEloLabel({counts_elo:false})),
     'and the label says so rather than calling it "no Elo effect"',
     scope.tournEloLabel({counts_elo:false}));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail ? 1 : 0);
