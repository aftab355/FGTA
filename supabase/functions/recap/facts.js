/* The fact sheet a recap is written from.
 *
 * THE MODEL DOES NOT GET THE MATCH ROWS. It gets this — a small object of
 * numbers and names computed here, in code, from the database. That is the
 * whole safety property of this function: a language model handed a table of
 * results will eventually write a scoreline that did not happen, and a league
 * bot that invents results is worse than no league bot. Handed a fact sheet
 * and told to write three sentences about it, the worst it can do is write
 * them badly.
 *
 * It is plain JS rather than TypeScript on purpose. Deno imports it happily,
 * and it stays loadable by `node test/recap.test.js` with no build step —
 * which is the convention every other test in this repo already follows.
 */

const WEEK_MS = 7 * 86400000;

/* The same two questions the app's own countsForElo / countsForAnalysis ask,
 * reduced to the one that matters here: did this game happen? A cup game is
 * an exhibition to the ladder and a real game to a recap. */
function countsForAnalysis(m){
  return !(m && m.counts_stats === false);
}

function outcomeOf(m){
  const o = Number(m.outcome);
  return o === 0.5 ? "draw" : (o === 1 ? "p1" : "p2");
}

/* Elo expectation, only to find the week's upset. Deliberately the plain
 * formula rather than a replay of the whole season: this function runs on a
 * cron with no app state, and "the winner was rated 140 below" is a good
 * enough definition of an upset for a sentence in a feed post. */
function expectation(a, b, divisor){
  return 1 / (1 + Math.pow(10, (b - a) / (divisor || 400)));
}

/* Ratings as they stand, from the same replay rule the ladder uses — flat K,
 * because this is a description rather than the ladder itself and must never
 * disagree with it in a way that matters. */
function ratings(matches, opts){
  const START = (opts && opts.start) || 500;
  const K = (opts && opts.k) || 32;
  const DIV = (opts && opts.divisor) || 400;
  const R = {};
  const at = n => (R[n] === undefined ? (R[n] = START) : R[n]);
  matches.slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .forEach(m => {
      at(m.p1); at(m.p2);
      const Ea = expectation(R[m.p1], R[m.p2], DIV);
      const Sa = Number(m.outcome);
      const a = R[m.p1], b = R[m.p2];
      R[m.p1] = a + K * (Sa - Ea);
      R[m.p2] = b + K * ((1 - Sa) - (1 - Ea));
    });
  return R;
}

/* Everything the prose is allowed to mention. Returns null when there is
 * nothing to say, which is a real answer: a week with no tennis in it should
 * produce silence, not a paragraph about how quiet it was. */
function recapFacts(matches, now, opts){
  const t = now == null ? Date.now() : now;
  const all = (matches || []).filter(m =>
    m && m.status === "approved" && countsForAnalysis(m) && m.p1 && m.p2);
  const week = all.filter(m => {
    const d = new Date(m.created_at).getTime();
    return isFinite(d) && t - d <= WEEK_MS && d <= t;
  });
  if(!week.length) return null;

  /* ratings as they stood BEFORE the week, so the upset is measured against
     what was known at the time rather than against the result itself */
  const before = ratings(all.filter(m => new Date(m.created_at).getTime() < t - WEEK_MS), opts);
  const rate = n => (before[n] === undefined ? ((opts && opts.start) || 500) : before[n]);

  const players = {};
  const seen = n => players[n] || (players[n] = {name:n, played:0, won:0, lost:0, drew:0});
  let upset = null;
  week.forEach(m => {
    const a = seen(m.p1), b = seen(m.p2);
    a.played++; b.played++;
    const o = outcomeOf(m);
    if(o === "draw"){ a.drew++; b.drew++; return; }
    const win = o === "p1" ? m.p1 : m.p2;
    const lose = o === "p1" ? m.p2 : m.p1;
    seen(win).won++; seen(lose).lost++;
    const p = expectation(rate(win), rate(lose), opts && opts.divisor);
    if(!upset || p < upset.probability)
      upset = {winner:win, loser:lose, probability:p, sets:m.sets || null};
  });

  /* the week's best record, ties broken by games played then by name, so the
     same week always produces the same name */
  const board = Object.values(players).sort((x, y) =>
    (y.won - y.lost) - (x.won - x.lost) || y.played - x.played || x.name.localeCompare(y.name));
  const top = board[0] && board[0].won > 0 ? board[0] : null;

  /* the longest active winning streak, counted across all history so a run
     that started before Monday still reads as a run */
  const streaks = {};
  all.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(m => {
    const o = outcomeOf(m);
    if(o === "draw"){ streaks[m.p1] = 0; streaks[m.p2] = 0; return; }
    const win = o === "p1" ? m.p1 : m.p2, lose = o === "p1" ? m.p2 : m.p1;
    streaks[win] = (streaks[win] || 0) + 1;
    streaks[lose] = 0;
  });
  const hot = Object.keys(streaks)
    .filter(n => streaks[n] >= 3 && players[n])
    .sort((a, b) => streaks[b] - streaks[a] || a.localeCompare(b))[0];

  return {
    games: week.length,
    players: board.length,
    leader: top ? {name: top.name, won: top.won, lost: top.lost, drew: top.drew} : null,
    upset: upset && upset.probability < 0.4 ? {
      winner: upset.winner, loser: upset.loser,
      chance: Math.round(upset.probability * 100), sets: upset.sets
    } : null,
    streak: hot ? {name: hot, wins: streaks[hot]} : null,
    /* how much tennis, for a sense of scale the model can lean on */
    busiest: board.slice().sort((x, y) => y.played - x.played || x.name.localeCompare(y.name))[0] || null
  };
}

/* The week a set of facts describes, as a stable key. The function refuses to
 * post twice for the same one — a cron that fires twice, or a manual run after
 * an automatic one, must not put two recaps in the feed. */
function weekKey(now){
  const d = new Date(now == null ? Date.now() : now);
  const day = (d.getUTCDay() + 6) % 7;                  // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return new Date(monday).toISOString().slice(0, 10);
}

export { recapFacts, weekKey, ratings, expectation, WEEK_MS };
