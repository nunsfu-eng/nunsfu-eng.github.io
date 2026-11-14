/* Cats and ambience: eyes that follow the pointer, blink and tail series, gold dust, motion level switching.
   One rAF loop for the whole page; it stops as soon as everything has settled. */
(function () {
  'use strict';
  var EA = window.EA, root = document.documentElement, $ = EA.$, $$ = EA.$$;
  var mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var mqCoarse = window.matchMedia('(pointer: coarse)');
  var paused = false, pointer = null, raf = 0, backTimer = 0, gazeLock = 0;

  function lvl() { return root.classList.contains('motion-static') ? 'static' : (root.classList.contains('motion-lite') ? 'lite' : 'full'); }
  function rectOf(node) { var r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }

  /* Guide API placeholder: guide.js replaces it when the browser supports what it needs. */
  EA.G = {
    active: function () { return false; }, flipped: function () { return false; }, lookPoint: function () { return null; },
    idle: function () {}, swipe: function () { return false; }, react: function () {}, onLevel: function () {}, schedule: function () {}
  };
  EA.lvl = lvl;
  EA.rectOf = rectOf;
  EA.lerp = function (a, b, t) { return a + (b - a) * t; };

  /* ---- eyes and parallax layers ---- */
  var eyes = $$('[data-eye]').map(function (g) {
    return { shape: g.querySelector('.cat-eye-shape'), look: g.querySelector('.cat-look'), mx: 8, my: 6, x: 0, y: 0, tx: 0, ty: 0, guide: false };
  });
  EA.eyes = eyes;
  var layers = $$('[data-para]').map(function (el) { return { el: el, d: parseFloat(el.getAttribute('data-para')) || 0.5, x: 0, y: 0, tx: 0, ty: 0 }; });

  function aim(e, px, py) {
    var r = e.shape.getBoundingClientRect();
    if (!r.width) { e.tx = 0; e.ty = 0; return; }
    var dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
    var d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(d / 180, 1);
    e.tx = dx / d * k * e.mx; e.ty = dy / d * k * e.my;
  }
  function targets() {
    var vw = window.innerWidth || 1, vh = window.innerHeight || 1, G = EA.G;
    eyes.forEach(function (e) {
      if (e.guide) {
        if (!G.active()) { e.tx = 0; e.ty = 0; return; }
        var t = (!pointer || Date.now() < e.lockUntil) ? G.lookPoint() : pointer;
        if (!t) { e.tx = 0; e.ty = 0; return; }
        aim(e, t.x, t.y);
        if (G.flipped()) e.tx = -e.tx;
        return;
      }
      if (!pointer) { e.tx = 0; e.ty = 0; return; }
      aim(e, pointer.x, pointer.y);
    });
    var para = !!pointer && mqFine.matches && lvl() === 'full';
    layers.forEach(function (l) {
      l.tx = para ? (pointer.x / vw - 0.5) * 2 * l.d * 14 : 0;
      l.ty = para ? (pointer.y / vh - 0.5) * 2 * l.d * 10 : 0;
    });
  }
  function step(o, snap) {
    if (snap) { o.x = o.tx; o.y = o.ty; return false; }
    o.x += (o.tx - o.x) * 0.18; o.y += (o.ty - o.y) * 0.18;
    if (Math.abs(o.tx - o.x) < 0.05 && Math.abs(o.ty - o.y) < 0.05) { o.x = o.tx; o.y = o.ty; return false; }
    return true;
  }
  function frame() {
    raf = 0;
    if (lvl() === 'static') return;
    targets();
    var lite = lvl() === 'lite', more = false;
    eyes.forEach(function (e) {
      if (step(e, lite)) more = true;
      e.look.style.transform = 'translate(' + e.x.toFixed(2) + 'px,' + e.y.toFixed(2) + 'px)';
    });
    layers.forEach(function (l) {
      if (step(l, false)) more = true;
      l.el.style.transform = 'translate3d(' + l.x.toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0)';
    });
    if (more) request();
  }
  function request() { if (!raf && lvl() !== 'static') raf = window.requestAnimationFrame(frame); }
  EA.request = request;

  window.addEventListener('pointermove', function (ev) {
    if (ev.pointerType !== 'mouse' || Date.now() < gazeLock) return;
    pointer = { x: ev.clientX, y: ev.clientY }; request();
  }, { passive: true });
  root.addEventListener('mouseleave', function () { pointer = null; request(); });
  window.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'mouse') return;
    pointer = { x: ev.clientX, y: ev.clientY }; request();
    window.clearTimeout(backTimer);
    backTimer = window.setTimeout(function () { pointer = null; request(); }, 1800);
  }, { passive: true });
  window.addEventListener('scroll', function () { if (pointer || EA.G.active()) request(); }, { passive: true });

  EA.lookAt = function (el, dur) {
    var r = el.getBoundingClientRect();
    pointer = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    gazeLock = Date.now() + dur;
    window.clearTimeout(backTimer);
    backTimer = window.setTimeout(function () { pointer = null; request(); }, dur);
    request();
  };
  $$('[data-look]').forEach(function (el) { el.addEventListener('focus', function () { EA.lookAt(el, 1500); }); });

  /* ---- blink and tail: short series, each under 5 s (WCAG 2.2.2) ---- */
  EA.blink = function (groups, kind) {
    if (lvl() === 'static') return;
    var slow = kind === 'slow', squint = kind === 'squint', low = squint ? 'scaleY(0.45)' : 'scaleY(0.06)';
    groups.forEach(function (g) {
      if (!g || !g.animate) return;
      g.animate([
        { transform: 'scaleY(1)' },
        { transform: low, offset: (slow || squint) ? 0.3 : 0.45 },
        { transform: low, offset: (slow || squint) ? 0.7 : 0.55 },
        { transform: 'scaleY(1)' }
      ], { duration: slow ? 1100 : (squint ? 900 : 220), easing: 'ease-in-out' });
    });
  };
  EA.wag = function (tail, times) {
    if (lvl() === 'static' || !tail || !tail.animate) return null;
    return tail.animate([
      { transform: 'rotate(0deg)' }, { transform: 'rotate(6deg)', offset: 0.3 },
      { transform: 'rotate(-3deg)', offset: 0.7 }, { transform: 'rotate(0deg)' }
    ], { duration: lvl() === 'lite' ? 1100 : 1400, iterations: times, easing: 'ease-in-out' });
  };
  var heroCat = $('.cat--hero');
  function visibleBlinkers() {
    return $$('[data-blink]').filter(function (g) { return !g.closest('.is-away, .is-home, [hidden]'); });
  }
  function series() {
    if (lvl() !== 'static' && !document.hidden) {
      EA.blink(visibleBlinkers());
      if (heroCat && !heroCat.classList.contains('is-away')) window.setTimeout(function () { EA.wag($('.cat--hero .cat-tail'), 2); }, 400);
      window.setTimeout(function () { EA.G.idle(); }, 900);
    }
    window.setTimeout(series, 7000 + Math.random() * 6000);
  }
  window.setTimeout(series, 1200);
  if (heroCat) heroCat.addEventListener('click', function () { EA.blink(visibleBlinkers(), 'squint'); EA.wag($('.cat--hero .cat-tail'), 2); });
  $$('[data-slow-blink]').forEach(function (el) {
    ['mouseenter', 'focus'].forEach(function (t) { el.addEventListener(t, function () { EA.blink(visibleBlinkers(), 'slow'); }); });
  });

  /* ---- gold dust ---- */
  $$('[data-dust]').forEach(function (box) {
    var n = parseInt(box.getAttribute('data-dust'), 10) || 30;
    if (mqCoarse.matches) n = Math.round(n * 0.45);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i'), sz = (1 + Math.random() * 2.4).toFixed(1) + 'px';
      p.style.left = (Math.random() * 100).toFixed(2) + '%';
      p.style.top = (Math.random() * 100).toFixed(2) + '%';
      p.style.width = sz; p.style.height = sz;
      p.style.animationDuration = (5 + Math.random() * 6).toFixed(1) + 's';
      p.style.animationDelay = (-Math.random() * 10).toFixed(1) + 's';
      frag.appendChild(p);
    }
    box.appendChild(frag);
  });

  /* ---- motion level: reduced motion, ?motion=, and the "stop animation" button ---- */
  function stopAll() {
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) {
        var t = a.effect && a.effect.target;
        if (t && t.closest && t.closest('svg, .hang-slot') && !(window.CSSAnimation && a instanceof window.CSSAnimation)) a.cancel();
      });
    }
    eyes.forEach(function (e) { e.x = e.y = e.tx = e.ty = 0; e.look.style.transform = ''; });
    layers.forEach(function (l) { l.x = l.y = l.tx = l.ty = 0; l.el.style.transform = ''; });
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
  }
  EA.applyLevel = function () {
    var l = paused ? 'static' : EA.baseLevel();
    root.classList.remove('motion-full', 'motion-lite', 'motion-static');
    root.classList.add('motion-' + l);
    $$('[data-pause]').forEach(function (b) {
      b.hidden = !paused && EA.baseLevel() === 'static';
      b.textContent = paused ? 'Включить анимацию' : 'Остановить анимацию';
    });
    if (l === 'static') stopAll(); else request();
    EA.G.onLevel();
  };
  $$('[data-pause]').forEach(function (b) { b.addEventListener('click', function () { paused = !paused; EA.applyLevel(); }); });
  if (EA.reduce.addEventListener) EA.reduce.addEventListener('change', EA.applyLevel);
  EA.applyLevel();
}());
