/* The fact sheet the weekly recap is written from.
 *
 * This is the only part of supabase/functions/recap that is worth testing and
 * the only part that can be: the handler is a network call and a database
 * write, but everything it is ALLOWED to say comes out of recapFacts(), in
 * code, before the model is involved.
 *
 * That split is the safety property. A language model handed a table of match
 * rows will eventually write a scoreline that did not happen, and a league bot
 * that invents results is worse than no league bot. So the model never sees a
 * match row — it sees counts, names and a percentage computed here, and is
 * asked to write three sentences about them. Which makes this file the thing
 * standing between the feed and a fabricated result, and worth more than the
 * handler around it.
 *
 * node test/recap.test.js   (no dependencies, no network, no Deno) */
const path = require('path');

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);          // a fixed Wednesday
const ago = d => new Date(NOW - d * DAY).toISOString();
const game = (p1, p2, outcome, daysAgo, extra) => Object.assign({
  status:'approved', p1, p2, outcome, created_at: ago(daysAgo), sets:'6-4, 6-3'
}, extra || {});

(async () => {
const {recapFacts, weekKey, ratings, expectation, WEEK_MS} =
  await import(path.join(__dirname, '..', 'supabase', 'functions', 'recap', 'facts.js'));

/* ---------------------------------------------------------------- */
section('a week with nothing in it says nothing');
ok(recapFacts([], NOW) === null, 'no matches at all is null, not an empty recap');
ok(recapFacts(null, NOW) === null, 'and neither is no argument a crash');
ok(recapFacts([game('A','B',1,30)], NOW) === null,
   'a month-old game is not this week');
ok(recapFacts([game('A','B',1,-2)], NOW) === null,
   'and neither is one dated in the future — a clock skew must not invent a week');
/* the point of returning null rather than a "quiet week" recap: a bot that
   posts every week whatever happened is one people learn to scroll past */
ok(recapFacts([game('A','B',1,8)], NOW) === null,
   'eight days ago is outside the window');
ok(recapFacts([game('A','B',1,6.9)], NOW) !== null, 'just inside it is not');

section('only games that actually count, and only real ones');
ok(recapFacts([game('A','B',1,2,{status:'pending'})], NOW) === null,
   'a pending result is not in the recap — it has not been approved yet');
ok(recapFacts([game('A','B',1,2,{status:'rejected'})], NOW) === null, 'nor a rejected one');
ok(recapFacts([game('A','B',1,2,{counts_stats:false})], NOW) === null,
   'nor an event the league has excluded from its stats');
ok(recapFacts([game('A','B',1,2,{counts_stats:true})], NOW) !== null,
   'while an event that only skips Elo is still a real game that happened');
ok(recapFacts([{status:'approved', p1:'A', created_at:ago(1)}], NOW) === null,
   'a row missing a player is dropped rather than recapped as "A vs undefined"');

section('the counts');
{
  const f = recapFacts([
    game('A','B',1,1), game('C','D',1,2), game('A','C',0,3)
  ], NOW);
  ok(f.games === 3, 'every game this week is counted', f.games);
  ok(f.players === 4, 'and every player who appeared in one', f.players);
  ok(f.busiest && f.busiest.played === 2, 'the busiest player is the one who played most',
     f.busiest && f.busiest.name + ':' + f.busiest.played);
}
{
  /* a draw is a game and a player, and it is neither a win nor a loss */
  const f = recapFacts([game('A','B',0.5,1)], NOW);
  ok(f.games === 1 && f.players === 2, 'a drawn week is still a week');
  ok(f.leader === null, 'with nobody leading it, because nobody won anything');
  ok(f.upset === null, 'and no upset, because a draw is not an upset');
}

section('the leader — best record, and the same one every time');
{
  const f = recapFacts([
    game('Win','X',1,1), game('Win','Y',1,2), game('Lose','X',0,3)
  ], NOW);
  ok(f.leader.name === 'Win' && f.leader.won === 2,
     'two wins beats none', JSON.stringify(f.leader));
}
{
  /* ties must not depend on object key order, or the same week produces a
     different name on a re-run and the bot looks like it changed its mind */
  const ms = [game('Bea','Zed',1,1), game('Ann','Yun',1,2)];
  const a = recapFacts(ms, NOW).leader.name;
  const b = recapFacts(ms.slice().reverse(), NOW).leader.name;
  ok(a === b, 'a tie breaks the same way whatever order the rows arrive in', a + ' vs ' + b);
  ok(a === 'Ann', 'alphabetically, as the last resort', a);
}
ok(recapFacts([game('A','B',0.5,1), game('A','B',0.5,2)], NOW).leader === null,
   'a player who only drew is not the leader');

section('the upset — measured against what was known BEFORE it');
{
  /* a heavy favourite built up over a month, beaten this week */
  const history = [];
  for(let i = 0; i < 12; i++) history.push(game('Strong', 'F' + i, 1, 30 + i));
  const f = recapFacts(history.concat([game('Nobody','Strong',1,2,{sets:'7-5, 6-4'})]), NOW);
  ok(f.upset && f.upset.winner === 'Nobody' && f.upset.loser === 'Strong',
     'the underdog who won is the upset', JSON.stringify(f.upset));
  ok(f.upset.chance < 40, 'and it is reported as a long shot', f.upset.chance + '%');
  ok(f.upset.sets === '7-5, 6-4', 'with the real scoreline attached, not a guessed one');
}
{
  /* the ratings used are the ones from BEFORE the week — otherwise the result
     being explained is also the evidence explaining it */
  const history = [];
  for(let i = 0; i < 12; i++) history.push(game('Strong', 'F' + i, 1, 30 + i));
  const withWin = history.concat([game('Nobody','Strong',1,2)]);
  const before = recapFacts(withWin, NOW).upset.chance;
  const alsoAfter = recapFacts(withWin.concat([game('Nobody','Strong',1,1)]), NOW).upset.chance;
  ok(before === alsoAfter,
     "a second win in the same week does not re-price the first one's odds",
     before + ' vs ' + alsoAfter);
}
ok(recapFacts([game('A','B',1,1)], NOW).upset === null,
   'two unrated players is a coin flip, and a coin flip is not an upset');
{
  const f = recapFacts([game('A','B',1,1), game('B','A',1,2)], NOW);
  ok(f.upset === null, 'and neither is an even week between the same two');
}

section('the streak — counted across history, not just this week');
{
  const ms = [];
  for(let i = 0; i < 5; i++) ms.push(game('Hot', 'P' + i, 1, 20 - i * 3));
  ms.push(game('Hot','Last',1,2));
  const f = recapFacts(ms, NOW);
  ok(f.streak && f.streak.name === 'Hot' && f.streak.wins === 6,
     'a run that started before Monday still reads as a run', JSON.stringify(f.streak));
}
{
  const ms = [game('A','B',1,20), game('A','C',1,18), game('D','A',1,16), game('A','E',1,2)];
  const f = recapFacts(ms, NOW);
  ok(f.streak === null, 'a loss resets it, so one win back is not a streak',
     JSON.stringify(f.streak));
}
{
  /* somebody on a tear who did not play this week is not this week's news */
  const ms = [];
  for(let i = 0; i < 6; i++) ms.push(game('Absent', 'P' + i, 1, 40 - i));
  ms.push(game('A','B',1,1));
  ok(recapFacts(ms, NOW).streak === null,
     'a streak belongs to somebody who actually played this week');
}

section('the shape the model is handed');
{
  const f = recapFacts([game('A','B',1,1)], NOW);
  const keys = Object.keys(f).sort();
  ok(keys.join(',') === 'busiest,games,leader,players,streak,upset',
     'exactly the fields the prompt promises, and no others', keys.join(','));
  ok(JSON.parse(JSON.stringify(f)) !== null, 'and it round-trips as JSON');
  /* the model is told a null field did not happen, so a null must never be a
     stand-in for "present but zero" */
  ok(f.upset === null || typeof f.upset === 'object', 'upset is an object or null');
  ok(f.streak === null || typeof f.streak === 'object', 'streak is an object or null');
}
{
  /* NO MATCH ROW MAY REACH THE MODEL. If a raw row ever leaked into the fact
     sheet, the model could read a result the facts never claimed — which is
     the exact failure this whole split exists to prevent. */
  const f = recapFacts([game('A','B',1,1,{notes:'secret', id:99})], NOW);
  const flat = JSON.stringify(f);
  ok(!/secret/.test(flat), 'a note on a match row does not reach the fact sheet');
  ok(!/"status"|"outcome"|"created_at"|"counts_stats"/.test(flat),
     'and neither does any raw match field', flat.slice(0, 120));
}

section('the week key — what stops it posting twice');
{
  const mon = Date.UTC(2026, 8, 7, 0, 0, 1);
  const sun = Date.UTC(2026, 8, 13, 23, 59, 59);
  ok(weekKey(mon) === weekKey(sun), 'every instant in one week gives one key',
     weekKey(mon) + ' / ' + weekKey(sun));
  ok(weekKey(sun) !== weekKey(sun + 1000), 'and the next week gives a different one');
  ok(weekKey(mon) === '2026-09-07', 'the key is that week\'s Monday', weekKey(mon));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(weekKey(NOW)), 'and it is safe to put in a post body');
}

section('the arithmetic underneath');
ok(Math.abs(expectation(500, 500) - 0.5) < 1e-9, 'equal ratings are a coin flip');
ok(expectation(900, 500) > 0.9, 'and 400 points is a heavy favourite',
   expectation(900, 500).toFixed(3));
{
  const R = ratings([game('A','B',1,5)], {start:500, k:32});
  ok(Math.abs((R.A - 500) - (500 - R.B)) < 1e-9, 'a flat-K game is zero-sum');
  ok(R.A > R.B, 'and the winner ends up above the loser');
}
ok(WEEK_MS === 7 * 86400000, 'a week is seven days');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
