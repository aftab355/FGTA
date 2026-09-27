/* docs/client-errors.sql takes inserts from anyone on the internet, so the
   two things that must never regress are that nobody but an admin can read
   it back, and that a row can't be used to store arbitrary amounts of text.

   node test/client-errors-sql.test.js   (no dependencies) */
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'client-errors.sql'), 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if(!cond) fails++; };

ok('row level security is enabled', /alter table public\.client_errors enable row level security/.test(sql));
const select = sql.match(/for select\s+using \(([^;]*)\);/);
ok('select is admin-only', !!select && select[1].trim() === 'public.is_admin()');
const del = sql.match(/for delete\s+using \(([^;]*)\);/);
ok('delete is admin-only', !!del && del[1].trim() === 'public.is_admin()');
ok('no update policy (reports are append-only)', !/for update/.test(sql));
ok('message length is capped', /char_length\(message\) <= \d+/.test(sql));
ok('every create policy is preceded by its drop (re-runnable)',
  (sql.match(/create policy (\w+)/g) || []).every(c => sql.includes('drop policy if exists ' + c.split(' ')[2])));
ok('table creation is idempotent', /create table if not exists public\.client_errors/.test(sql));

if(fails){ console.log('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nall ok');
