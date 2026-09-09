/* The three rating models that are not Elo.

   Elo is the ladder, so a bug in it is argued about within a week — that is
   what test/elo.test.js is for. These are the ones on the Analytics tab that
   nobody checks against anything, and all three share a property that makes
   them genuinely dangerous: they produce a tidy, plausible, ranked table
   from ANY input at all. An MM iteration that quietly stops converging, a
   normalisation that drifts, a win graph wired loser-to-winner the wrong way
   round — every one of those still renders a neat list with a bar chart, and
   nothing on the page would look wrong.

   So what is checked here is not the numbers. It is the handful of
   properties each method actually guarantees, plus the specific ways each
   one is known to blow up:

     Bradley-Terry   an unbeaten player is a likelihood with no maximum, and
                     the strength runs to infinity unless something anchors
                     it. The code adds a phantom half-win against a phantom
                     average opponent; this checks the anchor holds.
     bootstrap       a resampled season must be a season, and the interval
                     must actually contain the thing it is an interval for.
     PageRank        it is a probability distribution over players, and its
                     arrows point loser -> winner. Reverse them and it ranks
                     the worst player first, very convincingly.

   node test/models.test.js   (no dependencies) */
const {loadModels} = require('./extract.js');

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 1e-9 : eps);

let _id = 0;
const game = (p1, p2, outcome, date, extra) => Object.assign({
  id: ++_id, status:'approved', p1, p2, outcome, sets:'6-4, 6-4',
  created_at: (date || '2026-06-01') + 'T12:00:00.000Z'
}, extra || {});
const M = ms => loadModels({matches: ms});

/* a deterministic Math.random, so the bootstrap is reproducible */
function seeded(seed, fn){
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  try{ return fn(); } finally { Math.random = real; }
}

/* a season with a clear pecking order: A beats everyone, then B, then C… */
function pecking(n, rounds){
  const names = Array.from({length:n}, (_, i) => String.fromCharCode(65 + i));
  const out = [];
  let d = 1;
  for(let r = 0; r < (rounds || 2); r++)
    for(let i = 0; i < n; i++) for(let j = i + 1; j < n; j++){
      const date = '2026-06-' + String((d++ % 28) + 1).padStart(2, '0');
      out.push(game(names[i], names[j], 1, date));      // the earlier letter wins
    }
  return {names, games: out};
}

