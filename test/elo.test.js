/* The rating engine, which is the one piece of this app whose output people
   argue about.

   A bug in the feed loses a post and somebody notices within the hour. A bug
   in here quietly rewrites who is winning, does it consistently, and produces
   a table that looks exactly as plausible as the right one. Until now none of
   it was covered by anything: not the margin multiplier, not the replay, not
   the date gates that are the only thing standing between a tuning change and
   every rating in the league's history moving.

   THE MOST IMPORTANT THING HERE is the last section. Margin of victory was
   introduced with an explicit promise that it would not re-score anything
   already played, and that promise is enforced entirely by a pair of date
   string comparisons. A test that only checked today's arithmetic would let
   somebody widen a gate by one character and silently move a season of
   ratings.

   K itself is flat and symmetric — every game moves both players by the same
   K (margin of victory scales it, equally, for both sides), so the rating
   pool is always exactly players x START. That is checked directly below
   rather than through a drift figure, because there is no longer anything
   that could make the two sides differ.

   node test/elo.test.js   (no dependencies) */
const {loadElo} = require('./extract.js');

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 1e-9 : eps);

/* a match, with the fields the engine actually reads */
let _id = 0;
const game = (p1, p2, outcome, date, extra) => Object.assign({
  id: ++_id, status: 'approved', p1, p2, outcome, sets: '6-4, 6-4',
  created_at: date + 'T12:00:00.000Z'
}, extra || {});
const E = ms => loadElo({matches: ms});

/* the margin-of-victory gate, as dates either side of it */
const BEFORE_MOV  = '2026-07-01', AFTER_MOV  = '2026-08-01';
/* sum of ratings a table with n players who've all played must equal */
const pool = (S, start) => S.reduce((s, p) => s + p.rating, 0) - S.length * (start == null ? 500 : start);

/* ---------------------------------------------------------------- */
section('the plain Elo underneath everything');
{
  const e = E([]);
  ok(near(e.winProb(500, 500), 0.5), 'two equal players are a coin flip');
  ok(near(e.winProb(500 + e.DIVISOR, 500), 10 / 11),
     'a full divisor of advantage is 10:1', e.winProb(900, 500).toFixed(4));
  ok(near(e.winProb(400, 500) + e.winProb(500, 400), 1),
     'and the two sides of a match always sum to one');
  ok(e.winProb(2500, 500) > 0.99999 && e.winProb(2500, 500) < 1,
     'a gap no ladder will ever see is near-certain but not certain',
     e.winProb(2500, 500));
  /* and past about 4800 points the exponent underflows and it IS 1.0. That is
     float arithmetic, not a modelling claim, and it is pinned here so nobody
     later reads a 1.0 as a bug and 'fixes' the formula. */
  ok(e.winProb(1e6, 500) === 1, 'and an absurd one saturates to exactly 1, as doubles do');
}
{
  const e = E([game('A', 'B', 1, BEFORE_MOV, {sets: null})]);
  const S = e.computeStandings();
  const a = S.find(p => p.name === 'A'), b = S.find(p => p.name === 'B');
  ok(near(a.rating, e.START + e.K * 0.5), 'an even game won moves the winner by half of K',
     a.rating.toFixed(4));
  ok(near(a.rating - e.START, e.START - b.rating),
     'and the loser by exactly as much the other way');
  ok(near(pool(S, e.START), 0), 'so a game is strictly zero-sum', pool(S, e.START));
  ok(a.w === 1 && a.l === 0 && b.l === 1 && a.games === 1, 'the record reads 1-0 / 0-1');
  ok(near(a.peak, a.rating) && near(b.peak, e.START),
     'peak is the best rating ever held, not the current one');
}
{
  const e = E([game('A', 'B', 0.5, BEFORE_MOV, {sets: null})]);
  const S = e.computeStandings();
  ok(near(S[0].rating, 500) && near(S[1].rating, 500),
     'a draw between equals moves nobody');
  ok(S.every(p => p.d === 1 && p.w === 0 && p.l === 0), 'and is recorded as a draw on both sides');
}
{
  /* an unplayed name must not appear at all: a table with a 500-rated ghost
     in it is how a typo becomes a player */
  const e = E([game('A', 'B', 1, BEFORE_MOV)]);
  ok(e.computeStandings().length === 2, 'only the players who actually played are in the table');
}

