/* Shared rig for the Admin Studio tests.
 *
 * Two things every one of them needs, and neither is about the studio:
 *
 *   1. A Supabase that answers. The real client comes from a CDN, the tests
 *      run against the file on disk, and without a client the app script dies
 *      at createClient() long before anything under test is defined. The stub
 *      below answers every call with an empty result — except is_admin(),
 *      which answers true, because the studio's admin gate is part of what is
 *      being tested and reaching past it would test nothing.
 *
 *   2. No cinematic intro. It is a full-screen overlay, so with it up every
 *      hover and click in pick mode lands on the load screen. The app skips
 *      it when sessionStorage says this session has already seen it.
 *
 * Run:  node test/studio.test.js
 *       node test/studio-pick.test.js
 *       node test/studio-blocks.test.js
 */
const {chromium} = require('./playwright.js');
const path = require('path');

const APP_URL = 'file://' + path.join(__dirname, '..', 'index.html');

/* Chromium may be a system build (CI images, this project's dev box) rather
   than one Playwright downloaded. Honour the same environment variable
   Playwright itself uses, and otherwise let it find its own. */
function launchOpts(){
  const exe = process.env.CHROMIUM_PATH ||
    (process.env.PLAYWRIGHT_BROWSERS_PATH
      ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')
      : null);
  return exe && require('fs').existsSync(exe) ? {executablePath: exe} : {};
}

/* `freshStorage: false` keeps whatever localStorage holds, which is how the
   draft-survives-a-reload assertions work: this script runs on EVERY
   navigation, so clearing unconditionally would wipe the thing under test. */
function initScript(){
  const empty = () => Promise.resolve({data: [], error: null});
  const one   = () => Promise.resolve({data: null, error: null});
  const q = () => {
    const c = {
      select: () => c, eq: () => c, order: () => c, limit: () => c,
      insert: empty, update: empty, upsert: empty, delete: empty,
      maybeSingle: one, single: one,
      then: (res, rej) => empty().then(res, rej)
    };
    return c;
  };
  const chan = {on(){ return chan; }, subscribe(){ return chan; }, unsubscribe(){}};
  window.supabase = {
    createClient(){
      return {
        from: q,
        rpc: name => Promise.resolve({data: name === 'is_admin' ? true : null, error: null}),
        channel: () => chan,
        removeChannel(){},
        storage: {from: () => ({upload: one, remove: one,
          getPublicUrl: () => ({data:{publicUrl:''}})})},
        auth: {
          getSession: () => Promise.resolve({data:{session:{user:{id:'test', email:'admin@test'}}}}),
          onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
          signInWithPassword: one, signOut: one, signInWithOtp: one, verifyOtp: one
        }
      };
    }
  };
  try{
    if(!sessionStorage.getItem('fgta_loaded')) localStorage.clear();
    sessionStorage.setItem('fgta_loaded', '1');   // also skips the intro
  }catch(e){}
}

async function open({width = 1400, height = 900} = {}){
  const browser = await chromium.launch(launchOpts());
  const page = await browser.newPage({viewport:{width, height}});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(initScript);
  await page.goto(APP_URL);
  await page.waitForTimeout(1300);
  return {browser, page, errors};
}

/* Sign in through the app's own path — refreshAdminStatus() calls is_admin()
   and only then flips isAdmin — rather than poking the flag from outside. */
async function asAdmin(page){
  await page.evaluate(async () => { await refreshAdminStatus(); });
}

/* Everything a file:// load complains about that has nothing to do with the
   thing under test: the CDN, the Netlify function, the font stylesheet. */
const IGNORABLE = /supabase|Failed to load|net::|ERR_|fonts\.googleapis|CORS policy|youtube/i;
const realErrors = errs => errs.filter(e => !IGNORABLE.test(e));

function reporter(){
  let fails = 0;
  const ok = (name, cond, extra) => {
    console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond ? '' : '   ' + JSON.stringify(extra)));
    if(!cond) fails++;
  };
  ok.done = () => {
    console.log(fails ? `\n${fails} FAILED` : '\nall passed');
    process.exit(fails ? 1 : 0);
  };
  return ok;
}

module.exports = {open, asAdmin, realErrors, reporter, APP_URL};
