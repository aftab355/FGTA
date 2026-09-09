/* The half of the studio that talks to the SERVER.
 *
 * This suite exists because of a bug that shipped: the studio guarded every
 * Supabase call with `window.sb`, but `sb` is a top-level `let` — a
 * script-scope binding that never becomes a window property. So `window.sb`
 * was permanently undefined, every server call was skipped, and Publish
 * reported "Not connected to the database" against a healthy project. The
 * studio ran entirely on the local draft and looked, to the other three
 * suites, exactly like a studio that worked.
 *
 * The lesson those suites encode now: assert that the CALL HAPPENED, not
 * only that the page changed. window.__sb in the harness records them.
 */
const {open, asAdmin, realErrors, reporter} = require('./studio-harness.js');
const ok = reporter();

(async () => {
  const {browser, page, errors} = await open();
  const sb = () => page.evaluate(() => window.__sb);

  // ---------- on load ----------
  const boot = await sb();
  ok('the published config is fetched on load',
     boot.tables.includes('site_config'), boot.tables.slice(-8));
  ok('realtime is subscribed so other admins land live',
     boot.channels.includes('site-config-live'), boot.channels);

  await asAdmin(page);
  await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(300);

  // ---------- publish reaches the server ----------
  const tab = await page.evaluate(()=>{
    const r = document.querySelector('.tb-tab[data-view="court"]').getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2};
  });
  await page.mouse.click(tab.x, tab.y);
  await page.waitForTimeout(250);
  await page.evaluate(()=>document.querySelector('#studioBar .sb-plus').click());
  await page.waitForTimeout(250);
  ok('there is something to publish', await page.evaluate(()=>
      !!document.querySelector('.sp-dirty')));

  /* Publish asks for a note with prompt(); answer it rather than hanging. */
  await page.evaluate(()=>{ window.prompt = () => 'test note'; });
  await page.evaluate(()=>document.querySelector('[data-act="publish"]').click());
  await page.waitForTimeout(600);

  const after = await sb();
  ok('publish called publish_site_config',
     after.rpcs.includes('publish_site_config'), after.rpcs);
  ok('it sent the actual config, not an empty object', after.publishes.length > 0 &&
     !!after.publishes[0] && !!after.publishes[0].new_config &&
     Object.keys(after.publishes[0].new_config.elcss || {}).length > 0,
     after.publishes[0]);
  ok('the note went with it',
     (after.publishes[0] || {}).note === 'test note', after.publishes[0]);

  ok('the draft is cleared once published', await page.evaluate(()=>
      !document.querySelector('.sp-dirty')));
  ok('Publish is disabled again', await page.evaluate(()=>
      document.querySelector('[data-act="publish"]').hasAttribute('disabled')));
  /* Read #toast, not document.body: the app's own <script> is a child of
     <body>, so body.textContent contains the entire source of the app —
     including the very string this assertion is looking for. */
  const toast = await page.evaluate(()=> (document.getElementById('toast')||{}).textContent || '');
  ok('the toast reports a publish, not "not connected"',
     !/not connected/i.test(toast), toast);
  ok('the toast confirms everyone can see it',
     /everyone sees this now/i.test(toast), toast);

  // ---------- history reads the server ----------
  await page.evaluate(()=>document.querySelector('[data-tab="history"]').click());
  await page.waitForTimeout(500);
  ok('the History tab queries site_config_history',
     (await sb()).tables.includes('site_config_history'), (await sb()).tables.slice(-6));

  ok('no uncaught errors', realErrors(errors).length === 0, realErrors(errors).slice(0,6));
  await browser.close();
  ok.done();
})();