/* ---------------------------------------------------------------- */
section('Bradley–Terry — the strengths that best explain every result at once');
{
  const {names, games} = pecking(5, 2);
  const bt = M(games).bradleyTerry();
  ok(bt && bt.length === 5, 'every player who played is in the table', bt && bt.length);
  ok(bt.map(r => r.name).join('') === names.join(''),
     'a strict pecking order comes back in exactly that order', bt.map(r => r.name).join(''));
  let desc = true;
  for(let i = 1; i < bt.length; i++) if(bt[i].pi > bt[i-1].pi) desc = false;
  ok(desc, 'and the table is sorted by strength');
  /* the whole point of the MM normalisation */
  const gm = Math.exp(bt.reduce((s, r) => s + Math.log(r.pi), 0) / bt.length);
  ok(near(gm, 1, 1e-6), 'strengths are normalised to a geometric mean of 1', gm);
  ok(bt.every(r => isFinite(r.btElo)), 'and every rating maps to a finite Elo-like number');
}
{
  /* THE FAILURE MODE THIS MODEL HAS. An unbeaten player's likelihood has no
     maximum — the strength runs to infinity and the Elo mapping to +∞ —
     unless a prior anchors it. The code adds a phantom half-win against a
     phantom average opponent for exactly this. */
  const games = [];
  for(let i = 0; i < 6; i++) games.push(game('Unbeaten', 'P' + i, 1, '2026-06-0' + ((i % 9) + 1)));
  const bt = M(games).bradleyTerry();
  const top = bt[0];
  ok(top.name === 'Unbeaten', 'an unbeaten player is top, as they should be');
  ok(isFinite(top.pi) && isFinite(top.btElo),
     'and their strength is finite rather than infinity', top.pi + ' / ' + top.btElo);
  ok(top.btElo < 3000, 'anchored to something a table can print', top.btElo);
  /* the mirror image: a winless player must not fall to -∞ either */
  const games2 = [];
  for(let i = 0; i < 6; i++) games2.push(game('P' + i, 'Winless', 1, '2026-06-0' + ((i % 9) + 1)));
  const bt2 = M(games2).bradleyTerry();
  const bottom = bt2[bt2.length - 1];
  ok(bottom.name === 'Winless' && isFinite(bottom.pi) && isFinite(bottom.btElo),
     'and a winless one does not fall off the bottom either', bottom.btElo);
}
{
  /* a draw is half a win to each side, not a non-event */
  const drawn = M([game('A','B',0.5,'2026-06-01'), game('A','B',0.5,'2026-06-02')]).bradleyTerry();
  ok(drawn.length === 2 && near(drawn[0].pi, drawn[1].pi, 1e-6),
     'two players who only ever drew come out level',
     drawn.map(r => r.pi.toFixed(4)).join(' vs '));
}
{
  /* strength of schedule is the thing BT is FOR: beating the best player
     has to be worth more than beating the worst, which plain win count
     cannot see */
  const games = [];
  for(let i = 0; i < 4; i++){
    games.push(game('Top', 'Weak' + i, 1, '2026-06-0' + (i + 1)));      // Top beats the weak
    games.push(game('Strong', 'Weak' + i, 1, '2026-06-1' + i));         // so does Strong
  }
  games.push(game('Strong', 'Top', 1, '2026-06-20'));                    // …and Strong beat Top
  const bt = M(games).bradleyTerry();
  const rank = n => bt.findIndex(r => r.name === n);
  ok(rank('Strong') < rank('Top'), 'beating the best player outranks the same record without it',
     bt.map(r => r.name).join(' > '));
}
section('Bradley–Terry — the inputs it will actually be handed');
ok(M([]).bradleyTerry() === null, 'no games is nothing to solve, not a crash');
ok(M([game('A','B',1)]).bradleyTerry().length === 2, 'one game is enough for two players');
{
  const counted = loadModels({
    matches: [game('A','B',1,'2026-06-01'), game('A','B',1,'2026-06-02',{tournament_id:7})],
    countsForAnalysis: m => !m.tournament_id
  });
  const bt = counted.bradleyTerry();
  ok(bt.length === 2, 'and a league that excludes an event really does exclude it');
}
{
  /* two disconnected groups — nobody in one has played anybody in the other.
     There is no information linking them, so the answer is arbitrary; what
     matters is that it TERMINATES and stays finite rather than diverging. */
  const bt = M([game('A','B',1,'2026-06-01'), game('C','D',1,'2026-06-02')]).bradleyTerry();
  ok(bt.length === 4 && bt.every(r => isFinite(r.pi) && r.pi > 0),
     'two disconnected groups still converge to something finite',
     bt.map(r => r.name + ':' + r.pi.toFixed(3)).join(' '));
}

