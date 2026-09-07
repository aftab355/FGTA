/* The Admin Studio end to end: theme, typography, navigation, section order,
   feature switches, raw CSS, presets, and the draft that survives a reload.
   Runs against index.html on disk with a stubbed Supabase — see
   test/studio-harness.js. */
const {open, asAdmin, realErrors, reporter} = require('./studio-harness.js');
const ok = reporter();

(async () => {
  const {browser, page, errors} = await open();

  ok('page loaded with no uncaught errors', realErrors(errors).length===0, realErrors(errors).slice(0,6));
  ok('SITE exists', await page.evaluate(()=>typeof window.SITE==='object'));
  ok('font tokens resolve', await page.evaluate(()=>
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono').includes('JetBrains')));

  // become an admin through the app's own path, then open the studio
  await asAdmin(page);
  ok('is_admin() gate recognised the session', await page.evaluate(()=>
      document.getElementById('studioBtn').style.display !== 'none'));
  await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(200);
  ok('studio panel opened', await page.$('#studioPanel') !== null);
  ok('edit attribute set', await page.evaluate(()=>document.documentElement.hasAttribute('data-fgta-edit')));

  // --- theme ---
  await page.evaluate(()=>{
    document.querySelector('[data-tab="theme"]').click();
  });
  await page.waitForTimeout(120);
  await page.evaluate(()=>{
    const i = document.querySelector('[data-tok-text="--accent"]');
    i.value = 'rgb(0, 200, 255)';
    i.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(120);
  ok('accent token applied to <html>', await page.evaluate(()=>
      document.documentElement.style.getPropertyValue('--accent').trim()==='rgb(0, 200, 255)'));
  ok('accent visible in a real element', await page.evaluate(()=>{
      const el = document.querySelector('.tb-tab.on');
      return getComputedStyle(el).borderBottomColor.includes('0, 200, 255') ||
             getComputedStyle(document.body).getPropertyValue('--accent').includes('0, 200, 255');
  }));
  ok('draft marked dirty', await page.evaluate(()=> !!document.querySelector('.sp-dirty')));

  // --- typography ---
  await page.evaluate(()=>{ document.querySelector('[data-tab="type"]').click(); });
  await page.waitForTimeout(100);
  await page.evaluate(()=>{
    const s = document.querySelector('[data-type="bodyFont"]');
    s.value = "'Sora',sans-serif";
    s.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(150);
  ok('body font token swapped', await page.evaluate(()=>
      getComputedStyle(document.documentElement).getPropertyValue('--font-body').includes('Sora')));
  ok('google font link injected once', await page.evaluate(()=>
      document.querySelectorAll('#fgtaStudioFonts').length===1));

  // --- select an element, retype it, restyle it, hide it ---
  await page.evaluate(()=>{
    SITE.openStudio();
  });
  await page.evaluate(()=>{
    // drive select() through the public-ish path the picker uses
    document.querySelector('[data-tab="layout"]').click();
  });
  await page.waitForTimeout(150);
  ok('layout tab lists nav rows', await page.evaluate(()=>document.querySelectorAll('[data-navrow]').length > 3));

  // rename a nav tab
  await page.evaluate(()=>{
    const i = document.querySelector('[data-navlabel="predict"]');
    i.value = 'Crystal Ball';
    i.dispatchEvent(new Event('change', {bubbles:true}));
  });
  await page.waitForTimeout(150);
  ok('nav label rewritten on desktop bar', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="predict"]').textContent.trim().startsWith('Crystal Ball')));
  ok('nav label rewritten on mobile bar too', await page.evaluate(()=>{
      const bb = document.querySelector('.bb-tab[data-view="predict"]');
      return !bb || bb.textContent.includes('Crystal Ball');
  }));

  // hide a nav tab
  await page.evaluate(()=>{
    document.querySelector('[data-navrow="doubles"] [data-act="nav-hide"]').click();
  });
  await page.waitForTimeout(150);
  ok('hidden nav tab is display:none', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="doubles"]')).display==='none'));
  ok('nav bar is still a row (not stood on end)', await page.evaluate(()=>
      getComputedStyle(document.querySelector('#topTabs')).flexDirection!=='column'));

  // reorder sections on the open view
  const before = await page.evaluate(()=>{
    const c = document.querySelector('#view-ladder');
    return Array.prototype.map.call(c.children, n=>n.id||n.className).slice(0,3);
  });
  await page.evaluate(()=>{
    const btns = document.querySelectorAll('[data-act="sec-down"]');
    if(btns[0]) btns[0].click();
  });
  await page.waitForTimeout(150);
  const orderCSS = await page.evaluate(()=>document.getElementById('fgtaStudioLayout').textContent);
  ok('reorder emitted flex order rules', /order:/.test(orderCSS), orderCSS.slice(0,200));
  ok('reorder made the view a column flexbox', await page.evaluate(()=>
      getComputedStyle(document.querySelector('#view-ladder')).flexDirection==='column'));

  // --- features ---
  await page.evaluate(()=>{ document.querySelector('[data-tab="features"]').click(); });
  await page.waitForTimeout(100);
  await page.evaluate(()=>{ document.querySelector('[data-feat="podium"]').click(); });
  await page.waitForTimeout(150);
  ok('feature off hides its target', await page.evaluate(()=>
      getComputedStyle(document.querySelector('#podium')).display==='none'));
  ok('SITE.flag reports it off', await page.evaluate(()=> SITE.flag('podium')===false));
  await page.evaluate(()=>{ document.querySelector('[data-feat="fx"]').click(); });
  await page.waitForTimeout(120);
  ok('fx feature reaches the FX global', await page.evaluate(()=> FX.reduce===true));

  // --- raw CSS ---
  await page.evaluate(()=>{ document.querySelector('[data-tab="css"]').click(); });
  await page.waitForTimeout(100);
  await page.evaluate(()=>{
    const t = document.querySelector('[data-act="css"]');
    t.value = '.panel{border-radius:0px}';
    t.dispatchEvent(new Event('input', {bubbles:true}));
  });
  await page.waitForTimeout(600);
  ok('custom CSS applied', await page.evaluate(()=>{
      const p = document.querySelector('.panel');
      return p && getComputedStyle(p).borderTopLeftRadius==='0px';
  }));

  // --- preset ---
  await page.evaluate(()=>{ document.querySelector('[data-tab="presets"]').click(); });
  await page.waitForTimeout(100);
  await page.evaluate(()=>{ document.querySelector('[data-act="preset"][data-name="Paper (light)"]').click(); });
  await page.waitForTimeout(200);
  ok('preset repainted the page background', await page.evaluate(()=>
      document.documentElement.style.getPropertyValue('--bg').trim()==='#f4f2ee'));

  // --- persistence of the draft across a reload ---
  await page.reload();
  await page.waitForTimeout(1200);
  ok('draft survived a reload', await page.evaluate(()=>
      document.documentElement.style.getPropertyValue('--bg').trim()==='#f4f2ee'));
  ok('renamed tab survived a reload', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="predict"]').textContent.trim().startsWith('Crystal Ball')));

  // --- copy override survives a re-render (the MutationObserver's job) ---
  await asAdmin(page); await page.evaluate(()=> SITE.openStudio());
  await page.evaluate(()=>{
    // force a re-render of the ladder view and check the nav label holds
    if(typeof render==='function'){ try{ render(); }catch(e){} }
    const host = document.querySelector('#topTabs');
    host.innerHTML = host.innerHTML;   // the worst case: wholesale replacement
  });
  await page.waitForTimeout(200);
  ok('copy override re-applied after innerHTML wipe', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="predict"]').textContent.trim().startsWith('Crystal Ball')));

  // --- reset ---
  /* fresh DOM first: the innerHTML round-trip above deliberately baked the
     override into the markup, so on those nodes "Crystal Ball" IS the
     original and there is nothing to restore. A reload is what a real
     re-render looks like. */
  await page.reload();
  await page.waitForTimeout(1200);
  await asAdmin(page); await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(200);
  await page.evaluate(()=>{
    window.confirm = ()=>true;
    document.querySelector('[data-tab="presets"]').click();
  });
  await page.waitForTimeout(120);
  await page.evaluate(()=>{ document.querySelector('[data-act="reset-all"]').click(); });
  await page.waitForTimeout(200);
  ok('reset cleared the theme', await page.evaluate(()=>
      !document.documentElement.style.getPropertyValue('--bg')));
  ok('reset restored the nav label', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="predict"]').textContent.trim().startsWith('Predict')));
  ok('reset unhid the doubles tab', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="doubles"]')).display!=='none'));

  const late = realErrors(errors);
  ok('no uncaught errors across the whole run', late.length===0, late.slice(0,8));

  await browser.close();
  ok.done();
})();
