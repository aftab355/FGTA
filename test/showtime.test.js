/* The Showtime layer's contract, checked in a real browser.

   The whole point of section 12 is that it is decoration that cannot
   become a bug, so what is tested here is almost entirely what it must
   NOT do: not swallow a tap, not overflow a phone, not leave inline
   styles on the app's buttons, not keep a loop running when it is
   turned off, and not write a visitor's preference when an admin
   changes a site-wide flag.

   Needs playwright and a chromium build:
     npm i -g playwright && npx playwright install chromium
   Then:
     node test/showtime.test.js                                       */
const {chromium} = require('./playwright.js');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = {'.html':'text/html','.js':'text/javascript','.json':'application/json',
              '.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

function serve(rq, rs){
  const rel = decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(ROOT, rel);
  if(!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(rs);
}

let fails = 0;
function ok(name, cond, detail){
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '   ' + JSON.stringify(detail)));
  if(!cond) fails++;
}

/* the ladder is server-data, and these tests run with no server, so the
   podium the foil and the tilt are meant to adopt is planted by hand */
const PLANT = () => {
  const host = document.querySelector('.col-main section') || document.body;
  const box = document.createElement('div');
  box.className = 'ladder';
  box.innerHTML = [1,2,3,4,5].map(i =>
    `<div class="brow ${i < 4 ? 'g' + i : ''}"><span>${i}</span><span>P${i}</span></div>`).join('');
  host.appendChild(box);
};

/* open a fresh tab on a URL and report what the layer did with it */
async function ctxNewPage(ctx, u){
  const t = await ctx.newPage();
  await t.goto(u, {waitUntil:'domcontentloaded'});
  await t.waitForTimeout(2200);
  const out = await t.evaluate(() => ({
    level: window.SHOW ? SHOW.level : 'n/a',
    canvas: !!document.getElementById('showFx'),
    stored: (function(){ try{ return JSON.parse(localStorage.getItem('fgta_showtime')||'{}').level; }catch(e){ return null; } })()
  }));
  await t.close();
  return out;
}

