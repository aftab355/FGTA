/* The TS Race — the points table that becomes the headline ranking from
   the 2027 Spring/Summer season. Everything here is a rule the group
   agreed to in words, and every one of them is the kind of thing that
   breaks silently: a table that is off by a repeat decay or a field
   multiplier looks exactly as plausible as the right one.

   node test/race.test.js   (no dependencies) */
const {loadRace} = require('./extract.js');
const R = loadRace();

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};

let _id = 0;
const game = (p1, p2, outcome, date, extra) => Object.assign({
  id: ++_id, status: 'approved', p1, p2, outcome, sets: null,
  created_at: date + 'T12:00:00'
}, extra || {});
const SEASON = {key:'t', name:'test', start:'2027-05-01', end:'2027-09-06'};
const race = (ms, ts) => R.computeRace(SEASON, ms, ts || []);
const find = (out, n) => out.rows.find(r => r.name === n);

/* ---------------------------------------------------------------- */
section('a ladder win: base x opponent strength x margin, losses cost nothing');
{
  const out = race([game('A', 'B', 1, '2027-05-02')]);
  ok(find(out, 'A').points === R.RACE_WIN_BASE, 'first win between two new players, no score, is exactly the base',
     find(out, 'A').points);
  ok(find(out, 'B').points === 0, 'the loser scores 0');

  const blow = race([game('A', 'B', 1, '2027-05-02', {sets:'6-0, 6-0'})]);
  ok(find(blow, 'A').points === Math.round(R.RACE_WIN_BASE * 1.6), 'a double bagel is worth x1.6', find(blow, 'A').points);

  const brk = race([game('A', 'B', 1, '2027-05-02', {sets:'6-4, 4-6, 10-8'})]);
  ok(find(brk, 'A').points < R.RACE_WIN_BASE * 1.2,
     'a 10-8 breaker decider is read as one game, not as a ten-game set', find(brk, 'A').points);

  const draw = race([game('A', 'B', 0.5, '2027-05-02')]);
  ok(find(draw, 'A').points === R.RACE_WIN_BASE / 2 && find(draw, 'B').points === R.RACE_WIN_BASE / 2,
     'a draw is half a plain win to each side');

  /* nothing anybody does can take points off them */
  const ms = [];
  for(let i = 0; i < 6; i++) ms.push(game('A', 'B', i % 2, '2027-05-0' + (i + 2)));
  const before = race(ms.slice(0, 5)), after = race(ms);
  ok(['A','B'].every(n => find(after, n).points >= find(before, n).points),
     'no result ever lowers a total');
}

section('who you beat: the opponent\'s strength, not the size of the upset');
{
  /* make S strong: S beats three others twice each */
  const ms = [];
  ['X','Y','Z'].forEach((o, i) => { ms.push(game('S', o, 1, '2027-04-0' + (i + 1))); ms.push(game('S', o, 1, '2027-04-1' + (i + 1))); });
  ms.push(game('A', 'S', 1, '2027-05-02'));   // A beats the strong player
  ms.push(game('B', 'X', 1, '2027-05-02'));   // B beats a weakened one
  const out = race(ms);
  ok(find(out, 'A').points > find(out, 'B').points, 'beating a stronger player is worth more',
     find(out, 'A').points + ' vs ' + find(out, 'B').points);
  ok(find(out, 'A').points <= Math.round(R.RACE_WIN_BASE * 1.6), 'strength is capped at x1.6');

  /* the reason upset-scaling was rejected, held as a property: under the
     strength scale a better player earns more per game against the same field */
  const S = R.raceStrengthMult, E = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
  const field = [600, 550, 500, 450, 400];
  const perGame = r => field.filter(o => o !== r).reduce((s, o) => s + E(r, o) * S(o), 0);
  const seq = field.map(perGame);
  ok(seq.every((v, i) => i === 0 || v < seq[i - 1]), 'expected points per game rise with skill',
     seq.map(v => v.toFixed(2)).join(' > '));
}

section('repeat wins over the same opponent decay inside the window');
{
  const ms = [
    game('A', 'B', 1, '2027-05-02'), game('A', 'B', 1, '2027-05-03'),
    game('A', 'B', 1, '2027-05-04'), game('A', 'B', 1, '2027-05-05'),
    game('A', 'B', 1, '2027-05-06')
  ];
  const wins = find(race(ms), 'A').log.map(x => x.decay);
  ok(wins[0] === 1 && Math.abs(wins[1] - 0.6) < 1e-9 && Math.abs(wins[2] - 0.36) < 1e-9,
     'x1, x0.6, x0.36', wins.join(', '));
  ok(wins[3] === 0.35 && wins[4] === 0.35, 'never below x0.35');

  const spaced = race([game('A', 'B', 1, '2027-05-02'), game('A', 'B', 1, '2027-06-05')]);
  ok(find(spaced, 'A').log[1].decay === 1, 'a win more than 28 days later is fresh again');

  const other = race([game('A', 'B', 1, '2027-05-02'), game('A', 'C', 1, '2027-05-03')]);
  ok(find(other, 'A').log[1].decay === 1, 'a different opponent is never decayed');

  const rev = race([game('A', 'B', 1, '2027-05-02'), game('B', 'A', 1, '2027-05-03')]);
  ok(find(rev, 'B').log[0].decay === 1, 'losing to someone does not decay what beating them is worth');
}

