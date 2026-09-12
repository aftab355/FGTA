/* The Fall Exhibition leaderboard: net Elo gained from a Sept 13 baseline,
   using only fall-window games, replayed through the exact same engine the
   main ladder uses. It is deliberately a second function rather than a
   branch inside computeStandings() — the one function elo.test.js exists to
   protect — so this file protects the second one the same way: the baseline
   math, the eligibility floor, and the end-date cutoff that "finalizes" the
   event are exactly the parts nobody would notice breaking by eye, because
   the main ladder keeps looking correct while this quietly drifts.

   node test/fall-exhibition.test.js   (no dependencies) */
const {loadFallExhibition, loadElo} = require('./extract.js');

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.02 : eps);

/* No 'Z': FALL_START itself is parsed as local midnight (see the region's own
   comment), so matches have to share that local-time reading rather than a
   UTC one, or the boundary could land on the wrong side of a game depending
   on the machine running the test. */
let _id = 0;
const game = (p1, p2, outcome, date, extra) => Object.assign({
  id: ++_id, status: 'approved', p1, p2, outcome, sets: null,
  created_at: date + 'T12:00:00'
}, extra || {});

const find = (rows, name) => rows.find(r => r.name === name);

/* ---------------------------------------------------------------- */
section('the baseline is exactly the pre-fall replay, nothing more');
{
  /* well before MOV_START (2026-07-23) and DYNK_START (2026-08-29), so this
     is plain flat-K Elo — easy to cross-check against the real engine's own
     computeStandings() rather than hand-deriving numbers a second time */
  const pre = [
    game('A', 'B', 1, '2026-01-01'),
    game('B', 'A', 1, '2026-01-05'),
    game('A', 'C', 0.5, '2026-01-10')
  ];
  const fall = [
    game('A', 'D', 1, '2026-09-14'),
    game('A', 'D', 1, '2026-09-16'),
    game('A', 'D', 0, '2026-09-18')
  ];
  const all = pre.concat(fall);

  const expected = loadElo({matches: pre}).computeStandings();
  const expA = find(expected, 'A').rating;

  const FX = loadFallExhibition({matches: all});
  const out = FX.computeFallExhibition('2026-11-30');
  const a = find(out.eligible, 'A') || find(out.pending, 'A');

  ok(!!a, 'A appears once they have played a fall game');
  ok(near(a.baseline, expA),
     'baseline equals the plain pre-fall replay, not something re-derived',
     a && a.baseline + ' vs ' + expA);

  const fullReplay = loadElo({matches: all}).computeStandings();
  const fullA = find(fullReplay, 'A').rating;
  ok(near(a.rating, fullA), "the fall entry's current rating matches the real ladder's", a.rating + ' vs ' + fullA);
  ok(near(a.gain, fullA - expA), 'gain is exactly current minus baseline, no third number involved');
}

/* ---------------------------------------------------------------- */
section('a player whose first game ever falls inside the fall window');
{
  const all = [
    game('X', 'Y', 1, '2026-09-14'),
    game('X', 'Y', 1, '2026-09-15'),
    game('X', 'Y', 1, '2026-09-16')
  ];
  const FX = loadFallExhibition({matches: all});
  const out = FX.computeFallExhibition('2026-11-30');
  const x = find(out.eligible, 'X') || find(out.pending, 'X');
  ok(!!x && near(x.baseline, FX.START), 'baseline is the plain starting rating, same as a brand-new ladder entry', x && x.baseline);
}

/* ---------------------------------------------------------------- */
section('the 3-game eligibility floor');
{
  const all = [
    game('A', 'B', 1, '2026-09-14'),
    game('A', 'B', 1, '2026-09-15'),   // A: 2 fall games
    game('C', 'D', 1, '2026-09-14'),
    game('C', 'D', 1, '2026-09-15'),
    game('C', 'D', 1, '2026-09-16')    // C: 3 fall games
  ];
  const FX = loadFallExhibition({matches: all});
  const out = FX.computeFallExhibition('2026-11-30');
  ok(!!find(out.pending, 'A'), 'two fall games sits in the pending list');
  ok(!find(out.eligible, 'A'), 'and not in the ranked list');
  ok(find(out.pending, 'A').fallGames === 2, "pending carries the player's actual fall-game count");
  ok(!!find(out.eligible, 'C'), 'three fall games clears the floor');
  ok(!find(out.pending, 'C'), 'and drops out of the pending list once it does');
}

