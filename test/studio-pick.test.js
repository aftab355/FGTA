/* The click-to-pick half of the studio: hovering outlines things, clicking
   selects instead of activating, and the inspector then actually edits the
   thing that was clicked. */
const {open, asAdmin, realErrors, reporter} = require('./studio-harness.js');
const ok = reporter();

(async () => {
  const {browser, page, errors} = await open();
  await asAdmin(page); await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(250);

  // pick mode is armed by the time the studio is open — opening an editor and
  // then having to arm it is the step nobody expects
  ok('pick mode is on as soon as the studio opens',
     await page.evaluate(()=>document.documentElement.hasAttribute('data-fgta-pick')));

  // hover a nav tab -> highlight appears with the right key
  const tabBox = await page.evaluate(()=>{
    const r=document.querySelector('.tb-tab[data-view="court"]').getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};
  });
  await page.mouse.move(tabBox.x, tabBox.y);
  await page.waitForTimeout(120);
  ok('hover highlight is showing', await page.evaluate(()=>
      getComputedStyle(document.getElementById('studioHi')).display!=='none'));
  // the chip says what the thing IS, not where it lives
  const chip = await page.evaluate(()=>document.getElementById('studioTag').textContent);
  ok('hover chip names the element in plain words', chip.includes('Court'), chip);
  ok('hover chip is not a CSS selector', !/nth-of-type|#topTabs/.test(chip), chip);

  // click it -> selects, does NOT navigate
  const viewBefore = await page.evaluate(()=>typeof activeView!=='undefined'?activeView:null);
  await page.mouse.click(tabBox.x, tabBox.y);
  await page.waitForTimeout(200);
  ok('click did not navigate', await page.evaluate(()=>typeof activeView!=='undefined'?activeView:null)===viewBefore);
  const selName = await page.evaluate(()=>((document.querySelector('.sp-selname')||{}).textContent||''));
  ok('inspector names the selection in plain words', selName.includes('Court'), selName);
  /* Advanced now lists two: the key edits are SAVED under (the group, by
     default) and this element's own address. Both are exact selectors. */
  ok('the element\'s own selector is still there, demoted to Advanced', await page.evaluate(()=>{
      const el = document.querySelector('.sp-adv .sp-key-el');
      return !!el && el.textContent.includes('topTabs');
  }));
  ok('Advanced also names the key the edits actually go to', await page.evaluate(()=>{
      const a = document.querySelector('.sp-adv .sp-key-active');
      return !!a && a.textContent.trim().length > 0;
  }));

  // retype it through the inspector
  await page.evaluate(()=>{
    const i=document.querySelector('[data-act="text"]');
    i.value='Courts & Weather';
    i.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.waitForTimeout(200);
  ok('picked element retyped', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="court"]').textContent.trim()==='Courts & Weather'));

  // restyle it with the size slider
  await page.evaluate(()=>{
    const i=document.querySelector('[data-css-range="font-size"]');
    i.value='22'; i.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(200);
  ok('per-element style applied', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize==='22px'));

  // hide it, then clear every edit on it
  await page.evaluate(()=>document.querySelector('[data-act="hide"]').click());
  await page.waitForTimeout(200);
  ok('picked element hidden', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).display==='none'));
  await page.evaluate(()=>document.querySelector('[data-act="sel-clear"]').click());
  await page.waitForTimeout(250);
  ok('clear-all restored visibility', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).display!=='none'));
  ok('clear-all restored the words', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="court"]').textContent.trim()==='Court'));
  ok('clear-all restored the size', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize!=='22px'));

  // pick off -> the site is usable again
  await page.evaluate(()=>document.querySelector('[data-act="pick"]').click());
  await page.waitForTimeout(120);
  await page.mouse.click(tabBox.x, tabBox.y);
  await page.waitForTimeout(300);
  ok('pick off lets navigation work', await page.evaluate(()=>
      typeof activeView!=='undefined' && activeView==='court'));
  ok('panel still open after navigating', await page.$('#studioPanel')!==null);

  // Escape leaves pick first, then the studio
  await page.evaluate(()=>document.querySelector('[data-act="pick"]').click());
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  ok('Esc left pick mode but kept the studio', await page.evaluate(()=>
      !document.documentElement.hasAttribute('data-fgta-pick') && !!document.getElementById('studioPanel')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  ok('second Esc closed the studio', await page.evaluate(()=>
      !document.getElementById('studioPanel') && !document.documentElement.hasAttribute('data-fgta-edit')));

  ok('no uncaught errors', realErrors(errors).length===0, realErrors(errors).slice(0,5));
  await browser.close();
  ok.done();
})();
