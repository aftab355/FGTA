/* The outbox, and the one judgement it rests on.

   This app is used courtside, on a phone, at a public park under a hydro
   corridor. Every write in it already fails honestly when the signal is gone
   — and honestly is not the same as usefully, because the person is standing
   there holding a completed match with nowhere to put it.

   So a failed write is now sorted into one of two piles, and EVERYTHING ELSE
   HERE IS DOWNSTREAM OF GETTING THAT SORT RIGHT:

     refused   the server answered and said no. Retrying is pointless, and
               for a duplicate key it is worse than pointless.
     network   nothing reached the server at all. Safe to replay, and the
               only kind worth keeping.

   The classifier is deliberately biased toward "refused", because the two
   mistakes are not symmetric: a wrongly-queued write retries forever against
   a server that will never take it and sits in somebody's outbox looking
   like unsent work, while a wrongly-dropped one loses a write the caller has
   already put back in the form. This file is mostly that asymmetry, written
   out as the real messages Postgres, PostgREST, and four browsers produce.

   node test/outbox.test.js   (no dependencies) */
const {loadOutbox} = require('./extract.js');
const {OQ_MAX, OQ_MAX_AGE_MS, OQ_MAX_ATTEMPTS, OQ_BACKOFF, oqBackoff, oqClassify,
       oqItem, oqExpired, oqParse, oqDue, oqAfterAttempt, oqSummary} = loadOutbox();

let pass = 0, fail = 0;
const section = t => console.log('\n' + t);
const ok = (c, m, x) => {
  if(c){ pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x ? '   [' + x + ']' : '')); }
};
const DAY = 86400000;
const D = (extra) => Object.assign({table:'matches', op:'insert', row:{p1:'A',p2:'B'}}, extra||{});

/* ---------------------------------------------------------------- */
section('a refusal is an answer — never retry it');
[
  ['new row violates row-level security policy for table "matches"', 'RLS'],
  ['permission denied for table matches',                            'a plain permission denial'],
  ['JWT expired',                                                    'an expired token'],
  ['Invalid API key',                                                'a bad key'],
  ['duplicate key value violates unique constraint "matches_pkey"',  'a duplicate'],
  ['insert or update on table "matches" violates foreign key constraint', 'a dangling foreign key'],
  ['new row for relation "matches" violates check constraint',       'a check constraint'],
  ['column "vibe" does not exist',                                   'a column that was never migrated'],
  ['Could not find the \'notes\' column of \'matches\' in the schema cache', 'PostgREST\'s schema cache'],
  ['invalid input syntax for type numeric',                          'a bad value']
].forEach(([msg, what]) => ok(oqClassify({message: msg}) === 'refused',
  what + ' is a refusal', oqClassify({message: msg})));

section('a write that never arrived is worth keeping');
[
  ['Failed to fetch',                       'Chrome offline'],
  ['NetworkError when attempting to fetch resource.', 'Firefox offline'],
  ['Load failed',                           'Safari offline'],
  ['Network request failed',                'a webview'],
  ['fetch failed',                          'undici'],
  ['The operation timed out',               'a timeout'],
  ['The user aborted a request.',           'an abort'],
  ['ECONNRESET',                            'a reset connection'],
  ['getaddrinfo EAI_AGAIN db.supabase.co',  'DNS'],
  ['503 Service Unavailable',               'a 503'],
  ['502 Bad Gateway',                       'a gateway'],
  ['429 Too Many Requests',                 'a rate limit — worth retrying, unlike other 4xx'],
  ['408 Request Timeout',                   'a request timeout']
].forEach(([msg, what]) => ok(oqClassify({message: msg}) === 'network',
  what + ' never arrived', oqClassify({message: msg})));

section('the browser saying it is offline outranks everything');
ok(oqClassify({message:'duplicate key value violates unique constraint'}, false) === 'network',
   'offline is checked first — the message cannot be trusted when nothing was sent');
ok(oqClassify(null, false) === 'network', 'even with no error object at all');
ok(oqClassify({message:'Failed to fetch'}, true) === 'network',
   'and being online does not make a failed fetch a refusal');

