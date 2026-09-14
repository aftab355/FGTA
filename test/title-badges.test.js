/* The trophy-case titles: who gets a cup on their profile, and what it says.

   The thing worth protecting here is that a title is derived, not declared.
   Nobody's name is written into the app — crowning a champion on the event
   is what puts the trophy on their profile, and un-crowning takes it away
   again. The second thing is that it survives an exhibition: the FF Cup
   moves no Elo, so its champion can have no ladder standing at all, and a
   title they actually won must not depend on having one.

   node test/title-badges.test.js   (no dependencies) */
const {loadTitleBadges} = require('./extract.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if(c){ pass++; console.log('  ok   '+m); }
                          else { fail++; console.log('  FAIL '+m + (x!==undefined?'   ['+x+']':'')); } };

const CUP = {id: 1, name: 'FF Cup', status: 'completed', champion: 'Kabir',
             created_at: '2026-08-17T12:00:00Z'};
const OPEN = {id: 2, name: 'Autumn Shield', status: 'live', champion: null,
              created_at: '2026-09-20T12:00:00Z'};

/* the final was played on Sep 13, three weeks after the event was made */
const GAMES = {1: [{created_at: '2026-08-20T12:00:00Z'},
                   {created_at: '2026-09-13T20:00:00Z'}]};
const FIELD = {1: new Array(8)};

const load = (tournaments) => loadTitleBadges({
  tournaments,
  tournGames: id => GAMES[id] || [],
  tournStandings: id => FIELD[id] || []
}).titleBadges;

console.log('\nthe champion gets the cup');
{
  const titleBadges = load([CUP, OPEN]);
  const bs = titleBadges('Kabir');
  ok(bs.length === 1, 'one trophy for one title', bs.length);
  ok(bs[0].name === 'FF Cup champion',
     'and it names the event rather than saying "champion"', bs[0].name);
  ok(bs[0].icon === '\u{1F3C6}', 'it is a cup');
  ok(bs[0].cls === 'tr-title', 'and it is marked as a title, not a badge');
  ok(bs[0].k === 'champ:1', 'keyed by event, so two titles never collide');
}

console.log('\nand nobody else does');
{
  const titleBadges = load([CUP, OPEN]);
  ok(titleBadges('Sam').length === 0, 'a player who won nothing has no trophy');
  ok(titleBadges('').length === 0, 'and neither does an empty name');
  ok(titleBadges('KABIR').length === 1, 'the match is case-insensitive, like the rest of the app');
}

console.log('\nit is derived from the event, not declared');
{
  ok(load([Object.assign({}, CUP, {status: 'live'})])('Kabir').length === 0,
     'an event still running crowns nobody, even with a champion written on it');
  ok(load([Object.assign({}, CUP, {champion: null})])('Kabir').length === 0,
     'and a completed event with no champion hands out no trophy');
  ok(load([])('Kabir').length === 0, 'no events, no titles');
  ok(load(null)('Kabir').length === 0, 'and rows that never loaded are not a crash');
  const renamed = load([Object.assign({}, CUP, {name: 'Fat Fitter Cup'})])('Kabir');
  ok(renamed[0].name === 'Fat Fitter Cup champion',
     'rename the event and the trophy renames itself', renamed[0].name);
}

console.log('\nwhat the trophy says underneath');
{
  const b = load([CUP])('Kabir')[0];
  ok(/Sep 2026/.test(b.desc),
     'the date is the final, not the day the event was created', b.desc);
  ok(/8-player field/.test(b.desc), 'and it carries the size of the field', b.desc);

  const noGames = loadTitleBadges({tournaments: [CUP],
    tournGames: () => [], tournStandings: () => []}).titleBadges('Kabir')[0];
  ok(/Aug 2026/.test(noGames.desc),
     'with no games on the row it falls back to when the event was made', noGames.desc);
  ok(!/field/.test(noGames.desc),
     'and says nothing about a field it cannot count', noGames.desc);
}

console.log('\ntwo titles, newest first');
{
  const OLD = {id: 3, name: 'Spring Cup', status: 'completed', champion: 'Kabir',
               created_at: '2026-03-01T12:00:00Z'};
  const bs = loadTitleBadges({
    tournaments: [OLD, CUP],
    tournGames: id => GAMES[id] || [],
    tournStandings: id => FIELD[id] || []
  }).titleBadges('Kabir');
  ok(bs.length === 2, 'both are kept — a second title does not replace the first', bs.length);
  ok(bs[0].name === 'FF Cup champion', 'and the most recent leads', bs[0].name);
  ok(bs[0].k !== bs[1].k, 'with distinct keys');
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail ? 1 : 0);