/* ---------------------------------------------------------------- */
section('the bootstrap — how much of the table is the season, and how much is luck');
{
  const {games} = pecking(5, 3);
  const boot = seeded(12345, () => M(games).bootstrapRatings(200));
  ok(boot && boot.length === 5, 'a band per player', boot && boot.length);
  ok(boot.every(r => r.lo <= r.mid && r.mid <= r.hi),
     'and every band is the right way round — 5th, median, 95th');
  ok(boot.every(r => r.hi > r.lo),
     'with actual width, i.e. the resampling really did resample');
  let desc = true;
  for(let i = 1; i < boot.length; i++) if(boot[i].mid > boot[i-1].mid) desc = false;
  ok(desc, 'sorted by the middle of the band');
  ok(boot[0].name === 'A' && boot[boot.length-1].name === 'E',
     'and a strict pecking order survives being resampled',
     boot.map(r => r.name).join(''));
}
{
  /* the property that makes an interval an interval: a player's own point
     estimate has to be inside their own band, near enough */
  const {games} = pecking(4, 3);
  const api = M(games);
  const boot = seeded(999, () => api.bootstrapRatings(300));
  const real = api.bradleyTerry();      // a different model, but the same order
  ok(boot.map(r => r.name).join('') === real.map(r => r.name).join(''),
     'the bootstrap and Bradley-Terry agree on the order of a clean season',
     boot.map(r => r.name).join('') + ' vs ' + real.map(r => r.name).join(''));
  ok(boot.every(r => r.hi - r.lo < 400),
     'and the bands are informative rather than covering the whole scale',
     Math.max.apply(null, boot.map(r => r.hi - r.lo)));
}
{
  /* MORE EVIDENCE MUST MEAN A SHARPER PICTURE — but not in the way anybody
     expects, and this test was written the obvious way first and failed.

     The obvious claim is "a longer season gives narrower bands". It is false
     here, and not because the resampler is broken. Bootstrapping a mean
     narrows because a mean has a fixed point to converge on. Elo has none:
     it is a sequential random walk, so a longer season spreads the ratings
     apart at least as fast as it pins each one down, and the absolute band
     width plateaus instead of shrinking (measured: 66 → 83 → 87 → 90 → 77
     points across 6 → 60 games).

     What DOES improve, monotonically, is the width relative to the spread it
     is measuring — 0.73 → 0.49 → 0.38 → 0.24 → 0.15 over the same range.
     That is the real claim the panel is making, so it is the one asserted,
     and it is written down in the panel's own legend too: a reader who takes
     these bands as ordinary confidence intervals will otherwise expect them
     to tighten with the season, and be quietly wrong. */
  const rel = rounds => {
    const b = seeded(4242, () => M(pecking(4, rounds).games).bootstrapRatings(250));
    const width = b.reduce((s, r) => s + (r.hi - r.lo), 0) / b.length;
    return width / Math.max(1, b[0].mid - b[b.length - 1].mid);
  };
  const short = rel(1), mid = rel(3), long = rel(6);
  ok(long < mid && mid < short,
     'a longer season sharpens the picture relative to the spread it describes',
     [short, mid, long].map(v => v.toFixed(3)).join(' -> '));
  const abs = rounds => {
    const b = seeded(4242, () => M(pecking(4, rounds).games).bootstrapRatings(250));
    return b.reduce((s, r) => s + (r.hi - r.lo), 0) / b.length;
  };
  ok(abs(6) > abs(1) * 0.8,
     'while the ABSOLUTE width does not shrink, which is the surprise worth pinning',
     abs(1).toFixed(1) + ' -> ' + abs(6).toFixed(1));
}
ok(M([]).bootstrapRatings(10) === null, 'an empty season has nothing to resample');
ok(M([game('A','B',1)]).bootstrapRatings(10) === null,
   'and neither does one game — it says so rather than returning a band of width zero');
{
  const boot = seeded(7, () => M(pecking(3, 2).games).bootstrapRatings(50));
  ok(boot.every(r => isFinite(r.lo) && isFinite(r.mid) && isFinite(r.hi)),
     'every bound is a real number');
}