section('when in doubt, refuse — the two mistakes are not symmetric');
ok(oqClassify({}) === 'refused', 'an empty error is not queued');
ok(oqClassify(null) === 'refused', 'nor is no error at all');
ok(oqClassify({message:'something went wrong'}) === 'refused', 'nor is a message nobody recognises');
ok(oqClassify({message:'400 Bad Request'}) === 'refused', 'a 400 is the server answering');
ok(oqClassify({message:'404 Not Found'}) === 'refused', 'and so is a 404');
ok(oqClassify({code:'42501'}) === 'refused', 'a bare Postgres code is not read as a network fault');
/* the ordering trap: a 5xx body that happens to contain a refusal word, and
   a refusal that happens to contain the word "network" */
ok(oqClassify({message:'503 Service Unavailable: duplicate key value violates unique constraint'}) === 'refused',
   'a refusal pattern wins over a status code in the same message');
/* …but a 5xx whose body merely mentions the word is still a 5xx: the proxy
   never reached Postgres, so there is nothing to have been refused BY */
ok(oqClassify({message:'503: upstream connect error, duplicate upstream not permitted'}) === 'network',
   'while a gateway error that only happens to say "duplicate" is still a gateway error');
ok(oqClassify({message:'network policy: permission denied for table matches'}) === 'refused',
   'and the word "network" inside a refusal does not rescue it');

section('backoff — fast when the signal blinked, slow when the phone is in a pocket');
ok(oqBackoff(0, 0.5) === OQ_BACKOFF[0], 'the first retry is the first step', oqBackoff(0, 0.5));
let rising = true;
for(let i = 1; i < OQ_BACKOFF.length; i++) if(oqBackoff(i, 0.5) <= oqBackoff(i-1, 0.5)) rising = false;
ok(rising, 'and each one waits longer than the last');
ok(oqBackoff(99, 0.5) === oqBackoff(OQ_BACKOFF.length - 1, 0.5),
   'past the end it holds at the longest step rather than growing forever');
ok(oqBackoff(-5, 0.5) === oqBackoff(0, 0.5), 'and a negative attempt is the first one');
{
  const lo = oqBackoff(2, 0), hi = oqBackoff(2, 1);
  ok(lo < hi && lo >= OQ_BACKOFF[2] * 0.7 && hi <= OQ_BACKOFF[2] * 1.3,
     'jitter spreads it ±25%, so a clubhouse of phones does not all retry at once',
     lo + '..' + hi);
}

section('an item retires rather than retrying forever');
{
  const now = 1_000_000_000_000;
  ok(!oqExpired(oqItem(D(), {at: now}), now), 'a fresh item is live');
  ok(oqExpired(oqItem(D(), {at: now - OQ_MAX_AGE_MS - 1}), now),
     'one older than the max age is gone — it is no longer a description of anything true');
  ok(!oqExpired(oqItem(D(), {at: now - OQ_MAX_AGE_MS + DAY}), now), 'one inside it is not');
  ok(oqExpired(oqItem(D(), {at: now, attempts: OQ_MAX_ATTEMPTS}), now),
     'and so is one tried so often that "network" was clearly the wrong reading');
  ok(oqExpired({d:{}}, now), 'a malformed item is expired rather than acted on');
  ok(oqExpired(null, now), 'and so is nothing at all');
}

section('what comes back out of storage is never trusted');
ok(oqParse(null).length === 0, 'nothing stored is an empty outbox');
ok(oqParse('').length === 0, 'and so is an empty string');
ok(oqParse('{"not":"an array"}').length === 0, 'a non-array is discarded');
ok(oqParse('[{"d":{"table":"matches","op":"insert"}}]').length === 1, 'a good item survives');
/* the item above deliberately has NO `at`. An earlier draft read a missing
   timestamp as the epoch and expired every such item on the way in — a write
   silently discarded, which is the one outcome this whole file exists to
   prevent. */
ok(!oqExpired({d:{table:'matches',op:'insert'}}, Date.now()),
   'and an item with no timestamp is treated as new, not as written in 1970');
ok(oqParse('[').length === 0, 'a half-written blob from a killed tab does not throw');
ok(oqParse('[null,3,"x",{"d":null},{"d":{}},{"d":{"table":"","op":"insert"}}]').length === 0,
   'and neither does a list of junk');
