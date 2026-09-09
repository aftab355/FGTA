/* docs/site-config.min.sql must stay the same migration as
 * docs/site-config.sql.
 *
 * Two copies of a migration is a trap: someone fixes a policy in one and
 * ships the other for a year. The minified file exists because pasting 226
 * lines of prose into a phone-sized SQL editor is how people end up running
 * the wrong script — which is exactly what went wrong in practice — so the
 * duplication is worth it only if drift is impossible to miss.
 *
 * Strip the comments from the canonical file and the two must be identical,
 * statement for statement. No browser, no network: node test/site-config-sql.test.js
 */
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

const canonical = fs.readFileSync(path.join(DOCS, 'site-config.sql'), 'utf8');
const minified  = fs.readFileSync(path.join(DOCS, 'site-config.min.sql'), 'utf8');

const a = statementsOf(canonical);
const b = statementsOf(minified);

if(a !== b){
  /* name the first line that differs — "they differ" is not a bug report */
  const la = a.split('\n'), lb = b.split('\n');
  let i = 0;
  while(i < la.length && i < lb.length && la[i] === lb[i]) i++;
  ok('site-config.min.sql matches site-config.sql', false,
     {firstDifferenceAtLine: i + 1, canonical: la[i], minified: lb[i]});
} else {
  ok('site-config.min.sql matches site-config.sql', true);
}

/* The properties that make the migration safe to re-run. If one of these
   regresses, a second paste starts throwing "already exists" and aborts the
   transaction — the exact failure this file is here to prevent. */
const guards = [
  ['both tables use "if not exists"',
   (canonical.match(/create table if not exists/g) || []).length === 2 &&
   !/create table (?!if not exists)/.test(canonical)],
  ['every policy is dropped before it is created',
   (canonical.match(/drop policy if exists/g) || []).length ===
   (canonical.match(/create policy/g) || []).length],
  ['the index is guarded', /create index if not exists/.test(canonical)],
  ['the function is create-or-replace', /create or replace function/.test(canonical)],
  ['the realtime publication is added conditionally',
   /if not exists \(\s*select 1 from pg_publication_tables/.test(canonical)],
  ['nothing drops a table', !/drop table/i.test(canonical)]
];
guards.forEach(([name, cond]) => ok(name, cond));

/* is_admin() is the one thing the migration assumes and does not create, so
   the file must say so rather than failing obscurely on a fresh project. */
ok('the file names its is_admin() dependency',
   /admin-security\.sql/.test(canonical) && /admin-security\.sql/.test(minified));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
