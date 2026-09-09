/* Every docs/*.min.sql must stay the same migration as the docs/*.sql it
 * was generated from.
 *
 * Two copies of a migration is a trap: someone fixes a policy in one and
 * ships the other for a year. The minified file exists because pasting 226
 * lines of prose into a phone-sized SQL editor is how people end up running
 * the wrong script — which is exactly what went wrong in practice — so the
 * duplication is worth it only if drift is impossible to miss.
 *
 * Strip the comments from the canonical file and the two must be identical,
 * statement for statement. No browser, no network: node test/site-config-sql.test.js
 *
 * PAIRS is the list. Adding a migration with a paste-ready twin means adding
 * a line here, and the guards below then apply to it too — which is the point:
 * the trap this file exists for is not specific to site-config, it is what
 * Supabase's one-transaction editor does to ANY script that throws. */
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond ? '' : '   ' + JSON.stringify(extra)));
  if(!cond) fails++;
};

/* the same reduction the generator applies: drop whole-line comments, collapse
   runs of blank lines, trim trailing whitespace */
function statementsOf(text){
  const out = [];
  let blank = false;
  for(const raw of text.split('\n')){
    const line = raw.replace(/\s+$/, '');
    if(line.trim().startsWith('--')) continue;
    if(!line.trim()){
      if(blank) continue;
      blank = true;
    } else blank = false;
    out.push(line);
  }
  return out.join('\n').trim();
}

/* [canonical, minified, how many tables the canonical creates] */
const PAIRS = [
  ['site-config.sql', 'site-config.min.sql', 2],
  ['kit.sql',         'kit.min.sql',         2]
];

const read = f => fs.readFileSync(path.join(DOCS, f), 'utf8');

PAIRS.forEach(([canonFile, minFile]) => {
  const a = statementsOf(read(canonFile));
  const b = statementsOf(read(minFile));
  if(a !== b){
    /* name the first line that differs — "they differ" is not a bug report */
    const la = a.split('\n'), lb = b.split('\n');
    let i = 0;
    while(i < la.length && i < lb.length && la[i] === lb[i]) i++;
    ok(minFile + ' matches ' + canonFile, false,
       {firstDifferenceAtLine: i + 1, canonical: la[i], minified: lb[i]});
  } else {
    ok(minFile + ' matches ' + canonFile, true);
  }
});

const canonical = read('site-config.sql');
const minified  = read('site-config.min.sql');

/* The properties that make the migration safe to re-run. If one of these
   regresses, a second paste starts throwing "already exists" and aborts the
   transaction — the exact failure this file is here to prevent. */
PAIRS.forEach(([canonFile, , tableCount]) => {
  const c = read(canonFile);
  const n = re => (c.match(re) || []).length;
  [
    ['every table uses "if not exists"',
     n(/create table if not exists/g) === tableCount && !/create table (?!if not exists)/.test(c)],
    ['every policy is dropped before it is created',
     n(/drop policy if exists/g) === n(/create policy/g)],
    ['every index is guarded', !/create index (?!if not exists)/.test(c)],
    ['nothing drops a table', !/drop table/i.test(c)]
  ].forEach(([name, cond]) => ok(canonFile + ': ' + name, cond));
});

/* site-config's own shape, which the Kit migration has no equivalent of */
const scGuards = [
  ['the function is create-or-replace', /create or replace function/.test(canonical)],
  ['the realtime publication is added conditionally',
   /if not exists \(\s*select 1 from pg_publication_tables/.test(canonical)]
];
scGuards.forEach(([name, cond]) => ok('site-config.sql: ' + name, cond));

/* is_admin() is the one thing the migration assumes and does not create, so
   the file must say so rather than failing obscurely on a fresh project. */
ok('site-config names its is_admin() dependency',
   /admin-security\.sql/.test(canonical) && /admin-security\.sql/.test(minified));

/* The Kit's opposite promise: it depends on nothing, and both halves must
   say so, because "run this other file first" is exactly the instruction
   somebody skips and then cannot explain the empty screen. */
ok('kit says it assumes nothing',
   /assumes nothing/.test(read('kit.min.sql')));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