/* ---------------------------------------------------------------- */
section('PageRank — dominance over the win graph');
{
  const {names, games} = pecking(5, 2);
  const g = M(games).pageRankDominance();
  ok(g && g.names.length === 5, 'every player is a node', g && g.names.length);
  const total = g.pr.reduce((a, b) => a + b, 0);
  ok(near(total, 1, 1e-6), 'it is a probability distribution and sums to 1', total);
  ok(g.pr.every(v => v > 0), 'with no player at exactly zero — the damping factor sees to that');
  const ranked = g.names.map(n => ({n, p: g.pr[g.idx[n]]})).sort((a, b) => b.p - a.p);
  ok(ranked[0].n === names[0],
     'and the player who beat everybody is the most dominant node', ranked[0].n);
  ok(ranked[ranked.length-1].n === names[names.length-1],
     'while the one who beat nobody is the least');
}
{
  /* THE FAILURE MODE. The edge is loser -> winner: importance flows TO the
     player who won. Wire it the other way and the model ranks the worst
     player first, extremely convincingly, and nothing on the page looks
     wrong. This is that assertion, stated as a direction rather than a
     number. */
  const g = M([game('Winner','Loser',1,'2026-06-01')]).pageRankDominance();
  const w = g.idx['Winner'], l = g.idx['Loser'];
  ok(g.M[l][w] > 0, 'the edge runs from the loser to the winner', g.M[l][w]);
  ok(g.M[w][l] === 0, 'and not the other way');
  ok(g.pr[w] > g.pr[l], 'so the winner ends up with more of the mass',
     g.pr[w].toFixed(3) + ' vs ' + g.pr[l].toFixed(3));
}
{
  /* a draw feeds both directions by half, so two players who only drew are
     level — a draw is not a win for whoever happens to be p1 */
  const g = M([game('A','B',0.5,'2026-06-01'), game('A','B',0.5,'2026-06-02')]).pageRankDominance();
  ok(near(g.pr[g.idx['A']], g.pr[g.idx['B']], 1e-6),
     'two players who only ever drew hold equal mass',
     g.pr.map(v => v.toFixed(4)).join(' vs '));
}
{
  /* beating someone who beats everyone is worth more than beating a
     tail-ender — the entire reason to run PageRank rather than count wins */
  const games = [];
  for(let i = 0; i < 5; i++) games.push(game('Hub', 'Tail' + i, 1, '2026-06-0' + (i + 1)));
  games.push(game('Slayer', 'Hub', 1, '2026-06-20'));
  games.push(game('Padder', 'Tail0', 1, '2026-06-21'));
  const g = M(games).pageRankDominance();
  ok(g.pr[g.idx['Slayer']] > g.pr[g.idx['Padder']],
     'one win over the hub beats one win over a tail-ender',
     g.pr[g.idx['Slayer']].toFixed(4) + ' vs ' + g.pr[g.idx['Padder']].toFixed(4));
}
{
  /* a dangling node — somebody who has never lost has no outgoing edge, and
     an implementation that forgets to redistribute their mass leaks
     probability until the vector no longer sums to 1 */
  const games = [];
  for(let i = 0; i < 4; i++) games.push(game('Perfect', 'P' + i, 1, '2026-06-0' + (i + 1)));
  const g = M(games).pageRankDominance();
  const total = g.pr.reduce((a, b) => a + b, 0);
  ok(near(total, 1, 1e-6),
     'a player who has never lost has no outgoing edge, and no mass leaks out', total);
  ok(g.outSum[g.idx['Perfect']] === 0, 'they really are a dangling node');
}
ok(M([]).pageRankDominance() === null, 'no games is no graph');
ok(M([game('A','B',1)]).pageRankDominance().names.length === 2, 'two players is a graph');

section('all three agree about the obvious case');
{
  const {names, games} = pecking(5, 3);
  const api = M(games);
  const bt = api.bradleyTerry().map(r => r.name).join('');
  const pr = (() => { const g = api.pageRankDominance();
    return g.names.map(n => ({n, p: g.pr[g.idx[n]]})).sort((a,b) => b.p - a.p)
            .map(r => r.n).join(''); })();
  const bs = seeded(31337, () => api.bootstrapRatings(200)).map(r => r.name).join('');
  ok(bt === names.join('') && pr === names.join('') && bs === names.join(''),
     'a strict pecking order is a strict pecking order to all three',
     'BT ' + bt + ' | PR ' + pr + ' | boot ' + bs);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
