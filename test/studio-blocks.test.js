/* Blocks: adding content that was never in the markup, keeping it through a
   re-render, sanitising what an admin pastes, and taking it away again. */
const {open, asAdmin, realErrors, reporter} = require('./studio-harness.js');
const ok = reporter();

(async () => {
  const {browser, page, errors} = await open();
  await asAdmin(page); await page.evaluate(()=> SITE.openStudio());
  await page.waitForTimeout(250);

  // pick the ladder board, then add a block above it
  await page.evaluate(()=>{
    document.querySelector('[data-act="pick"]').click();
  });
  const p = await page.evaluate(()=>{
    const r=document.querySelector('#board').getBoundingClientRect();
    return {x:r.left+20, y:r.top+10};
  });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  await page.evaluate(()=>document.querySelector('[data-act="pick"]').click()); // pick off
  await page.evaluate(()=>document.querySelector('[data-tab="blocks"]').click());
  await page.waitForTimeout(150);
  ok('blocks tab offers the picked anchor', await page.evaluate(()=>
      !!document.querySelector('[data-act="block-add"]')));

  await page.evaluate(()=>document.querySelector('[data-act="block-add"]').click());
  await page.waitForTimeout(250);
  ok('block appeared on the page', await page.evaluate(()=>
      document.querySelectorAll('.fgta-block').length===1));
  ok('block carries its default content', await page.evaluate(()=>
      document.querySelector('.fgta-block').textContent.includes('Say something here')));
  ok('block is styled, not bare', await page.evaluate(()=>
      getComputedStyle(document.querySelector('.fgta-block')).paddingTop!=='0px'));

  // edit its HTML, including things that must be stripped
  await page.evaluate(()=>{
    const t=document.querySelector('[data-block-html]');
    t.value='<h3>Nets are down</h3><p>Back Friday.</p>'+
            '<script>window.__pwned=1<\/script>'+
            '<iframe src="https://evil.example"></iframe>'+
            '<a href="javascript:window.__pwned=2">click</a>'+
            '<img src="x.png" onerror="window.__pwned=3">';
    t.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.waitForTimeout(700);
  ok('block content updated', await page.evaluate(()=>
      document.querySelector('.fgta-block').textContent.includes('Nets are down')));
  ok('script tag stripped', await page.evaluate(()=>
      !document.querySelector('.fgta-block script') && window.__pwned===undefined));
  ok('iframe stripped', await page.evaluate(()=>!document.querySelector('.fgta-block iframe')));
  ok('javascript: href stripped', await page.evaluate(()=>
      !document.querySelector('.fgta-block a').getAttribute('href')));
  ok('inline handler stripped', await page.evaluate(()=>
      !document.querySelector('.fgta-block img').getAttribute('onerror')));

  /* placement is checked against whatever the picker actually anchored to —
     a click inside #board lands on the child under the cursor, not on #board,
     which is the correct behaviour and exactly what the config records */
  const place = () => page.evaluate(()=>{
    const cfg=SITE.config().blocks[0];
    const anchor=document.querySelector(cfg.anchor);
    const blk=document.querySelector('.fgta-block');
    return {pos:cfg.position, after:anchor.nextElementSibling===blk, before:blk.nextElementSibling===anchor};
  });
  const p1 = await place();
  ok('a new block defaults to sitting below its anchor', p1.pos==='after' && p1.after, p1);
  await page.evaluate(()=>{
    const s=document.querySelector('[data-block-pos]');
    s.value='before'; s.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(200);
  const p2 = await place();
  ok('switching to "above it" re-places it', p2.pos==='before' && p2.before, p2);

  // survives a wholesale re-render of the region
  await page.evaluate(()=>{
    const host=document.querySelector('#board').parentElement;
    host.innerHTML = host.innerHTML.replace(/<fgta-block[\s\S]*?<\/fgta-block>/,'');
  });
  await page.waitForTimeout(300);
  ok('block re-inserted after a re-render', await page.evaluate(()=>
      document.querySelectorAll('.fgta-block').length===1));
  ok('exactly one copy, not duplicated', await page.evaluate(()=>
      document.querySelectorAll('[data-fgta-block]').length===1));

  // survives a reload (draft persistence)
  await page.reload(); await page.waitForTimeout(1300);
  ok('block survived a reload', await page.evaluate(()=>
      document.querySelectorAll('.fgta-block').length===1 &&
      document.querySelector('.fgta-block').textContent.includes('Nets are down')));

  // hide, then delete
  await asAdmin(page);
  await page.evaluate(()=>{ SITE.openStudio(); document.querySelector('[data-tab="blocks"]').click(); });
  await page.waitForTimeout(200);
  await page.evaluate(()=>document.querySelector('[data-act="block-toggle"]').click());
  await page.waitForTimeout(250);
  ok('hiding removes it from the page', await page.evaluate(()=>
      document.querySelectorAll('.fgta-block').length===0));
  await page.evaluate(()=>{ window.confirm=()=>true;
    document.querySelector('[data-act="block-del"]').click(); });
  await page.waitForTimeout(250);
  ok('deleting removes it from the config', await page.evaluate(()=>
      (SITE.config().blocks||[]).length===0));

  ok('no uncaught errors', realErrors(errors).length===0, realErrors(errors).slice(0,5));
  await page.evaluate(()=>document.querySelector('[data-tab="blocks"]').click());
  await page.waitForTimeout(200);
  await browser.close();
  ok.done();
})();