section('events: only the title and the final score, by tier');
{
  const cup = {id: 1, name: 'FF Cup', format: 'robin2', status: 'completed', champion: 'A'};
  const rr  = {id: 2, name: 'June RR', format: 'roundrobin', status: 'completed', champion: 'B'};
  const ko  = {id: 3, name: 'Summer Open', format: 'knockout', status: 'completed', champion: 'C'};
  ok(R.raceTier(cup) === 500 && R.raceTier(rr) === 250 && R.raceTier(ko) === 300, 'FF Cup 500, round robin 250, bracket 300');
  ok(R.raceTier(Object.assign({}, ko, {tier: 500})) === 500, 'an explicit tier column overrides the format');

  const ms = [
    game('A', 'B', 1, '2027-08-10', {tournament_id: 1}), game('C', 'D', 1, '2027-08-11', {tournament_id: 1}),
    game('A', 'C', 1, '2027-08-20', {tournament_id: 1, round: 'final'})
  ];
  const out = race(ms, [cup]);
  ok(find(out, 'A').points === 500, 'the champion gets the tier, and nothing per event win', find(out, 'A').points);
  ok(find(out, 'C').points === 200, 'the finalist gets the runner-up share', find(out, 'C').points);
  ok(find(out, 'B').points === 0 && find(out, 'D').points === 0, 'losing a group or semi game scores nothing');

  const live = race(ms, [Object.assign({}, cup, {status: 'active'})]);
  ok(find(live, 'A').points === 0, 'nothing until the event is completed with a champion');

  /* round robin: runner-up is second on the table */
  const rrGames = [
    game('B', 'A', 1, '2027-06-01', {tournament_id: 2, sets: '6-3, 6-3'}),
    game('B', 'C', 1, '2027-06-01', {tournament_id: 2}),
    game('A', 'C', 1, '2027-06-02', {tournament_id: 2}),
    game('D', 'B', 0, '2027-06-02', {tournament_id: 2}),
    game('A', 'D', 1, '2027-06-03', {tournament_id: 2}),
    game('C', 'D', 1, '2027-06-03', {tournament_id: 2})
  ];
  const r2 = race(rrGames, [rr]);
  ok(find(r2, 'B').points === 250 && find(r2, 'A').points === 100, 'round robin: 250 to the winner, 100 to second',
     find(r2, 'B').points + ' / ' + find(r2, 'A').points);

  /* a three-player field pays 75%, two pays nothing */
  const three = race(rrGames.filter(m => m.p1 !== 'D' && m.p2 !== 'D'), [rr]);
  ok(find(three, 'B').points === Math.round(250 * 0.75), 'a 3-player field pays 75%', find(three, 'B').points);
  const two = race([game('B', 'A', 1, '2027-06-01', {tournament_id: 2})], [rr]);
  ok(find(two, 'B').points === 0, 'a 2-player "event" scores nothing');
}

section('the season window');
{
  const ms = [game('A', 'B', 1, '2027-04-30'), game('A', 'B', 1, '2027-09-07'), game('C', 'B', 1, '2027-05-01')];
  const out = race(ms);
  ok(find(out, 'A').points === 0 && find(out, 'A').games === 0, 'games before the start and after the end score nothing and count no season games');
  ok(find(out, 'C').points > 0, 'May 1 itself counts');
  ok(find(out, 'B').games === 1, 'and does not count games outside it');

  /* but they still shape the hidden strength */
  const pre = [];
  for(let i = 1; i <= 6; i++) pre.push(game('B', 'Q', 1, '2027-04-0' + i));
  const strong = race(pre.concat([game('C', 'B', 1, '2027-05-01')]));
  ok(find(strong, 'C').points > find(out, 'C').points, 'pre-season games still count toward how strong an opponent is');

  const cup = {id: 9, name: 'FF Cup', format: 'knockout', status: 'completed', champion: 'A'};
  const late = race([
    game('A', 'B', 1, '2027-09-01', {tournament_id: 9}), game('C', 'D', 1, '2027-09-02', {tournament_id: 9}),
    game('A', 'C', 1, '2027-09-10', {tournament_id: 9})], [cup]);
  ok(find(late, 'A').points === 0, 'an event is dated by its last game: a final after the window is out');

  ok(R.raceActiveSeason(Date.parse('2026-10-06T12:00:00')) === R.RACE_PREVIEW, 'before Oct 7 2026 the table is the preview');
  ok(R.raceLive(Date.parse('2026-10-07T00:00:01')), 'from Oct 7 2026 it is the real season');
  ok(R.RACE_SEASON.start === '2026-10-07' && R.RACE_SEASON.end === '2027-10-06', 'the season is a year, Oct 7 to Oct 6');
}