section('the table is sorted, and the same history replays the same way');
{
  const ms = [
    game('A', 'B', 1, '2026-06-01'), game('C', 'A', 1, '2026-06-02'),
    game('B', 'C', 0.5, '2026-06-03'), game('A', 'C', 1, '2026-06-04'),
    game('B', 'A', 0, '2026-06-05')
  ];
  const e = E(ms);
  const one = e.computeStandings(), two = e.computeStandings();
  ok(one.map(p => p.name).join() === two.map(p => p.name).join()
     && one.every((p, i) => near(p.rating, two[i].rating)),
     'replaying the same history twice gives the same table to the point');
  ok(one.every((p, i) => i === 0 || one[i-1].rating >= p.rating),
     'the table comes back sorted by rating');
  /* the rows arrive from Supabase in no particular order, and the engine
     sorts by date itself — if it did not, the table would depend on the
     order the network happened to deliver the rows in */
  const shuffled = [ms[3], ms[0], ms[4], ms[2], ms[1]];
  const s2 = E(shuffled).computeStandings();
  ok(s2.every((p, i) => p.name === one[i].name && near(p.rating, one[i].rating)),
     'and the row order the server sends them in makes no difference');
}
{
  const e = E([game('A', 'B', 1, '2026-06-01'), game('A', 'B', 1, '2026-06-02', {status: 'pending'}),
               game('A', 'B', 1, '2026-06-03', {status: 'rejected'})]);
  ok(e.computeStandings()[0].games === 1,
     'only approved games count — a pending result moves nothing yet');
}
{
  const counted = loadElo({
    matches: [game('A', 'B', 1, '2026-06-01'), game('A', 'B', 1, '2026-06-02', {tournament_id: 9})],
    countsForElo: m => !m.tournament_id
  });
  ok(counted.computeStandings()[0].games === 1,
     'and an event the league says is an exhibition moves nothing either');
}

section('margin of victory — a dominant win is worth more, unless it was expected');
{
  const e = E([]);
  const at = (sets, rW, rL, date) => e.movMultiplier(
    {created_at: (date || AFTER_MOV) + 'T12:00:00Z', outcome: 1, sets}, rW, rL);

  ok(at('6-4, 6-4', 500, 500) > 1, 'a comfortable win between equals earns a bonus',
     at('6-4, 6-4', 500, 500).toFixed(3));
  ok(at('6-0, 6-0', 500, 500) > at('7-6, 7-6', 500, 500),
     'and a bagel earns more than a squeaker');
  ok(at('6-0, 6-0', 500, 900) > at('6-0, 6-0', 900, 500),
     'an underdog demolition is worth more than a favourite doing the same thing');
  ok(at('6-4, 6-4', 1400, 500) >= e.MOV_MIN,
     'a heavy favourite grinding one out is never worth LESS than a plain win',
     at('6-4, 6-4', 1400, 500).toFixed(3));

  /* the properties that stop one result from doing something silly */
  const many = ['6-0, 6-0', '6-1, 6-0', '7-5, 6-4', '6-4, 3-6, 6-4', '7-6, 6-7, 7-6'];
  let inBand = true;
  many.forEach(s => [[500,500],[900,400],[400,900],[1200,300]].forEach(([w, l]) => {
    const v = at(s, w, l);
    if(!(v >= e.MOV_MIN - 1e-12 && v <= e.MOV_MAX + 1e-12)) inBand = false;
  }));
  ok(inBand, 'every combination stays inside [MOV_MIN, MOV_MAX]',
     e.MOV_MIN + '..' + e.MOV_MAX);

  ok(at(null, 500, 500) === 1, 'no scoreline means no margin information, so no bonus');
  ok(e.movMultiplier({created_at: AFTER_MOV + 'T12:00:00Z', outcome: 0.5, sets: '6-4, 6-4'}, 500, 500) === 1,
     'a draw has no margin at all');
  ok(at('rubbish, nonsense', 500, 500) === 1, 'and an unparseable one is treated as absent');
  /* won the match, lost more games than won — the score says the winner was
     outplayed, so there is nothing to reward */
  ok(at('0-6, 7-6, 7-6', 500, 500) === 1,
     'winning on paper while losing the game count earns no bonus at all',
     at('0-6, 7-6, 7-6', 500, 500).toFixed(3));
}
{
  const e = E([]);
  const sweep = (date, rW, rL) => e.movMultiplier(
    {created_at: date + 'T12:00:00Z', outcome: 1, sets: '6-1, 6-0'}, rW, rL);
  ok(sweep('2026-09-01', 1600, 400) >= e.BLOWOUT_FLOOR_MULT,
     'a near-perfect sweep clears the blowout floor even against a heavy underdog',
     sweep('2026-09-01', 1600, 400).toFixed(3));
  ok(sweep('2026-08-01', 1600, 400) < e.BLOWOUT_FLOOR_MULT,
     'and that floor does not reach back before the day it was introduced',
     sweep('2026-08-01', 1600, 400).toFixed(3));
}