ok(oqParse('[{"d":{"table":"matches","op":"drop table"}}]').length === 0,
   'an operation that is not one of the three is refused — storage is an input, not a command');
ok(oqParse('[{"d":{"table":"matches","op":"delete"}}]').length === 1, 'delete is one of the three');
{
  const many = JSON.stringify(Array.from({length: 500},
    () => ({d:{table:'matches', op:'insert', row:{}}, at: Date.now()})));
  ok(oqParse(many).length === OQ_MAX, 'and a huge list is capped rather than loaded whole',
     oqParse(many).length);
}
{
  const old = JSON.stringify([{d:{table:'matches',op:'insert'}, at: Date.now() - OQ_MAX_AGE_MS - 1},
                              {d:{table:'matches',op:'insert'}, at: Date.now()}]);
  ok(oqParse(old).length === 1, 'expired items are dropped on the way in, not later');
}

section('what is due, and in what order');
{
  const now = 1_000_000;
  const mk = (at, nextAt) => Object.assign(oqItem(D()), {at, nextAt});
  const items = [mk(now - 30, now - 1), mk(now - 90, now - 1), mk(now - 10, now + 5000)];
  const due = oqDue(items, now);
  ok(due.length === 2, 'only the ones whose backoff has elapsed', due.length);
  ok(due[0].at < due[1].at,
     'oldest first — a post and its comment must not arrive the wrong way round');
  ok(oqDue([], now).length === 0 && oqDue(null, now).length === 0, 'and no list is no work');
}

section('folding one attempt back in');
{
  const now = 5_000_000;
  const it = oqItem(D(), {at: now});
  ok(oqAfterAttempt(it, 'ok', now) === null, 'a write that went through is dropped');
  ok(oqAfterAttempt(it, 'refused', now) === null, 'and so is one the server refused');
  const again = oqAfterAttempt(it, 'network', now, 0.5);
  ok(again && again.attempts === 1, 'a network failure comes back with its attempt counted');
  ok(again.nextAt > now, 'and a time it may next be tried', again.nextAt - now);
  ok(again.id === it.id && again.d.table === it.d.table, 'keeping its identity and its payload');
  ok(it.attempts === 0, 'without mutating the item it was handed');
  let cur = it;
  for(let i = 0; i < OQ_MAX_ATTEMPTS + 2 && cur; i++) cur = oqAfterAttempt(cur, 'network', now, 0.5);
  ok(cur === null, 'and after enough tries it gives up rather than retrying to the heat death');
}

section('what the pill says');
ok(oqSummary([]) === null, 'nothing waiting means no pill at all');
ok(oqSummary(null) === null, 'and neither does no list');
{
  const one = oqSummary([oqItem(D({label:'game'}))]);
  ok(one.count === 1 && /game/.test(one.text) && !/error|fail/i.test(one.text),
     'one game reads as a game, and never as an error — nothing has gone wrong yet', one.text);
  const two = oqSummary([oqItem(D({label:'game'})), oqItem(D({label:'game'}))]);
  ok(/2 games/.test(two.text), 'two of a kind are pluralised', two.text);
  const mixed = oqSummary([oqItem(D({label:'game'})), oqItem(D({label:'session'}))]);
  ok(mixed.count === 2 && /2 things/.test(mixed.text), 'a mixture is counted, not listed', mixed.text);
  const stale = oqSummary([oqItem(D(), {at: Date.now() - OQ_MAX_AGE_MS - 1})]);
  ok(stale === null, 'and an outbox holding only expired items shows nothing');
}

section('an item is JSON, and stays JSON');
{
  const it = oqItem(D({optional:['vibe','notes'], label:'game'}));
  const round = JSON.parse(JSON.stringify(it));
  ok(round.d.table === 'matches' && round.d.op === 'insert', 'it survives a round trip');
  ok(JSON.stringify(round.d.optional) === '["vibe","notes"]',
     'including the columns to drop and retry without');
  ok(typeof it.id === 'string' && it.id.length > 4, 'it carries an id of its own');
  ok(oqItem(D()).id !== oqItem(D()).id, 'and two of them never collide');
  ok(oqItem({table:'x'}).d.op === 'insert', 'insert is the default operation');
  ok(oqItem({table:'x'}).label === 'x', 'and the table names it when nothing else does');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