section('everyone starts on 0, records carry over');
{
  const ms = [game('A', 'B', 1, '2027-04-01'), game('B', 'A', 0.5, '2027-04-02'), game('C', 'A', 1, '2027-04-03')];
  const out = race(ms);
  ok(out.rows.length === 3 && out.rows.every(r => r.points === 0 && r.games === 0),
     'every player who has ever played is listed, on 0, before they play this season');
  const a = find(out, 'A');
  ok(a.career.w === 1 && a.career.l === 1 && a.career.d === 1, 'with their all-time W-L-D', JSON.stringify(a.career));
  const later = race(ms.concat([game('A', 'C', 1, '2027-05-02')]));
  ok(find(later, 'A').w === 1 && find(later, 'A').career.w === 2, 'season record and all-time record are kept apart');
}

section('the FF Cup is off the W-L record');
{
  const cup = {id: 1, name: 'FF Cup', format: 'robin2', status: 'completed', champion: 'A'};
  const rr  = {id: 2, name: 'Oct RR', format: 'roundrobin', status: 'active'};
  const ms = [
    game('A', 'B', 1, '2027-05-02'),
    game('A', 'B', 1, '2027-05-03', {tournament_id: 1}),
    game('B', 'A', 1, '2027-05-04', {tournament_id: 2})
  ];
  const a = find(race(ms, [cup, rr]), 'A');
  ok(a.w === 1 && a.l === 1, 'season record: the ladder win and the round-robin loss, not the cup win', a.w + '-' + a.l);
  ok(a.career.w === 1 && a.career.l === 1, 'and the same all-time');
  ok(R.raceIsFFCup(cup) && !R.raceIsFFCup(rr), 'the cup is told apart by name');
}

section('the card: who you have played');
{
  const out = race([game('A', 'B', 1, '2027-05-02'), game('A', 'C', 0, '2027-05-03'), game('B', 'C', 1, '2027-05-04'), game('D', 'C', 1, '2027-05-05')]);
  ok(find(out, 'A').card === 2 && find(out, 'A').cardOf === 3, 'A has played 2 of 3 others');
  ok(find(out, 'C').card === 3, 'C has played everyone');
}

section('only the best RACE_RR_BEST round robins count');
{
  /* ten 4-player round robins, all won by A, runner-up B; then a cup B wins */
  const ms = [], ts = [];
  for(let i = 0; i < 10; i++){
    const id = 500 + i, d = '2027-05-' + String(3 + i * 2).padStart(2, '0');
    ts.push({id, name: 'RR ' + i, format: 'roundrobin', status: 'completed', champion: 'A'});
    ms.push(game('A', 'B', 1, d, {tournament_id: id}), game('A', 'C', 1, d, {tournament_id: id}),
            game('A', 'D', 1, d, {tournament_id: id}), game('B', 'C', 1, d, {tournament_id: id}),
            game('B', 'D', 1, d, {tournament_id: id}), game('C', 'D', 1, d, {tournament_id: id}));
  }
  const out = race(ms, ts);
  const A = find(out, 'A'), B = find(out, 'B');
  ok(R.RACE_RR_BEST === 8, 'the cap is 8');
  ok(A.eventPts === 8 * 250, 'ten titles, eight count', A.eventPts);
  ok(A.log.filter(x => x.dropped).length === 2, 'the other two stay in the log, marked dropped');
  ok(B.eventPts === 8 * 100, 'the cap applies to runner-up results too', B.eventPts);
  ok(A.points === A.ladderPts + A.eventPts, 'points add up after the cap');

  const cup = {id: 900, name: 'FF Cup', format: 'robin2', status: 'completed', champion: 'B'};
  const cg = [game('B', 'A', 1, '2027-08-20', {tournament_id: 900, round: 'final'}),
              game('C', 'D', 1, '2027-08-18', {tournament_id: 900})];
  const out2 = race(ms.concat(cg), ts.concat([cup]));
  ok(find(out2, 'B').eventPts === 8 * 100 + 500 && find(out2, 'A').eventPts === 8 * 250 + 200,
     'the cup sits outside the cap', find(out2, 'B').eventPts + ' / ' + find(out2, 'A').eventPts);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