section('K is flat and symmetric — every game is zero-sum');
{
  const e = E([]);
  const k = e.matchKPair({created_at: AFTER_MOV + 'T12:00:00Z', outcome: 1, sets: '6-4, 6-4'}, 500, 500);
  ok(near(k.kA, k.kB), 'both sides of a match always get the same K', JSON.stringify(k));

  /* a newcomer against a veteran with fifty games under them: nothing about
     experience or a layoff changes the size of the step either side takes */
  const veteranHistory = [];
  for(let i = 0; i < 50; i++)
    veteranHistory.push(game('Vet', 'Filler' + i, 1, '2026-08-' + String((i % 28) + 1).padStart(2, '0')));
  const before = E(veteranHistory).computeStandings().find(p => p.name === 'Vet').rating;
  const S = E(veteranHistory.concat([game('New', 'Vet', 1, '2026-09-05')])).computeStandings();
  const vet = S.find(p => p.name === 'Vet'), nu = S.find(p => p.name === 'New');
  ok(near(Math.abs(nu.rating - 500), Math.abs(vet.rating - before)),
     'so a newcomer and a fifty-game veteran move by exactly the same amount',
     (nu.rating - 500).toFixed(4) + ' vs ' + (vet.rating - before).toFixed(4));
  ok(near(pool(S, e.START), 0), 'and the pool stays at players x START no matter who played',
     pool(S, e.START));
}

section('ratings as they stood before a given game');
{
  const ms = [game('A', 'B', 1, '2026-06-01'), game('A', 'B', 1, '2026-06-02'),
              game('B', 'A', 1, '2026-06-03')];
  const e = E(ms);
  const pre = e.preGameRatings(ms[2].id);
  const twoGames = E(ms.slice(0, 2)).computeStandings();
  ok(near(pre['A'], twoGames.find(p => p.name === 'A').rating, 1e-9),
     'the ratings before game three are exactly the table after game two');
  ok(near(e.preGameRatings(ms[0].id)['A'], e.START),
     'and before the first game everybody is on the starting rating');
}

section('THE DATE GATES — the promise that history is never re-scored');
/* Margin of victory was shipped with an explicit undertaking that it would
   not change a single rating already on record. That undertaking is
   enforced by a string comparison and nothing else, so this is the section
   that has to hold. */
{
  const e = E([]);
  ok(e.MOV_START < e.BLOWOUT_FLOOR_START,
     'the two gates are in the order they were introduced',
     [e.MOV_START, e.BLOWOUT_FLOOR_START].join(' < '));

  const one = sets => ({created_at: '', outcome: 1, sets});
  const on  = d => Object.assign(one('6-0, 6-0'), {created_at: d + 'T12:00:00.000Z'});
  ok(e.movMultiplier(on('2026-07-22'), 500, 500) === 1,
     'the day before MOV_START, a bagel is worth a plain win');
  ok(e.movMultiplier(on('2026-07-23'), 500, 500) > 1,
     'and on the day itself it is worth more — the gate is inclusive');
}
{
  /* the end-to-end version: any history must produce ratings reachable by
     hand with a flat K=32 — there is no gate left for K itself, since it is
     always flat, so this holds for the whole log, not just a pre-gate slice */
  const hist = [];
  for(let i = 0; i < 24; i++){
    const d = '2026-0' + (1 + (i % 5)) + '-' + String((i % 27) + 1).padStart(2, '0');
    hist.push(game('P' + (i % 5), 'P' + ((i + 2) % 5), i % 3 === 0 ? 0 : (i % 3 === 1 ? 1 : 0.5), d,
                   {sets: ['6-0, 6-0', '7-6, 7-6', '6-4, 3-6, 6-4'][i % 3]}));
  }
  const real = E(hist).computeStandings();
  const e = E(hist);
  let byHand = {};
  const ensure = n => (byHand[n] === undefined ? (byHand[n] = e.START) : byHand[n]);
  hist.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(m => {
    ensure(m.p1); ensure(m.p2);
    const Ea = 1 / (1 + Math.pow(10, (byHand[m.p2] - byHand[m.p1]) / e.DIVISOR));
    const mov = e.movMultiplier(m, m.outcome === 1 ? byHand[m.p1] : byHand[m.p2],
                                   m.outcome === 1 ? byHand[m.p2] : byHand[m.p1]);
    const k = e.K * mov, Sa = Number(m.outcome);
    const a = byHand[m.p1], b = byHand[m.p2];
    byHand[m.p1] = a + k * (Sa - Ea);
    byHand[m.p2] = b + k * ((1 - Sa) - (1 - Ea));
  });
  ok(real.every(p => near(p.rating, byHand[p.name], 1e-9)),
     'and matches a flat-K replay written out by hand, to the point',
     real.map(p => p.name + ':' + p.rating.toFixed(6)).join(' '));
  ok(near(pool(real, e.START), 0), 'with no drift, because the two Ks never differ');
}

