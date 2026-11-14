/* Guide cat: a fixed companion that jumps to a new pose after the scroll stops, leaving a fading trail of stars.
   Off by default under prefers-reduced-motion (a footer button turns it on). Never covers links, buttons or fields. */
(function () {
  'use strict';
  var EA = window.EA, $ = EA.$, $$ = EA.$$, clamp = EA.clamp, lerp = EA.lerp, rectOf = EA.rectOf, lvl = EA.lvl;
  var el = document.getElementById('guide');
  if (!(el && el.animate && 'IntersectionObserver' in window && document.elementsFromPoint)) return;

  var mqWide = window.matchMedia('(min-width: 1400px)');
  var btn = $('.guide-btn', el), menu = document.getElementById('guide-menu'), restore = document.getElementById('guide-restore');
  var statusEl = document.getElementById('guide-status'), trail = document.getElementById('trail');
  var toggles = $$('[data-guide-toggle]'), peekBody = $('.peek-body'), heroCat = $('.cat--hero');
  var heroSec = $('[data-guide="home"]'), footer = $('[data-guide-footer]');
  var BODY = { sit: 'sit', look: 'sit', reach: 'sit', point: 'sit', lie: 'lie', curl: 'curl', jump: 'jump' };
  var DOCK = { home: 'hero', look: 'l', reach: 'stage', lie: 'r', sit: 'r', point: 'r', curl: 'c' };
  var INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [tabindex], .svc-head';
  var TYPING = 'input:not([type="radio"]):not([type="checkbox"]), select, textarea';
  var pref = null; try { pref = window.sessionStorage.getItem('ea-guide'); } catch (err) { pref = null; }
  var enabled = false, cur = { pose: 'home', dock: 'hero', sec: heroSec };
  var candidate = heroSec, footerOn = false, flying = false, queued = false, timer = 0, anims = [], timers = [], suppressClick = false, sw = null;

  var gEye = { shape: $('.gc-lids', el), look: $('.gc-look', el), mx: 2.4, my: 1, x: 0, y: 0, tx: 0, ty: 0, guide: true, lockUntil: 0 };
  EA.eyes.push(gEye);

  /* star particle pool: never more than 30 nodes, never created or removed afterwards */
  var pool = [];
  for (var i = 0; i < 30; i++) { var pi = document.createElement('i'); trail.appendChild(pi); pool.push({ el: pi, busy: false, a: null }); }
  function particle(x, y, delay, dur, drift) {
    var slot = null;
    for (var j = 0; j < pool.length; j++) if (!pool[j].busy) { slot = pool[j]; break; }
    if (!slot) return;
    slot.busy = true;
    var jx = (Math.random() - 0.5) * 16, jy = 14 + Math.random() * 18, r = Math.random() * 90;
    var a = slot.el.animate([
      { transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(.3) rotate(0deg)', opacity: 0 },
      { transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(1) rotate(' + (r / 3).toFixed(0) + 'deg)', opacity: 1, offset: 0.12 },
      { transform: 'translate(' + (x + jx + drift.x).toFixed(1) + 'px,' + (y + jy + drift.y).toFixed(1) + 'px) scale(.15) rotate(' + r.toFixed(0) + 'deg)', opacity: 0 }
    ], { duration: dur, delay: delay, easing: 'cubic-bezier(.2,0,0,1)', fill: 'both' });
    slot.a = a;
    a.onfinish = function () { slot.busy = false; slot.a = null; a.cancel(); };
    a.oncancel = function () { slot.busy = false; slot.a = null; };
  }
  function clearTrail() { pool.forEach(function (s) { if (s.a) s.a.cancel(); s.busy = false; }); }

  function later(fn, t) { timers.push(window.setTimeout(fn, t)); }
  function clearAnims() {
    anims.forEach(function (a) { a.cancel(); }); anims = [];
    timers.forEach(window.clearTimeout); timers = [];
  }
  function isEl(d) { return d === 'hero' || d === 'stage'; }
  function elFor(d) { return d === 'hero' ? heroCat : peekBody; }
  function visibleFrac(node) {
    var r = node.getBoundingClientRect(), vh = window.innerHeight;
    if (!r.height) return 0;
    return Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) / r.height;
  }
  function resolve(sec) {
    var pose = sec.getAttribute('data-guide'), dock = DOCK[pose] || 'r';
    if (dock === 'stage' && !(peekBody && visibleFrac(peekBody) >= 0.6)) dock = 'r';
    if (dock === 'l' && !mqWide.matches) dock = 'r';
    return { pose: pose, dock: dock, sec: sec };
  }
  function visual(st) { return isEl(st.dock) ? rectOf(elFor(st.dock)) : rectOf(el); }
  function target(st) { return (st.sec && st.sec.querySelector('[data-guide-target]')) || st.sec; }
  function faceFor(st, anchor) {
    if (st.pose === 'curl' || !st.sec) return 'l';
    return rectOf(target(st)).x < anchor.x - 4 ? 'l' : 'r';
  }
  function setPose(pose, face) {
    el.setAttribute('data-pose', pose);
    el.setAttribute('data-body', BODY[pose] || 'sit');
    if (face) el.setAttribute('data-face', face);
  }
  function setAway(dock) {
    if (heroCat) heroCat.classList.toggle('is-away', enabled && dock !== 'hero');
    if (peekBody) peekBody.classList.toggle('is-away', enabled && dock !== 'stage');
  }
  function setDuck(on) { el.classList.toggle('is-ducked', on); }
  function lockGaze() { gEye.lockUntil = Date.now() + 2600; EA.request(); }
  function active() { return enabled && !el.hidden && !el.classList.contains('is-home'); }
  function tailEl() { return $('.gc-body--' + el.getAttribute('data-body') + ' .gc-tail', el); }

  /* never cover interactive content: step aside (duck) if anything clickable is under the cat */
  function duckCheck() {
    if (!enabled || isEl(cur.dock) || flying) { setDuck(false); return; }
    var r = el.getBoundingClientRect(), hit = false, pts = [[0.3, 0.45], [0.5, 0.3], [0.7, 0.6], [0.5, 0.85]];
    for (var k = 0; k < pts.length && !hit; k++) {
      var list = document.elementsFromPoint(r.left + r.width * pts[k][0], r.top + r.height * pts[k][1]);
      for (var n = 0; n < list.length; n++) {
        if (el.contains(list[n]) || list[n] === trail) continue;
        if (list[n].closest && list[n].closest(INTERACTIVE)) { hit = true; break; }
      }
    }
    setDuck(hit);
  }

  function settle(next) {
    setAway(next.dock);
    if (isEl(next.dock)) el.classList.add('is-home');
    else { el.classList.remove('is-home'); setPose(next.pose, faceFor(next, rectOf(el))); }
    lockGaze(); duckCheck();
  }
  function trailAlong(pt, pre, D, n) {
    for (var k = 1; k <= n; k++) {
      var u = k / (n + 1), P = pt(u), Q = pt(Math.max(0, u - 0.04));
      var tx = P.x - Q.x, ty = P.y - Q.y, tl = Math.sqrt(tx * tx + ty * ty) || 1;
      particle(P.x - tx / tl * 14 + (Math.random() - 0.5) * 10, P.y - ty / tl * 14 + 8 + (Math.random() - 0.5) * 10,
        pre + u * D, 760 + Math.random() * 380, { x: -tx / tl * 10, y: 0 });
    }
  }
  function move(next) {
    var prev = cur, level0 = lvl();
    setDuck(false); closeMenu(false); clearAnims();
    var p0 = visual(prev), toEl = isEl(next.dock), fromEl = isEl(prev.dock);
    if (!toEl) el.setAttribute('data-dock', next.dock);
    cur = next;
    if (level0 === 'static') { settle(next); return; }
    el.classList.remove('is-home');
    var anchor = rectOf(el), p1 = toEl ? visual(next) : anchor;
    var finalFace = toEl ? null : faceFor(next, anchor);
    var lite = level0 === 'lite', small = window.innerWidth < 768;
    var dx = p1.x - p0.x, dy = p1.y - p0.y, dist = Math.sqrt(dx * dx + dy * dy);
    var dir = dx > 4 ? 1 : (dx < -4 ? -1 : (finalFace === 'l' ? -1 : 1));
    var peak = dist < 8 ? (small ? 34 : 48) : clamp(dist * (small ? 0.3 : 0.35), small ? 50 : 70, small ? 140 : 220);
    var top = Math.min(p0.y, p1.y);
    if (top - peak < 24) peak = Math.max(0, top - 24);
    if (lite) peak *= 0.6;
    var cx = (p0.x + p1.x) / 2, cy = top - peak * 2;
    function pt(u) {
      var a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      return { x: a * p0.x + b * cx + c * p1.x, y: a * p0.y + b * cy + c * p1.y };
    }
    var D = lite ? 420 : (dist < 8 ? 460 : Math.round(560 + Math.min(240, dist * 0.25)));
    var pre = (lite || fromEl) ? 0 : 120;
    var s0 = fromEl ? p0.h / anchor.h : 1, s1 = toEl ? p1.h / anchor.h : 1;
    var N = lite ? 8 : 16, kf = [];
    for (var k = 0; k <= N; k++) {
      var t = k / N, P = pt(t), sm = t * t * (3 - 2 * t);
      var rot = lite ? 0 : dir * lerp(-14, 12, t) * (1 - t * t * t * t);
      var op = (fromEl && t < 0.15) ? t / 0.15 : ((toEl && t > 0.85) ? (1 - t) / 0.15 : 1);
      kf.push({ offset: t, opacity: op, transform: 'translate(' + (P.x - anchor.x).toFixed(1) + 'px,' + (P.y - anchor.y).toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg) scale(' + lerp(s0, s1, sm).toFixed(3) + ')' });
    }
    flying = true; el.classList.add('is-flying');
    if (fromEl) elFor(prev.dock).classList.add('is-away');
    if (pre) anims.push(btn.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(1.1,.84)', offset: 0.75 }, { transform: 'scale(.94,1.08)' }], { duration: pre, easing: 'ease-in' }));
    if (pre) later(function () { setPose('jump', dir > 0 ? 'r' : 'l'); }, pre); else setPose('jump', dir > 0 ? 'r' : 'l');
    var fl = el.animate(kf, { duration: D, delay: pre, easing: 'linear', fill: toEl ? 'both' : 'backwards' });
    anims.push(fl);
    if (toEl) later(function () { elFor(next.dock).classList.remove('is-away'); }, pre + D * 0.8);
    trailAlong(pt, pre, D, dist < 8 ? 6 : (lite ? 8 : (small ? 12 : 18)));
    fl.onfinish = function () {
      flying = false; el.classList.remove('is-flying');
      if (toEl) { el.classList.add('is-home'); fl.cancel(); setAway(next.dock); }
      else {
        setPose(next.pose, finalFace); setAway(next.dock);
        if (!lite) anims.push(btn.animate([{ transform: 'scale(1.1,.86)' }, { transform: 'scale(.97,1.04)', offset: 0.55 }, { transform: 'scale(1,1)' }], { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' }));
      }
      lockGaze(); duckCheck();
      if (queued) { queued = false; commit(); }
    };
  }
  /* debounce: jump only to the final section after scrolling settles */
  function commit() {
    timer = 0;
    if (!enabled) return;
    var sec = footerOn ? footer : candidate;
    if (!sec || sec.hidden) return;
    if (flying) { queued = true; return; }
    /* narrow screens: the form fills the width, so the cat waits below the screen edge while the booking section is in view */
    var park = window.innerWidth < 768 && sec.getAttribute('data-guide') === 'point';
    el.classList.toggle('is-parked', park);
    if (park) { setDuck(false); closeMenu(false); return; }
    var next = resolve(sec);
    if (next.pose === cur.pose && next.dock === cur.dock) { cur.sec = next.sec; duckCheck(); return; }
    move(next);
  }
  function schedule() { if (!enabled) return; window.clearTimeout(timer); timer = window.setTimeout(commit, 240); }

  var band = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) candidate = en.target; });
    schedule();
  }, { rootMargin: '-48% 0px -48% 0px' });
  $$('[data-guide]').forEach(function (s) { band.observe(s); });
  if (footer) new IntersectionObserver(function (en) { footerOn = en[0].intersectionRatio >= 0.5; schedule(); }, { threshold: [0, 0.5, 1] }).observe(footer);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });

  /* menu, reactions, hide */
  function openMenu() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  function closeMenu(focusBack) {
    if (menu.hidden) return;
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    if (focusBack) btn.focus();
  }
  function react() {
    if (!active() || lvl() === 'static' || el.classList.contains('is-parked')) return;
    EA.blink([$('.gc-lids', el)], 'squint');
    var r = rectOf(el);
    for (var k = 0; k < 6; k++) {
      var a = -Math.PI / 2 + (k - 2.5) * 0.45;
      particle(r.x + Math.cos(a) * r.w * 0.35, r.y - r.h * 0.1 + Math.sin(a) * r.h * 0.35, k * 40, 700, { x: Math.cos(a) * 14, y: -24 });
    }
    var w = EA.wag(tailEl(), 1); if (w) anims.push(w);
  }
  btn.addEventListener('click', function () {
    if (suppressClick) { suppressClick = false; return; }
    if (menu.hidden) { openMenu(); react(); } else closeMenu(false);
  });
  btn.addEventListener('pointerdown', function (e) { suppressClick = false; sw = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }; });
  btn.addEventListener('pointerup', function (e) {
    if (!sw) return;
    var dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
    if (dy > 36 && Math.abs(dx) < dy) { suppressClick = true; hide(true); }
  });
  btn.addEventListener('pointercancel', function () { sw = null; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) closeMenu(true); });
  document.addEventListener('click', function (e) { if (!menu.hidden && !el.contains(e.target)) closeMenu(false); });
  $('[data-guide-hide]', menu).addEventListener('click', function () { hide(true); });
  $('[data-guide-go]', menu).addEventListener('click', function () { closeMenu(false); });
  restore.addEventListener('click', function () { show(true); });
  toggles.forEach(function (b) { b.hidden = false; b.addEventListener('click', function () { if (enabled) hide(true); else show(true); }); });
  document.addEventListener('focusin', function (e) { el.classList.toggle('is-typing', !!(e.target.matches && e.target.matches(TYPING))); });
  document.addEventListener('focusout', function () {
    window.setTimeout(function () { var a = document.activeElement; if (!a || !a.matches || !a.matches(TYPING)) el.classList.remove('is-typing'); }, 0);
  });

  function say(msg) { statusEl.textContent = ''; if (msg) window.setTimeout(function () { statusEl.textContent = msg; }, 60); }
  function syncToggles() { toggles.forEach(function (b) { b.textContent = enabled ? 'Спрятать кошку-проводника' : 'Показать кошку-проводника'; }); }
  function stop() {
    clearAnims(); clearTrail(); window.clearTimeout(timer);
    flying = false; queued = false;
    el.classList.remove('is-flying', 'is-ducked', 'is-parked');
  }
  function remember(v) { pref = v; try { window.sessionStorage.setItem('ea-guide', v); } catch (err) { pref = v; } }
  function hide(byUser) {
    var hadFocus = el.contains(document.activeElement);
    stop(); closeMenu(false);
    enabled = false;
    if (byUser) remember('off');
    el.hidden = true;
    if (heroCat) heroCat.classList.remove('is-away');
    if (peekBody) peekBody.classList.remove('is-away');
    restore.hidden = !byUser;
    if (hadFocus) restore.focus();
    say(byUser ? 'Кошка спряталась. Вернуть её можно кнопкой с лапкой в правом нижнем углу или в подвале.' : '');
    syncToggles();
  }
  function show(byUser) {
    if (byUser) remember('on');
    enabled = true; el.hidden = false; restore.hidden = true;
    cur = { pose: 'home', dock: 'hero', sec: heroSec };
    el.classList.add('is-home'); setAway('hero');
    syncToggles();
    if (byUser) say('Кошка-проводник вернулась.');
    commit();
  }
  restore.hidden = pref !== 'off';
  /* narrow screens: the restore button would cover the full-width submit button, so it waits while the form is in view */
  var bookingBox = document.getElementById('booking');
  if (bookingBox) new IntersectionObserver(function (en) { restore.classList.toggle('is-parked', en[0].isIntersecting); }).observe(bookingBox);
  syncToggles();

  EA.G = {
    active: active,
    flipped: function () { return el.getAttribute('data-face') === 'l'; },
    lookPoint: function () {
      if (!active() || cur.pose === 'curl') return null;
      var r = target(cur).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: clamp(r.top + r.height / 2, 0, window.innerHeight) };
    },
    idle: function () {
      if (!active() || lvl() === 'static' || flying) return;
      if (cur.pose === 'curl') { var w0 = EA.wag(tailEl(), 1); if (w0) anims.push(w0); return; }
      EA.blink([$('.gc-lids', el)], (cur.pose === 'point' || cur.pose === 'lie') ? 'slow' : '');
      if (cur.pose === 'reach') {
        anims.push($('.gc-leg', el).animate([{ transform: 'rotate(-140deg)' }, { transform: 'rotate(-122deg)', offset: 0.3 }, { transform: 'rotate(-146deg)', offset: 0.6 }, { transform: 'rotate(-140deg)' }], { duration: 1200, easing: 'ease-in-out' }));
      } else {
        later(function () { var w1 = EA.wag(tailEl(), 2); if (w1) anims.push(w1); }, 500);
      }
    },
    swipe: function () {
      if (!active() || isEl(cur.dock)) return false;
      if (lvl() !== 'static' && el.getAttribute('data-body') === 'sit') {
        anims.push($('.gc-leg', el).animate([{ transform: 'rotate(-140deg)' }, { transform: 'rotate(-170deg)', offset: 0.35 }, { transform: 'rotate(-110deg)', offset: 0.7 }, { transform: 'rotate(-140deg)' }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' }));
      }
      return true;
    },
    react: react,
    schedule: schedule,
    onLevel: function () {
      var wantOn = pref === 'on' || (pref !== 'off' && !EA.reduce.matches);
      if (!wantOn && enabled) { hide(false); return; }
      if (wantOn && !enabled) { show(false); return; }
      if (enabled && lvl() === 'static') { stop(); settle(cur); }
    }
  };
  EA.applyLevel();
}());