/* ---------------------------------------------------------------- */
section('nothing before FALL_START counts as a fall game');
{
  const all = [
    game('A', 'B', 1, '2026-09-01'),   // pre-fall — sets the baseline, is not a fall game
    game('A', 'B', 1, '2026-09-14'),
    game('A', 'B', 1, '2026-09-15'),
    game('A', 'B', 1, '2026-09-16')
  ];
  const FX = loadFallExhibition({matches: all});
  const out = FX.computeFallExhibition('2026-11-30');
  const a = find(out.eligible, 'A');
  ok(!!a && a.fallGames === 3, 'the Sept 1 game is excluded from the fall-game count', a && a.fallGames);
}

/* ---------------------------------------------------------------- */
section('the event finalizes on the admin end date — later games do not exist to it');
{
  const upTo30 = [
    game('A', 'B', 1, '2026-09-14'),
    game('A', 'B', 1, '2026-09-16'),
    game('A', 'B', 1, '2026-09-18')
  ];
  const afterEnd = upTo30.concat([
    game('A', 'B', 0, '2026-12-05')   // played after the Nov 30 end date
  ]);
  const FX1 = loadFallExhibition({matches: upTo30});
  const FX2 = loadFallExhibition({matches: afterEnd});
  const out1 = FX1.computeFallExhibition('2026-11-30');
  const out2 = FX2.computeFallExhibition('2026-11-30');
  const a1 = find(out1.eligible, 'A'), a2 = find(out2.eligible, 'A');
  ok(near(a1.gain, a2.gain), 'a game after the end date moves neither the gain...', a1.gain + ' vs ' + a2.gain);
  ok(a1.fallGames === a2.fallGames, '...nor the fall-game count');
}

/* ---------------------------------------------------------------- */
section('an event that does not count for Elo does not count for the fall window either');
{
  const all = [
    game('A', 'B', 1, '2026-09-14', {exempt: true}),
    game('A', 'B', 1, '2026-09-15', {exempt: true}),
    game('A', 'B', 1, '2026-09-16')   // the only real one
  ];
  const countsForElo = m => !m.exempt;
  const FX = loadFallExhibition({matches: all, countsForElo});
  const out = FX.computeFallExhibition('2026-11-30');
  const a = find(out.pending, 'A');
  ok(!!a && a.fallGames === 1, 'exempt games are invisible to the replay, same as the main ladder', a && a.fallGames);
}

/* ---------------------------------------------------------------- */
section('ranking order');
{
  const all = [
    // C gains the most, A gains a little, both clear 3 games
    game('C', 'Z', 1, '2026-09-14'), game('C', 'Z', 1, '2026-09-15'), game('C', 'Z', 1, '2026-09-16'),
    game('A', 'Z', 1, '2026-09-14'), game('A', 'Z', 0.5, '2026-09-15'), game('A', 'Z', 0.5, '2026-09-16'),
    // E has one more fall game than D, both short of the floor
    game('D', 'Z', 1, '2026-09-14'),
    game('E', 'Z', 1, '2026-09-14'), game('E', 'Z', 1, '2026-09-15')
  ];
  const FX = loadFallExhibition({matches: all});
  const out = FX.computeFallExhibition('2026-11-30');
  ok(out.eligible.length >= 2 && out.eligible[0].gain >= out.eligible[1].gain,
     'eligible players sort by gain, biggest first',
     out.eligible.map(r => r.name + ':' + r.gain.toFixed(1)).join(' '));
  ok(out.pending.length >= 2 && out.pending[0].fallGames >= out.pending[1].fallGames,
     'pending players sort by fall-game count, closest to eligible first',
     out.pending.map(r => r.name + ':' + r.fallGames).join(' '));
}

/* ---------------------------------------------------------------- */
section('a player who never plays in the fall window simply is not on this leaderboard');
{
  const all = [
    game('A', 'B', 1, '2026-06-01'),
    game('A', 'B', 1, '2026-06-02')
  ];
  const FX = loadFallExhibition({matches: all});
  const out = FX.computeFallExhibition('2026-11-30');
  ok(!find(out.eligible, 'A') && !find(out.pending, 'A'),
     'no fall games means no baseline was ever taken, so there is nothing to show — not a silent zero');
  ok(out.eligible.length === 0 && out.pending.length === 0, 'the leaderboard is genuinely empty, not padded with zeros');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