section('the memo — sixty-four callers, one replay');
{
  /* computeStandings() is called 64 times from index.html and replays the
     whole league every time. The cache rests on one property of the rest of
     the app — `matches` is never mutated in place, only replaced — so these
     check both halves: that a repeat call is the same answer, and that a
     replaced array really is a different one. */
  const ms = [];
  for(let i = 0; i < 60; i++)
    ms.push(game('P' + (i % 6), 'P' + ((i + 2) % 6), i % 2, '2026-06-' + String((i % 28) + 1).padStart(2, '0')));
  const e = E(ms);
  const a = e.computeStandings();
  const b = e.computeStandings();
  ok(a.length === b.length && a.every((p, i) => p.name === b[i].name && near(p.rating, b[i].rating)),
     'a repeat call is the same table');
  ok(a !== b, 'but a different array, so one caller cannot reorder everybody else\'s');
  a.sort((x, y) => x.name.localeCompare(y.name));
  a.reverse();
  const c = e.computeStandings();
  ok(c.every((p, i) => p.name === b[i].name),
     'and a caller that sorts what it was handed does not poison the next call');
  ok(near(pool(b, e.START), 0), 'a cache hit is still a zero-sum table, not stale from some other replay');

  /* the invalidation the app actually relies on: a new array */
  e.setMatches(ms.slice(0, 10));
  ok(e.computeStandings().length <= 6 && e.computeStandings()[0].games <= 10,
     'replacing the match array replaces the answer');
  e.setMatches(ms);
  ok(e.computeStandings().every((p, i) => near(p.rating, b[i].rating)),
     'and putting the old one back gives the old table exactly');

  /* and the explicit escape hatch, for a future write path that does mutate */
  e.invalidateStandings();
  ok(e.computeStandings().every((p, i) => near(p.rating, b[i].rating)),
     'a forced invalidation recomputes to the same answer rather than a different one');
}
{
  /* DIVISOR is live-adjustable from the admin divisor preview, so it is part
     of the key — a cache that ignored it would show the old ladder after the
     one setting whose entire purpose is to change the ladder */
  const ms = [game('A', 'B', 1, '2026-06-01'), game('B', 'C', 1, '2026-06-02')];
  const e = E(ms);
  const before = e.computeStandings().map(p => p.rating);
  e.setDivisor(100);
  const after = e.computeStandings().map(p => p.rating);
  ok(before.some((v, i) => !near(v, after[i])),
     'changing the divisor changes the table rather than serving the cached one',
     before.map(v => v.toFixed(2)).join() + ' -> ' + after.map(v => v.toFixed(2)).join());
  e.setDivisor(400);
  ok(e.computeStandings().every((p, i) => near(p.rating, before[i])),
     'and putting it back puts the table back');
}

section('the engine does not fall over on the rows it will actually be handed');
{
  ok(E([]).computeStandings().length === 0, 'an empty league is an empty table');
  const odd = [
    game('A', 'B', 1, '2026-06-01', {sets: ''}),
    game('A', 'B', '1', '2026-06-02'),                 // outcome as a string
    game('A', 'B', 1, '2026-06-03', {sets: '6-, -4'}),  // half a scoreline
    game('A', 'B', 0, '2026-06-04', {sets: '6-4, 6-4, '})
  ];
  const S = E(odd).computeStandings();
  ok(S.length === 2 && S.every(p => isFinite(p.rating)),
     'and none of the malformed rows a real database contains produce a NaN rating',
     S.map(p => p.name + ':' + p.rating.toFixed(2)).join(' '));
  ok(S.every(p => p.games === 4), 'every one of them still counts as a game played');
}
{
  /* the same two people, one of them entered with different capitalisation.
     The engine keys on the exact string, so these ARE two players — which is
     precisely why the admin screen has a rename/merge tool. Pinning it here
     so the behaviour is a decision rather than a surprise. */
  const S = E([game('A', 'B', 1, '2026-06-01'), game('a', 'B', 1, '2026-06-02')]).computeStandings();
  ok(S.length === 3,
     'two spellings of a name are two players — what rename/merge exists to fix', S.length);
}