(async () => {
  const server = http.createServer(serve);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});

  /* ---- 1. a phone ------------------------------------------------ */
  const phone = await browser.newContext({viewport:{width:390,height:844},
    deviceScaleFactor:3, isMobile:true, hasTouch:true});
  const p = await phone.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2500);
  await p.evaluate(PLANT);
  await p.waitForTimeout(1200);

  const boot = await p.evaluate(() => ({
    api:      typeof window.SHOW === 'object',
    level:    SHOW.level,
    canvas:   !!document.getElementById('showFx'),
    onlyOne:  document.querySelectorAll('canvas#showFx,canvas#showBg').length,
    ribbon:   !!document.querySelector('.show-ribbon'),
    foils:    document.querySelectorAll('.show-holo').length,
    tilts:    document.querySelectorAll('.show-tilt').length,
    /* a cursor ring on a touch screen is litter; the CSS must hide it */
    cursorPainted: (function(){
      const c = document.querySelector('.show-cursor');
      return c ? getComputedStyle(c).display !== 'none' : false;
    })(),
    dprCapped: SHOW.stats.dpr <= 2
  }));
  ok('boots and exposes window.SHOW', boot.api);
  ok('defaults to a level that is on', boot.level !== 'off', boot.level);
  ok('paints on exactly one canvas', boot.canvas && boot.onlyOne === 1, boot);
  ok('mounts the scroll ribbon', boot.ribbon);
  ok('adopts the podium for the foil', boot.foils === 3, boot.foils);
  ok('adopts cards for the tilt', boot.tilts > 0, boot.tilts);
  ok('draws no cursor ring on a touch screen', !boot.cursorPainted);
  ok('caps the backing store at DPR 2 on a DPR 3 phone', boot.dprCapped, boot);

  /* THE ONE THAT MATTERS. A full-viewport canvas over every button is
     only acceptable while it is untouchable. */
  const hit = await p.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? (el.id || el.tagName) : 'null';
  });
  ok('the canvas never takes the hit test', hit !== 'showFx', hit);

  const tap = await p.evaluate(async () => {
    let got = 0;
    const b = document.querySelector('.tb-tab') || document.querySelector('button');
    b.addEventListener('click', () => got++, {once:true});
    b.click();
    await new Promise(r => setTimeout(r, 60));
    return got;
  });
  ok('a button still receives its click', tap === 1, tap);

  ok('nothing overflows a 390px viewport', await p.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth),
    await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));

  /* ---- 2. the ripple gives the element back ----------------------- */
  const rip = await p.evaluate(async () => {
    const b = document.querySelector('.tb-ico') || document.querySelector('button');
    const before = {p: b.style.position, o: b.style.overflow};
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', {clientX:r.left+4, clientY:r.top+4, bubbles:true}));
    await new Promise(res => setTimeout(res, 60));
    const during = document.querySelectorAll('.show-ripple').length;
    await new Promise(res => setTimeout(res, 900));
    return {during, after:{p:b.style.position, o:b.style.overflow}, before,
            left: document.querySelectorAll('.show-ripple').length};
  });
  ok('a press ripples', rip.during > 0, rip);
  ok('the ripple element is cleaned up', rip.left === 0, rip);
  ok('the button keeps the inline styles it started with',
     rip.after.p === rip.before.p && rip.after.o === rip.before.o, rip);

  /* ---- 3. the decode always restores the real heading ------------- */
  const decoded = await p.evaluate(async () => {
    const el = document.querySelector('.sec-label');
    if(!el) return {skip:true};
    let node = null;
    for(const c of el.childNodes) if(c.nodeType === 3 && c.nodeValue.trim().length > 2){ node = c; break; }
    if(!node) return {skip:true};
    const real = node.nodeValue;
    delete el.dataset.scram;
    SHOW.adopt();
    el.classList.remove('show-scramble');
    /* run it directly, then wait past the longest it can take */
    await new Promise(r => setTimeout(r, 2600));
    return {real, now: node.nodeValue, tinted: el.classList.contains('show-scramble')};
  });
  if(!decoded.skip){
    ok('the decode leaves the heading exactly as it found it',
       decoded.now === decoded.real, decoded);
    ok('the decode takes its tint off again', !decoded.tinted, decoded);
  }

  /* ---- 4. off means off ------------------------------------------- */
  const off = await p.evaluate(async () => {
    SHOW.fireworks(6); SHOW.cannon();
    await new Promise(r => setTimeout(r, 250));
    const alive = SHOW.stats.alive;
    SHOW.set('off');
    await new Promise(r => setTimeout(r, 300));
    let frames = 0;
    const t0 = performance.now();
    /* if the engine's loop were still running it would be scheduling
       work every frame; what is checked is that it stopped emitting */
    SHOW.fireworks(6); SHOW.cannon(); SHOW.ballRain(1); SHOW.ace();
    await new Promise(r => { (function f(){ frames++;
      if(performance.now() - t0 < 500) requestAnimationFrame(f); else r(); })(); });
    return {aliveBefore: alive, aliveAfter: SHOW.stats.alive,
            cls: document.body.classList.contains('show-off'),
            canvasHidden: getComputedStyle(document.getElementById('showFx')).display === 'none'};
  });
  ok('particles actually spawn when it is on', off.aliveBefore > 0, off);
  ok('nothing spawns once it is off', off.aliveAfter === 0, off);
  ok('the body carries show-off', off.cls);
  ok('the canvas is hidden when off', off.canvasHidden);

  /* ---- 5. the admin flag must not touch a visitor's own setting ---- */
  const flag = await p.evaluate(async () => {
    SHOW.set('showtime');
    const stored = () => { try{ return JSON.parse(localStorage.getItem('fgta_showtime') || '{}').level; }catch(e){ return null; } };
    const mine = stored();
    const realFlag = SITE.flag;
    SITE.flag = id => id === 'showtime' ? false : realFlag.call(SITE, id);
    SHOW.refresh();
    const underFlag = {level: SHOW.level, stored: stored()};
    SITE.flag = realFlag;
    SHOW.refresh();
    return {mine, underFlag, back: SHOW.level};
  });
  ok('an admin dropping the flag turns the layer off', flag.underFlag.level === 'off', flag);
  ok("...without overwriting the visitor's stored preference",
     flag.underFlag.stored === flag.mine, flag);
  ok('...and restoring it gives the visitor their level back',
     flag.back === flag.mine, flag);

  /* ---- 6. the app's own celebrations pull the new ones with them --- */
  const hooked = await p.evaluate(async () => {
    SHOW.set('showtime');
    await new Promise(r => setTimeout(r, 200));
    const before = SHOW.stats.alive;
    confetti();                                  /* the app's own, untouched */
    await new Promise(r => setTimeout(r, 200));
    return {before, after: SHOW.stats.alive,
            appConfetti: document.querySelectorAll('#fxLayer .fx-confetti, [class*=confetti]').length};
  });
  ok('the app\'s confetti() now fires the cannon too', hooked.after > hooked.before, hooked);

  /* ---- 7. the idle rally starts, and any input ends it -------------- */
  const idle = await p.evaluate(async () => {
    SHOW.rally();
    await new Promise(r => setTimeout(r, 400));
    const started = document.body.classList.contains('show-rally');
    window.dispatchEvent(new PointerEvent('pointermove', {clientX:10, clientY:10, bubbles:true}));
    await new Promise(r => setTimeout(r, 120));
    return {started, stopped: !document.body.classList.contains('show-rally')};
  });
  ok('the idle rally starts', idle.started, idle);
  ok('...and the first pointer move ends it', idle.stopped, idle);

  /* ---- 8. a ladder row is never given overflow:hidden --------------- */
  const rowSafe = await p.evaluate(async () => {
    const row = document.querySelector('.brow');
    if(!row) return {skip:true};
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new PointerEvent('pointerdown',
      {clientX:r.left + 10, clientY:r.top + 5, bubbles:true}));
    await new Promise(res => setTimeout(res, 120));
    return {ripples: row.querySelectorAll('.show-ripple').length, ovf: row.style.overflow};
  });
  if(!rowSafe.skip){
    ok('a ladder row is not a ripple target', rowSafe.ripples === 0, rowSafe);
    ok('...and is never clipped by one', !rowSafe.ovf, rowSafe);
  }

  /* ---- 9. the toast the module borrows actually exists -------------- */
  ok('the app exports its toast for the module to borrow',
     await p.evaluate(() => typeof window.toast === 'function'));

  /* ---- 10. THE REGRESSION. -----------------------------------------
     The foil used to be registered with the app's own FX_IDLE observer,
     which pauses animations — `animation-play-state:paused!important` —
     on the element AND every descendant. That is safe for the four
     decoration-only elements already on that list, and it was not safe
     here: a ladder row also carries `rowIn`, whose first frame is
     opacity:0 and clip-path:inset(0 0 100% 0). A podium row marked idle
     before it had played its entrance froze there — invisible, fully
     clipped, and still hit-testable.

     The assertion is comparative on purpose. Whether an off-screen row
     has run its entrance yet is the app's business and the browser's,
     and it genuinely differs by how far down the page the row is; what
     this file is answerable for is that putting a foil on a row changes
     none of it. So a foiled row is measured against a plain one beside
     it, and the two have to agree. */
  const frozen = await p.evaluate(async () => {
    const host = document.querySelector('.col-main section') || document.body;
    const far = document.createElement('div');
    far.style.marginTop = '400vh';               /* well past any idle margin */
    far.className = 'ladder';
    far.innerHTML =
      '<div class="brow g1" id="foilRow"><span>1</span><span>Foil</span></div>' +
      '<div class="brow"    id="bareRow"><span>9</span><span>Bare</span></div>';
    host.appendChild(far);
    SHOW.adopt();
    await new Promise(r => setTimeout(r, 1400));
    const read = id => {
      const el = document.getElementById(id), cs = getComputedStyle(el);
      return {idle: el.classList.contains('fx-idle'), play: cs.animationPlayState,
              opacity: cs.opacity, clip: cs.clipPath};
    };
    const out = {foil: read('foilRow'), bare: read('bareRow'),
                 foiled: document.getElementById('foilRow').classList.contains('show-holo')};
    far.remove();
    return out;
  });
  ok('an off-screen podium row still takes the foil', frozen.foiled, frozen);
  ok('...is never handed to the animation-pausing observer', !frozen.foil.idle, frozen);
  ok('...never has its animations paused', frozen.foil.play !== 'paused', frozen);
  ok('...and renders exactly as the same row without a foil does',
     frozen.foil.opacity === frozen.bare.opacity &&
     frozen.foil.clip === frozen.bare.clip &&
     frozen.foil.play === frozen.bare.play, frozen);

  /* ---- 11. the address-bar escape hatch ---------------------------- */
  await p.evaluate(() => { try{ localStorage.removeItem('fgta_showtime'); }catch(e){} });
  const hatch = await ctxNewPage(phone, url + '?fx=off');
  ok('?fx=off turns the layer off before it builds anything',
     hatch.level === 'off' && !hatch.canvas, hatch);
  ok('...and is remembered, so the next load is clean too',
     hatch.stored === 'off', hatch);
  const back = await ctxNewPage(phone, url + '?fx=on');
  ok('?fx=on gives it back', back.level !== 'off', back);

  await phone.close();

  /* ---- 12. reduced motion is the last word ------------------------- */
  const calm = await browser.newContext({viewport:{width:390,height:844}, reducedMotion:'reduce'});
  const q = await calm.newPage();
  q.on('pageerror', e => errs.push(e.message));
  await q.goto(url, {waitUntil:'domcontentloaded'});
  await q.waitForTimeout(2500);
  const rm = await q.evaluate(async () => {
    SHOW.set('ludicrous');                       /* asking loudly for it anyway */
    SHOW.fireworks(6); SHOW.cannon();
    await new Promise(r => setTimeout(r, 400));
    const c = document.getElementById('showFx');
    return {level: SHOW.level, alive: SHOW.stats.alive,
            canvas: c ? getComputedStyle(c).display : 'none',
            body: document.body.className};
  });
  ok('prefers-reduced-motion forces the level to off', rm.level === 'off', rm);
  ok('...and nothing is emitted even when asked directly', rm.alive === 0, rm);
  ok('...and the canvas is not painted', rm.canvas === 'none', rm);
  await calm.close();

  ok('no uncaught page errors', errs.length === 0, errs.slice(0, 5));

  await browser.close();
  server.close();
  console.log(fails ? '\n' + fails + ' failed' : '\nall good');
  process.exit(fails ? 1 : 0);
})();
