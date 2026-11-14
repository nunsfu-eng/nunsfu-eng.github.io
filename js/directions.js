/* Two directions: the cat pulls the chosen card off its thread and the matching price list opens.
   Without this script both lists stay open (all prices are in the HTML). */
(function () {
  'use strict';
  var EA = window.EA, $ = EA.$, $$ = EA.$$;
  var dirBtns = $$('[data-dir]');
  if (!dirBtns.length) return;
  var dirStatus = document.getElementById('dir-status');
  var stage = $('[data-stage]');

  /* pause the hanging cards while the stage is off screen */
  if (stage && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (list) {
      list.forEach(function (en) { en.target.classList.toggle('is-off', !en.isIntersecting); });
    }).observe(stage);
  }

  function burst(btn) {
    var host = btn.closest('.hang-slot');
    if (!host || !host.animate) return;
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('i');
      s.className = 'spark';
      host.appendChild(s);
      var a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 70;
      var an = s.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + (Math.cos(a) * r).toFixed(1) + 'px,' + (Math.sin(a) * r).toFixed(1) + 'px) scale(.3)', opacity: 0 }
      ], { duration: 900 + Math.random() * 500, delay: 300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
      an.onfinish = (function (el) { return function () { el.remove(); }; })(s);
    }
  }

  function choose(btn, animate) {
    var was = btn.getAttribute('aria-expanded') === 'true';
    dirBtns.forEach(function (b) {
      var on = b === btn, p = document.getElementById(b.getAttribute('aria-controls')), slot = b.closest('.hang-slot');
      b.setAttribute('aria-expanded', String(on));
      if (slot) slot.classList.toggle('is-pulled', on);
      if (p) { p.hidden = !on; p.classList.toggle('is-revealed', on && !was && animate); }
    });
    if (dirStatus && !was) dirStatus.textContent = 'Открыт список услуг: ' + btn.getAttribute('data-label') + '. Он ниже карт.';
    EA.G.schedule();
    if (was || !animate || EA.lvl() === 'static') return;
    if (!EA.G.swipe()) {
      var side = btn.getAttribute('data-side');
      var paw = stage ? stage.querySelector('.cat-paw-' + side) : null;
      var turn = side === 'l' ? 16 : -16;
      if (paw && paw.animate) {
        paw.animate([
          { transform: 'none' },
          { transform: 'translateY(-26px) rotate(' + turn + 'deg)', offset: 0.4 },
          { transform: 'translateY(4px) rotate(' + (-turn / 4) + 'deg)', offset: 0.75 },
          { transform: 'none' }
        ], { duration: EA.lvl() === 'lite' ? 500 : 900, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    }
    EA.lookAt(btn, 1600);
    if (EA.lvl() === 'full') burst(btn);
  }

  /* after the script is ready, collapse both lists until a card is chosen */
  dirBtns.forEach(function (b) {
    var p = document.getElementById(b.getAttribute('aria-controls'));
    if (p) p.hidden = true;
    b.disabled = false;
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () { choose(b, true); });
  });

  function openFor(id, animate) {
    var b = $('[data-dir][aria-controls="' + id + '"]');
    if (b && b.getAttribute('aria-expanded') !== 'true') choose(b, animate);
  }
  $$('a[href="#astrology"], a[href="#symbolon"]').forEach(function (a) {
    a.addEventListener('click', function () { openFor(a.getAttribute('href').slice(1), false); });
  });
  var hash = location.hash.slice(1);
  if (hash === 'astrology' || hash === 'symbolon') {
    openFor(hash, false);
    window.requestAnimationFrame(function () { document.getElementById(hash).scrollIntoView(); });
  }
}());
