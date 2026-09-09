/* Scope — "change one, change all like it".
 *
 * Restyling one match card and then doing the other thirty-nine by hand is
 * data entry, not editing. A config key is already a CSS selector, so a key
 * of `.pend` styles every pending row through the same generated rule a
 * positional key uses; the job is picking the selector and showing what it
 * is about to touch.
 */
const {open, asAdmin, realErrors, reporter} = require('./studio-harness.js');
const ok = reporter();

(async () => {
  const {browser, page, errors} = await open();
  await asAdmin(page);
  await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(300);

  /* The nav tabs are the cleanest repeated component on a cold page: ten
     buttons, one shared class, all visible without scrolling. */
  const tab = await page.evaluate(()=>{
    const r = document.querySelector('.tb-tab[data-view="court"]').getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2};
  });
  await page.mouse.click(tab.x, tab.y);
  await page.waitForTimeout(300);

  // ---------- it defaults to the group ----------
  const scope = await page.evaluate(()=>{
    const sel = document.querySelector('select[data-act="scope"]');
    return sel ? {value: sel.value, options: Array.from(sel.options).map(o=>o.textContent)} : null;
  });
  ok('a scope picker appears for a repeated element', !!scope, scope);
  ok('it defaults to the group, not the single element',
     !!scope && scope.value !== '', scope);
  ok('the options say how many each one covers',
     !!scope && scope.options.some(t=>/^all \d+ like this$/.test(t)), scope && scope.options);
  ok('"just this one" is always offered',
     !!scope && scope.options.includes('just this one'), scope && scope.options);

  ok('the toolbar shows the count', await page.evaluate(()=>{
      const p = document.querySelector('#studioBar .sb-scope');
      return !!p && /\d/.test(p.textContent) && getComputedStyle(p).display !== 'none';
  }));
  ok('the other members are outlined on the page', await page.evaluate(()=>
      document.querySelectorAll('.fgta-peer').length > 1));

  // ---------- one change, every tab ----------
  const before = await page.evaluate(()=>
    Array.from(document.querySelectorAll('.tb-tab')).map(n=>getComputedStyle(n).fontSize));
  await page.evaluate(()=>{
    const i = document.querySelector('[data-css-range="font-size"]');
    i.value = '21'; i.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(()=>
    Array.from(document.querySelectorAll('.tb-tab')).map(n=>getComputedStyle(n).fontSize));

  ok('every tab took the change, not just the one clicked',
     after.length > 3 && after.every(v => v === '21px'), {before: before.slice(0,4), after: after.slice(0,4)});
  ok('it is stored under ONE group key, not one key per element',
     await page.evaluate(()=>Object.keys(SITE.config().elcss || {}).length === 1),
     await page.evaluate(()=>Object.keys(SITE.config().elcss || {})));
  ok('the key is a class selector, not a positional one',
     await page.evaluate(()=>{
       const k = Object.keys(SITE.config().elcss || {})[0] || '';
       return k.startsWith('.') && !/nth-of-type/.test(k);
     }), await page.evaluate(()=>Object.keys(SITE.config().elcss || {})[0]));

  // ---------- switching to "just this one" ----------
  await page.evaluate(()=>{
    const s = document.querySelector('select[data-act="scope"]');
    s.value = ''; s.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(250);
  ok('the outlines go when scope narrows', await page.evaluate(()=>
      document.querySelectorAll('.fgta-peer').length === 0));

  await page.evaluate(()=>{
    const i = document.querySelector('[data-css-range="font-size"]');
    i.value = '30'; i.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(300);
  const mixed = await page.evaluate(()=>({
    court: getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize,
    other: getComputedStyle(document.querySelector('.tb-tab[data-view="predict"]')).fontSize
  }));
  ok('the narrow edit hits only the one clicked', mixed.court === '30px', mixed);
  ok('the group edit is still in force for the rest', mixed.other === '21px', mixed);

  /* ---------- undo follows the scope control, and says so ----------
     Clearing both scopes at once was the other option and it is worse:
     narrowing to one card to fix it and then pressing undo would silently
     reset the rest. So undo clears exactly the scope shown, and the button
     names it. */
  ok('the undo button names the narrow scope', await page.evaluate(()=>
      document.querySelector('[data-act="sel-clear"]').textContent.trim()),
     (await page.evaluate(()=>document.querySelector('[data-act="sel-clear"]').textContent)).includes('this one'));

  await page.evaluate(()=>document.querySelector('[data-act="sel-clear"]').click());
  await page.waitForTimeout(300);
  const narrowCleared = await page.evaluate(()=>({
    court: getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize,
    other: getComputedStyle(document.querySelector('.tb-tab[data-view="predict"]')).fontSize
  }));
  ok('undo at narrow scope removes only the element-level edit',
     narrowCleared.court === '21px', narrowCleared);
  ok('and deliberately leaves the group edit alone',
     narrowCleared.other === '21px', narrowCleared);

  // now widen and clear again — that should take the group with it
  await page.evaluate(()=>{
    const s = document.querySelector('select[data-act="scope"]');
    s.value = s.options[0].value; s.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(250);
  ok('the undo button names the group scope', await page.evaluate(()=>
      /Undo edits on all \d+/.test(document.querySelector('[data-act="sel-clear"]').textContent)),
     await page.evaluate(()=>document.querySelector('[data-act="sel-clear"]').textContent.trim()));

  await page.evaluate(()=>document.querySelector('[data-act="sel-clear"]').click());
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(()=>({
    other: getComputedStyle(document.querySelector('.tb-tab[data-view="predict"]')).fontSize,
    keys: Object.keys(SITE.config().elcss || {})
  }));
  ok('undo at group scope removes the group edit',
     cleared.other !== '21px' && cleared.keys.length === 0, cleared);

  /* ---------- state classes must not become the key ----------
     `.on` says what an element is doing right now, not what it is. Keying a
     rule on it would mean a style that appears and disappears as the page
     updates. The ladder tab is `.tb-tab.on` while it is the open view, so
     selecting it is a live test of the filter. */
  const activeTab = await page.evaluate(()=>{
    const el = document.querySelector('.tb-tab.on');
    if(!el) return null;
    const r = el.getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2, cls: el.className};
  });
  ok('there is an active tab carrying a state class to test against',
     !!activeTab && /\bon\b/.test(activeTab.cls), activeTab);

  if(activeTab){
    await page.mouse.click(activeTab.x, activeTab.y);
    await page.waitForTimeout(300);
    const chosen = await page.evaluate(()=>{
      const s = document.querySelector('select[data-act="scope"]');
      return s ? Array.from(s.options).map(o=>o.value).filter(Boolean) : [];
    });
    ok('no candidate group keys off a state class', chosen.length > 0 &&
       chosen.every(sel => !/\.on\b|\.open\b|\.active\b|\.live\b/.test(sel)), chosen);
    ok('it still found the real group', chosen.some(sel => /tb-tab/.test(sel)), chosen);
  }

  ok('no uncaught errors', realErrors(errors).length === 0, realErrors(errors).slice(0,6));
  await browser.close();
  ok.done();
})();