section('a decider played as a breaker — the set score that is not a set score');
{
  const e = E([]);
  const AFTER_BRK  = '2026-10-01';   // on/after MOV_BREAKER_START
  const BEFORE_BRK = '2026-09-01';   // before it

  /* the classifier itself, because everything below leans on it */
  ok(e.setPairs('6-4, 3-6, 10-7').length === 3, 'three pairs come back out of three sets');
  ok(e.setPairs('6-, rubbish, 6-4').length === 1,
     'and an unreadable pair drops out rather than arriving as NaN');
  ok(e.setOversized({a: 10, b: 7}) && !e.setOversized({a: 7, b: 6}),
     'no set finishes above ' + e.SET_MAX_GAMES + ' games, so 10-7 is not a set and 7-6 is');
  ok(e.breakerIndex(e.setPairs('6-4, 3-6, 10-7')) === 2,
     'the last pair of a three-set score, above the ceiling, is the breaker');
  ok(e.breakerIndex(e.setPairs('11-8')) === -1,
     'but a lone pair is a whole match written short — a group game to 11, not a decider');
  ok(e.breakerIndex(e.setPairs('6-4, 3-6, 6-4')) === -1 &&
     e.breakerIndex(e.setPairs('6-4, 3-6, 4-2')) === -1,
     'and a real third set is a real third set, full or first-to-3');

  const at = (sets, date, rW, rL) => e.movMultiplier(
    {created_at: (date || AFTER_BRK) + 'T12:00:00Z', outcome: 1, sets}, rW || 500, rL || 500);

  /* THE BUG THIS SECTION EXISTS FOR, stated as the comparison that fails
     without the fix: summed at face value a 10-2 breaker is a ten-games-to-two
     set, so scraping through a breaker read as MORE dominant than winning the
     same match by bagelling the third set. It measured 1.377 against 1.354. */
  ok(at('6-4, 4-6, 10-2') < at('6-4, 4-6, 6-0'),
     'squeaking a breaker is less dominant than bagelling a real third set',
     at('6-4, 4-6, 10-2').toFixed(3) + ' vs ' + at('6-4, 4-6, 6-0').toFixed(3));
  ok(at('6-4, 4-6, 10-2') < at('6-0, 6-0'),
     'and nothing with a breaker in it out-dominates a double bagel',
     at('6-4, 4-6, 10-2').toFixed(3) + ' vs ' + at('6-0, 6-0').toFixed(3));

  /* and it should read like the third set it stood in for */
  const asBreaker = at('6-2, 4-6, 10-7'), asSet = at('6-2, 4-6, 6-4');
  ok(Math.abs(asBreaker - asSet) < 0.05,
     'a breaker decider is worth about what a close third set is worth',
     asBreaker.toFixed(3) + ' vs ' + asSet.toFixed(3));
  ok(at('6-2, 4-6, 10-7') <= at('6-2, 4-6, 10-2'),
     'a tighter breaker is never worth more than a one-sided one');

  /* the date gate, same promise the rest of the engine makes: the table is
     recomputed from the rows on every load, so a change to how a score is
     READ moves published ratings unless it starts on a day */
  ok(at('6-4, 4-6, 10-2', BEFORE_BRK) > at('6-4, 4-6, 10-2', AFTER_BRK),
     'the old face-value reading still stands before MOV_BREAKER_START',
     e.MOV_BREAKER_START);
  ok(at('6-4, 6-4', BEFORE_BRK) === at('6-4, 6-4', AFTER_BRK),
     'and nothing without a breaker in it changes on either side of that date');

  /* the blowout floor divides conceded games by sets played, and a breaker
     now concedes 0 or 1 — check that cannot fake a near-perfect sweep */
  ok(at('6-0, 0-6, 10-0', AFTER_BRK, 1600, 400) < e.BLOWOUT_FLOOR_MULT,
     'a match with a set dropped in it never clears the blowout floor',
     at('6-0, 0-6, 10-0', AFTER_BRK, 1600, 400).toFixed(3));

  /* and the whole thing has to survive being replayed into a table */
  const S = E([game('A', 'B', 1, AFTER_BRK, {sets: '6-2, 4-6, 10-7'})]).computeStandings();
  ok(S.length === 2 && S.every(p => isFinite(p.rating)),
     'a breaker match replays into finite ratings',
     S.map(p => p.name + ':' + p.rating.toFixed(2)).join(' '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
