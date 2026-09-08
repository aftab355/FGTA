/* The direct-manipulation layer — the half that is supposed to feel like a
   design tool rather than a devtools panel:
     · a toolbar that appears ON the thing you clicked
     · double-click to type straight into the page
     · ⌘Z
     · grab the grip and drag a section somewhere else
*/
const {open, asAdmin, realErrors, reporter} = require('./studio-harness.js');
const ok = reporter();

(async () => {
  const {browser, page, errors} = await open();
  await asAdmin(page);
  await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(300);

  const centre = sel => page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2};
  }, sel);

  // ---------- the floating toolbar ----------
  const tab = await centre('.tb-tab[data-view="court"]');
  await page.mouse.click(tab.x, tab.y);
  await page.waitForTimeout(250);

  ok('toolbar appeared on the selection', await page.evaluate(()=>{
      const b = document.getElementById('studioBar');
      return !!b && getComputedStyle(b).display !== 'none';
  }));
  ok('toolbar names the thing in plain words', await page.evaluate(()=>
      document.querySelector('#studioBar .sb-name').textContent.includes('Court')));
  ok('toolbar sits near the selection', await page.evaluate(()=>{
      const b = document.getElementById('studioBar').getBoundingClientRect();
      const t = document.querySelector('.tb-tab[data-view="court"]').getBoundingClientRect();
      return Math.abs((b.left + b.width/2) - (t.left + t.width/2)) < 320;
  }));

  // A+ / A- step the rendered size
  const before = await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize);
  await page.evaluate(()=>document.querySelector('#studioBar .sb-plus').click());
  await page.waitForTimeout(200);
  const after = await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize);
  ok('A+ made it bigger', parseFloat(after) > parseFloat(before), {before, after});

  await page.evaluate(()=>document.querySelector('#studioBar .sb-bold').click());
  await page.waitForTimeout(200);
  ok('B made it bold', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontWeight === '700'));

  // ---------- ⌘Z ----------
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  ok('undo took the bold back off', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontWeight !== '700'));
  ok('undo left the size alone', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize) === after);

  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  ok('redo put it back', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontWeight === '700'));

  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  ok('undo unwinds more than one step', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.tb-tab[data-view="court"]')).fontSize) === before);

  // ---------- typing straight into the page ----------
  await page.mouse.dblclick(tab.x, tab.y);
  await page.waitForTimeout(250);
  ok('double-click made it editable in place', await page.evaluate(()=>{
      const e = document.querySelector('.fgta-inline');
      return !!e && e.getAttribute('contenteditable') !== null;
  }));
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Courts');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('typing committed as a copy override', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="court"]').textContent.trim() === 'Courts'));
  ok('no element is left editable', await page.evaluate(()=>
      !document.querySelector('.fgta-inline')));
  ok('the override is in the config, not just the DOM', await page.evaluate(()=>
      JSON.stringify(SITE.config().text).includes('Courts')));

  // Esc cancels rather than commits
  await page.mouse.dblclick(tab.x, tab.y);
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Should not stick');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Esc threw the typing away', await page.evaluate(()=>
      document.querySelector('.tb-tab[data-view="court"]').textContent.trim() === 'Courts'));
  ok('Esc from typing did not also close the studio', await page.evaluate(()=>
      !!document.getElementById('studioPanel')));
  // typing a SPACE into an editable <button> must not fire the button
  ok('typing into a nav tab did not navigate the app', await page.evaluate(()=>
      typeof activeView === 'undefined' || activeView === 'ladder'),
     await page.evaluate(()=>typeof activeView!=='undefined'?activeView:null));

  // ---------- drag a section to reorder ----------
  const order0 = await page.evaluate(()=>{
    const c = document.querySelector('#view-ladder');
    return Array.prototype.filter.call(c.children, n=>n.id!=='studioPanel')
      .map(n => n.id || n.className).slice(0,4);
  });
  /* Two traps here, both about where the click actually lands:
       · the app sets `html{scroll-behavior:smooth}`, so scrolling is
         ASYNCHRONOUS — measure after it settles, not in the same evaluate;
       · the top bar is `position:fixed`, so any point in the first ~80px
         belongs to the header no matter what is underneath it.
     So: pick the first section with real height, park it at y=200, and
     click well inside it. */
  const ladder = await page.evaluate(()=>{
    const v = document.querySelector('#view-ladder');
    const kids = Array.prototype.filter.call(v.children, n => n.id !== 'studioPanel');
    return {
      display: getComputedStyle(v).display,
      activeView: typeof activeView !== 'undefined' ? activeView : null,
      heights: kids.map(n => (n.id || String(n.className).split(' ')[0]) + ':' +
                             Math.round(n.getBoundingClientRect().height)),
      idx: kids.findIndex(n => n.getBoundingClientRect().height > 60)
    };
  });
  const firstIdx = ladder.idx;
  ok('the ladder has a section with real height to drag', firstIdx >= 0, ladder);
  if(firstIdx < 0){ ok('no uncaught errors', realErrors(errors).length === 0, realErrors(errors).slice(0,6)); await browser.close(); ok.done(); }
  await page.evaluate(i => {
    const kids = Array.prototype.filter.call(
      document.querySelector('#view-ladder').children, n => n.id !== 'studioPanel');
    window.scrollBy(0, kids[i].getBoundingClientRect().top - 200);
  }, firstIdx);
  await page.waitForTimeout(800);
  const first = await page.evaluate(i => {
    const kids = Array.prototype.filter.call(
      document.querySelector('#view-ladder').children, n => n.id !== 'studioPanel');
    const kid = kids[i];
    const r = kid.getBoundingClientRect();
    return {x: r.left + Math.min(30, r.width/2), y: r.top + 14,
            id: kid.id || String(kid.className).split(' ')[0]};
  }, firstIdx);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(250);
  const selParent = await page.evaluate(()=>
    ((document.querySelector('.sp-adv .sp-key')||{}).textContent||''));
  ok('clicking a section selects the section, not a wrapper deep inside it',
     selParent.startsWith('#view-ladder>') && selParent.split('>').length === 2, selParent);

  const grip = await page.evaluate(()=>{
    const g = document.querySelector('#studioBar .sb-drag');
    if(!g || getComputedStyle(g).display === 'none') return null;
    const r = g.getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2};
  });
  ok('a section offers a drag grip', !!grip);

  if(grip){
    /* aim at the bottom of the third VISIBLE sibling — #view-ladder carries
       hidden mounts whose rects are all zero, and dropping at y=0 would just
       put the section back where it started */
    const dropY = await page.evaluate(()=>{
      const c = document.querySelector('#view-ladder');
      const vis = Array.prototype.filter.call(c.children,
        n => n.id !== 'studioPanel' && getComputedStyle(n).display !== 'none');
      const third = vis[2] || vis[vis.length - 1];
      return third.getBoundingClientRect().bottom;
    });
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, dropY - 60, {steps:8});
    await page.mouse.move(grip.x, dropY, {steps:8});
    await page.waitForTimeout(120);
    ok('a drop line shows where it will land', await page.evaluate(()=>{
        const d = document.getElementById('studioDrop');
        return !!d && getComputedStyle(d).display !== 'none';
    }));
    await page.mouse.up();
    await page.waitForTimeout(300);

    const orderCfg = await page.evaluate(()=> SITE.config().order || {});
    ok('the drag wrote an order into the config', Object.keys(orderCfg).length > 0, orderCfg);
    ok('the order is on the view, not some wrapper inside it',
       Object.keys(orderCfg)[0] === '#view-ladder', orderCfg);
    ok('the drop line is gone afterwards', await page.evaluate(()=>{
        const d = document.getElementById('studioDrop');
        return !d || getComputedStyle(d).display === 'none';
    }));
    /* the ordering is CSS `order`, so "did it move" is a question about
       painted position, not DOM position — read it the way the browser does */
    const painted = await page.evaluate(()=>{
      const c = document.querySelector('#view-ladder');
      return Array.prototype.filter.call(c.children, n => n.id !== 'studioPanel')
        .map(n => ({name: n.id || String(n.className).split(' ')[0],
                    o: parseInt(getComputedStyle(n).order, 10) || 0}))
        .sort((a, b) => a.o - b.o)
        .map(x => x.name);
    });
    ok('the dragged section is no longer first', painted[0] !== first.id,
       {was: first.id, nowFirst: painted[0], painted});
    ok('it landed further down the stack', painted.indexOf(first.id) > 0,
       {landedAt: painted.indexOf(first.id), painted});
  }

  // ---------- the panel still works alongside all of it ----------
  await page.evaluate(()=>document.querySelector('[data-act="undo"]').click());
  await page.waitForTimeout(250);
  ok('the panel undo button works too', await page.evaluate(()=>
      Object.keys(SITE.config().order || {}).length === 0));

  ok('no uncaught errors', realErrors(errors).length === 0, realErrors(errors).slice(0,6));
  await browser.close();
  ok.done();
})();
