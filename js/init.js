/* Runs in <head> before first paint: sets the "js" class and the motion level (full | lite | static). */
(function () {
  'use strict';
  var root = document.documentElement;
  var forced = new URLSearchParams(location.search).get('motion');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Level from the environment; ?motion= overrides it for QA. */
  function baseLevel() {
    if (forced === 'full' || forced === 'lite' || forced === 'static') return forced;
    if (reduce.matches) return 'static';
    var c = navigator.connection;
    if ((c && (c.saveData || /2g|3g/.test(c.effectiveType || ''))) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)) return 'lite';
    return 'full';
  }

  window.EA = {
    reduce: reduce,
    baseLevel: baseLevel,
    $: function (s, c) { return (c || document).querySelector(s); },
    $$: function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); },
    clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); }
  };
  root.classList.add('js', 'motion-' + baseLevel());
})();
