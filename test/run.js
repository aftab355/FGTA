/* The suite CI runs before anything is deployed.

   Only the tests that need nothing but Node are in it. The rest drive a real
   Chromium (studio*, serve, scoreboard…) or a real ffmpeg (render, ball,
   onsets…), which is minutes of setup per run and a second way for the gate
   to go red that has nothing to do with the change being deployed. They are
   still run by hand: node test/<name>.test.js

   What IS in here is the part of the app whose mistakes are silent — the Elo
   engine, the scoring rules, the migrations — which is exactly what should
   stop a deploy rather than be found by a player a week later.

   node test/run.js */
const {spawnSync} = require('child_process');
const path = require('path');

const SUITE = [
  'elo', 'score', 'score-frame', 'robin-plus', 'fall-exhibition', 'recap',
  'title-badges', 'outbox', 'kit', 'palette', 'floor', 'models', 'park-busy',
  'trim', 'vision-core', 'site-config-sql', 'client-errors-sql',
];

let failed = [];
for(const name of SUITE){
  const file = path.join(__dirname, name + '.test.js');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], {encoding: 'utf8', timeout: 5 * 60 * 1000});
  const ok = r.status === 0;
  console.log((ok ? 'pass ' : 'FAIL ') + name + '  (' + (Date.now() - t0) + 'ms)');
  if(!ok){
    failed.push(name);
    process.stdout.write((r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) + '\n' : ''));
  }
}
console.log('\n' + (SUITE.length - failed.length) + '/' + SUITE.length + ' passed');
if(failed.length){ console.log('failed: ' + failed.join(', ')); process.exit(1); }
