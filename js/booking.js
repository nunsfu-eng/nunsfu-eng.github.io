/* Booking without a server: service -> date -> time -> format -> name, then a Telegram link with the request text.
   Pure helpers live in EA.booking (also used by tests/booking.test.html); the form wiring runs only when the form exists.
   User input only goes through encodeURIComponent and textContent, never innerHTML. */
(function () {
  'use strict';
  var EA = window.EA = window.EA || {};
  var fmtCache = {};

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(s) { var p = String(s).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }

  /* Calendar fields of an instant in a given IANA zone. */
  function partsInTz(tz, date) {
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }));
    var o = {};
    f.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10); });
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  /* Zone offset from UTC in minutes at an instant (read from Intl, never hard-coded). */
  function offsetMin(tz, date) {
    var t = Math.floor(date.getTime() / 60000) * 60000, p = partsInTz(tz, new Date(t));
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t) / 60000);
  }
  /* UTC ms of a wall-clock moment (y, m, d, minutes from midnight) in the zone; two passes handle offset changes. */
  function slotUtc(tz, y, m, d, min) {
    var wall = Date.UTC(y, m - 1, d, 0, min);
    var first = wall - offsetMin(tz, new Date(wall)) * 60000;
    return wall - offsetMin(tz, new Date(first)) * 60000;
  }
  /* Settings come from data-* attributes of #booking-form (ds = form.dataset or a plain object). */
  function parseConfig(ds) {
    var lead = parseInt(ds.minLead, 10);
    return {
      tz: ds.tz || 'Asia/Yekaterinburg',
      tzLabel: ds.tzLabel || 'МСК+2',
      user: /^[A-Za-z0-9_]{5,32}$/.test(ds.telegram || '') ? ds.telegram : 'yourfreckle',
      days: (ds.days || '1,2,3,4,5,6,7').split(',').map(Number),
      open: hm(ds.open || '10:00'),
      close: hm(ds.close || '17:00'),
      step: parseInt(ds.step, 10) || 60,
      lead: isNaN(lead) ? 60 : lead,
      horizon: parseInt(ds.horizon, 10) || 30,
      closed: (ds.closed || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };
  }
  /* Days of the booking horizon, counted from "today" in the zone. A slot is available when it starts no earlier
     than now + lead, the weekday is a working one and the date is not closed. */
  function buildDays(cfg, now) {
    var base = partsInTz(cfg.tz, now), out = [];
    for (var i = 0; i < cfg.horizon; i++) {
      var u = new Date(Date.UTC(base.year, base.month - 1, base.day + i));
      var day = { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate(), u: u, wd: (u.getUTCDay() + 6) % 7 + 1, today: i === 0, slots: [] };
      day.iso = day.y + '-' + pad(day.m) + '-' + pad(day.d);
      var open = cfg.days.indexOf(day.wd) !== -1 && cfg.closed.indexOf(day.iso) === -1;
      for (var t = cfg.open; t + cfg.step <= cfg.close; t += cfg.step) {
        var utc = slotUtc(cfg.tz, day.y, day.m, day.d, t);
        day.slots.push({ label: pad(Math.floor(t / 60)) + ':' + pad(t % 60), utc: utc, ok: open && utc >= now.getTime() + cfg.lead * 60000 });
      }
      day.ok = day.slots.some(function (s) { return s.ok; });
      out.push(day);
    }
    return out;
  }
  /* ?now=2026-11-13T15:30+05:00 for QA; a "+" turned into a space by the URL is restored. */
  function parseNow(str) {
    if (!str) return new Date();
    var t = new Date(String(str).replace(' ', '+'));
    return isNaN(t.getTime()) ? new Date() : t;
  }
  function priceText(price) {
    return price ? new Intl.NumberFormat('ru-RU').format(+price).replace(/ | /g, ' ') + ' ₽' : '';
  }
  function requestText(r) {
    var lines = [
      'Здравствуйте, Евгения! Хочу записаться на консультацию.',
      'Услуга: ' + r.service + ' — ' + (r.price ? priceText(r.price) : 'цена по договорённости'),
      'Дата: ' + r.dateLong,
      'Время: ' + r.time + ' (' + r.tzLabel + ', Екатеринбург) — желаемое',
      'Формат: ' + r.format,
      'Имя: ' + r.name.trim()
    ];
    if (r.comment && r.comment.trim()) lines.push('Комментарий: ' + r.comment.trim());
    lines.push('(Заявка с сайта nunsfu-eng.github.io)');
    return lines.join('\n');
  }
  function telegramUrl(user, text) { return 'https://t.me/' + user + '?text=' + encodeURIComponent(text); }
  function tgSchemeUrl(user, text) { return 'tg://resolve?domain=' + user + '&text=' + encodeURIComponent(text); }
  /* Keys of the required fields that are still empty, in form order. */
  function missing(v) {
    var bad = [];
    if (!v.service) bad.push('service');
    if (!v.date) bad.push('date');
    if (!v.time) bad.push('time');
    if (!v.format) bad.push('format');
    if (!v.name || !v.name.trim()) bad.push('name');
    return bad;
  }

  EA.booking = {
    pad: pad, hm: hm, partsInTz: partsInTz, offsetMin: offsetMin, slotUtc: slotUtc, parseConfig: parseConfig, buildDays: buildDays,
    parseNow: parseNow, priceText: priceText, requestText: requestText, telegramUrl: telegramUrl, tgSchemeUrl: tgSchemeUrl, missing: missing,
    open: function (url) {
      /* desktop: a new tab keeps the "request is ready" panel on this page; phones switch to the app in the same tab */
      if (window.matchMedia('(pointer: coarse)').matches) { window.location.href = url; return; }
      var a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }
  };

  var form = document.getElementById('booking-form');
  if (form) initForm(form);

  function initForm(form) {
    var $ = EA.$, $$ = EA.$$, B = EA.booking, cfg = parseConfig(form.dataset);
    var qNow = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? new URLSearchParams(location.search).get('now') : null;
    var fLong = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    var fLongY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    var fMonth = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
    var fLocalTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
    var fLocalDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
    var fLocalIso = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });

    var nojs = $('.nojs-only', form); if (nojs) nojs.remove();
    var rich = $('.booking-rich', form); rich.disabled = false;
    form.noValidate = true;
    var sel = $('#f-service', form), nameIn = $('#f-name', form), comment = $('#f-comment', form), counter = $('#comment-count', form);
    var calMonths = $('#cal-months', form), calTitle = $('#cal-title', form), prevBtn = $('#cal-prev', form), nextBtn = $('#cal-next', form);
    var slotsBox = $('#slots', form), tzHint = $('#tz-hint', form), choiceEl = $('#choice', form), errBox = $('#form-errors', form);
    var submitBtn = $('#booking-submit', form), submitLabel = $('.cta-label', submitBtn);
    var result = $('#result', form), resText = $('#result-text', form), resStatus = $('#result-status', form);
    var copyBtn = $('#copy-again', form), tgApp = $('#tg-app', form), editBtn = $('#edit-request', form);
    var days = [], months = [], monthIdx = 0, selIso = null, selTime = null, nowRef = new Date(), diff = 0, submitted = false, busy = false;
    var smooth = function () { return EA.lvl && EA.lvl() === 'static' ? 'auto' : 'smooth'; };

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    function find(iso) { for (var i = 0; i < days.length; i++) if (days[i].iso === iso) return days[i]; return null; }
    function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function serviceItem(id) { return $('li[data-service="' + id + '"]'); }

    /* services come from the HTML catalogue (single source of truth) */
    [['astrology', 'Астрология'], ['symbolon', 'Симболон-карты']].forEach(function (g) {
      var og = document.createElement('optgroup'); og.label = g[1];
      $$('li[data-service][data-group="' + g[0] + '"]').forEach(function (li) {
        var o = document.createElement('option');
        o.value = li.getAttribute('data-service');
        var pr = B.priceText(li.getAttribute('data-price')), nm = li.getAttribute('data-name');
        o.textContent = pr ? pr + ' — ' + nm : nm + ' — цена уточняется';
        og.appendChild(o);
      });
      sel.appendChild(og);
    });

    function monthEl(mo) {
      var wrap = el('div', 'cal-month'), grid = el('div', 'cal-grid');
      wrap.hidden = true;
      ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(function (w) { var s = el('span', 'cal-wd', w); s.setAttribute('aria-hidden', 'true'); grid.appendChild(s); });
      var lead = (new Date(Date.UTC(mo.y, mo.m - 1, 1)).getUTCDay() + 6) % 7, dim = new Date(Date.UTC(mo.y, mo.m, 0)).getUTCDate();
      for (var i = 0; i < lead; i++) { var e = el('span'); e.setAttribute('aria-hidden', 'true'); grid.appendChild(e); }
      for (var d = 1; d <= dim; d++) {
        var iso = mo.y + '-' + pad(mo.m) + '-' + pad(d), day = find(iso);
        if (!day) { var o = el('span', 'day-out', d); o.setAttribute('aria-hidden', 'true'); grid.appendChild(o); continue; }
        var lab = el('label', 'day' + (day.today ? ' is-today' : ''));
        var inp = el('input', 'vh-in'); inp.type = 'radio'; inp.name = 'date'; inp.value = iso; inp.disabled = !day.ok;
        if (day.ok && iso === selIso) inp.checked = true;
        var face = el('span', 'day-face', d); face.setAttribute('aria-hidden', 'true');
        lab.appendChild(inp); lab.appendChild(face);
        lab.appendChild(el('span', 'vh', fLong.format(day.u) + (day.today ? ', сегодня' : '') + (day.ok ? '' : ', записи нет')));
        grid.appendChild(lab);
      }
      wrap.appendChild(grid);
      return wrap;
    }
    function showMonth(i) {
      monthIdx = EA.clamp(i, 0, months.length - 1);
      months.forEach(function (mo, j) { mo.el.hidden = j !== monthIdx; });
      var mo = months[monthIdx];
      calTitle.textContent = cap(fMonth.format(Date.UTC(mo.y, mo.m - 1, 1))) + ' ' + mo.y;
      prevBtn.disabled = monthIdx === 0;
      nextBtn.disabled = monthIdx === months.length - 1;
    }
    function localLabel(s, day) {
      if (!diff) return '';
      var dt = new Date(s.utc), t = fLocalTime.format(dt);
      if (fLocalIso.format(dt) !== day.iso) t += ', ' + fLocalDay.format(dt);
      return t;
    }
    function fmtDiff(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + ' ч' : '') + (h && r ? ' ' : '') + (r ? r + ' мин' : ''); }

    function render() {
      var hadDay = selIso, hadTime = selTime;
      nowRef = parseNow(qNow);
      days = buildDays(cfg, nowRef);
      diff = -nowRef.getTimezoneOffset() - offsetMin(cfg.tz, nowRef);
      var sd = selIso && find(selIso);
      if (!sd || !sd.ok) selIso = null;
      calMonths.textContent = '';
      months = [];
      days.forEach(function (d) { var k = d.y + '-' + d.m; if (!months.length || months[months.length - 1].key !== k) months.push({ key: k, y: d.y, m: d.m }); });
      months.forEach(function (mo) { mo.el = monthEl(mo); calMonths.appendChild(mo.el); });
      var focusDay = (selIso && find(selIso)) || days.filter(function (d) { return d.ok; })[0] || days[0];
      showMonth(months.map(function (m) { return m.key; }).indexOf(focusDay.y + '-' + focusDay.m));
      tzHint.textContent = diff === 0
        ? 'Время указано по ' + cfg.tzLabel + ' (Екатеринбург), как и у вас.'
        : 'Время указано по ' + cfg.tzLabel + ' (Екатеринбург). У вас на ' + fmtDiff(Math.abs(diff)) + (diff < 0 ? ' меньше' : ' больше') + ' — под каждым слотом показано ваше время.';
      renderSlots();
      if (!days.some(function (d) { return d.ok; })) {
        slotsBox.textContent = '';
        var p = el('p', 'empty', 'В ближайшие ' + cfg.horizon + ' дней свободного времени нет. Напишите Евгении в Telegram: ');
        var a = el('a', null, '@' + cfg.user); a.href = 'https://t.me/' + cfg.user; p.appendChild(a);
        slotsBox.appendChild(p);
      }
      if ((hadDay && !selIso) || (hadTime && !selTime)) choiceEl.textContent = 'Выбранное время уже прошло — выберите другое.';
      else updateChoice();
    }
    function renderSlots() {
      slotsBox.textContent = '';
      var day = selIso && find(selIso);
      if (!day) {
        selTime = null;
        var first = days[0].slots[0], last = days[0].slots[days[0].slots.length - 1];
        slotsBox.appendChild(el('p', 'empty', 'Сначала выберите дату — здесь появится время с ' + first.label + ' до ' + last.label + '.'));
        return;
      }
      var grid = el('div', 'chips chips--slots'), keep = false;
      day.slots.forEach(function (s) {
        var lab = el('label', 'chip'), inp = el('input', 'vh-in');
        inp.type = 'radio'; inp.name = 'time'; inp.value = s.label; inp.disabled = !s.ok;
        if (s.ok && selTime === s.label) { inp.checked = true; keep = true; }
        var face = el('span', 'chip-face', s.label), local = localLabel(s, day);
        face.setAttribute('aria-hidden', 'true');
        if (local) face.appendChild(el('small', null, local + ' у вас'));
        lab.appendChild(inp); lab.appendChild(face);
        lab.appendChild(el('span', 'vh', s.label + ' ' + cfg.tzLabel + (local ? ', у вас ' + local : '') + (s.ok ? '' : ', недоступно')));
        grid.appendChild(lab);
      });
      if (!keep) selTime = null;
      slotsBox.appendChild(grid);
    }
    function updateChoice() {
      var day = selIso && find(selIso);
      if (!day || !selTime) { choiceEl.textContent = ''; return; }
      var s = day.slots.filter(function (x) { return x.label === selTime; })[0], local = s ? localLabel(s, day) : '';
      choiceEl.textContent = 'Вы выбрали: ' + fLong.format(day.u) + ', ' + selTime + ' ' + cfg.tzLabel + (local ? ' (у вас ' + local + ')' : '') + '.';
    }

    prevBtn.addEventListener('click', function () { showMonth(monthIdx - 1); });
    nextBtn.addEventListener('click', function () { showMonth(monthIdx + 1); });
    calMonths.addEventListener('change', function (e) {
      if (e.target.name !== 'date') return;
      selIso = e.target.value;
      var mo = e.target.closest('.cal-month');
      if (mo && mo.hidden) showMonth(months.map(function (m) { return m.el; }).indexOf(mo));
      clearErr('date'); renderSlots(); updateChoice();
      if (submitted && !selTime) setErr('time');
    });
    slotsBox.addEventListener('change', function (e) {
      if (e.target.name !== 'time') return;
      selTime = e.target.value; clearErr('time'); updateChoice();
    });
    sel.addEventListener('change', function () { if (sel.value) clearErr('service'); });
    $$('input[name="format"]', form).forEach(function (r) { r.addEventListener('change', function () { clearErr('format'); }); });
    nameIn.addEventListener('input', function () { if (nameIn.value.trim()) clearErr('name'); });
    nameIn.addEventListener('blur', function () { if (submitted && !nameIn.value.trim()) setErr('name'); });
    comment.addEventListener('input', function () { counter.textContent = comment.value.length + ' из 300 символов'; });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });

    /* "Записаться" next to a service: preselect it and go to the form */
    $$('[data-book]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        sel.value = a.getAttribute('data-book');
        clearErr('service');
        $('#booking').scrollIntoView({ behavior: smooth(), block: 'start' });
        sel.focus({ preventScroll: true });
      });
    });

    var FIELDS = {
      service: { box: '#field-service', msg: 'Выберите услугу из списка.', label: 'услугу' },
      date: { box: '#field-date', msg: 'Выберите дату в календаре.', label: 'дату' },
      time: { box: '#field-time', msg: 'Выберите время.', label: 'время' },
      format: { box: '#field-format', msg: 'Выберите формат: созвон, голосовые или текст.', label: 'формат' },
      name: { box: '#field-name', msg: 'Напишите, как к вам обращаться.', label: 'имя' }
    };
    function setErr(k) {
      var e = $('#err-' + k, form);
      e.textContent = k === 'time' && !selIso ? 'Сначала выберите дату, затем время.' : FIELDS[k].msg;
      e.hidden = false;
      $(FIELDS[k].box, form).classList.add('is-invalid');
      if (k === 'service') sel.setAttribute('aria-invalid', 'true');
      if (k === 'name') nameIn.setAttribute('aria-invalid', 'true');
    }
    function clearErr(k) {
      var e = $('#err-' + k, form);
      e.hidden = true; e.textContent = '';
      $(FIELDS[k].box, form).classList.remove('is-invalid');
      if (k === 'service') sel.removeAttribute('aria-invalid');
      if (k === 'name') nameIn.removeAttribute('aria-invalid');
      if (!$('.field-error:not([hidden])', form)) errBox.hidden = true;
    }
    function fmtVal() { var c = $('input[name="format"]:checked', form); return c ? c.value : ''; }
    function firstEnabled(scope, name) {
      return $('input[name="' + name + '"]:checked', scope) || $('input[name="' + name + '"]:not(:disabled)', scope);
    }
    function focusField(k) {
      var t = null;
      if (k === 'service') t = sel;
      else if (k === 'date' || (k === 'time' && !selIso)) t = firstEnabled(months[monthIdx].el, 'date') || firstEnabled(calMonths, 'date');
      else if (k === 'time') t = firstEnabled(slotsBox, 'time');
      else if (k === 'format') t = $('input[name="format"]', form);
      else if (k === 'name') t = nameIn;
      if (t) t.focus();
    }
    function validate() {
      var bad = missing({ service: sel.value, date: selIso, time: selTime, format: fmtVal(), name: nameIn.value });
      Object.keys(FIELDS).forEach(function (k) { if (bad.indexOf(k) === -1) clearErr(k); else setErr(k); });
      if (!bad.length) { errBox.hidden = true; return true; }
      errBox.hidden = false;
      errBox.textContent = '';
      errBox.appendChild(el('strong', null, 'Заявка ещё не готова. '));
      errBox.appendChild(document.createTextNode('Заполните: ' + bad.map(function (k) { return FIELDS[k].label; }).join(', ') + '.'));
      focusField(bad[0]);
      return false;
    }
    function currentText() {
      var li = serviceItem(sel.value), day = find(selIso);
      return requestText({
        service: li.getAttribute('data-name'), price: li.getAttribute('data-price'), dateLong: fLongY.format(day.u),
        time: selTime, tzLabel: cfg.tzLabel, format: fmtVal(), name: nameIn.value, comment: comment.value
      });
    }
    function legacyCopy(text) {
      var prev = document.activeElement, ta = document.createElement('textarea'), ok = false;
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      if (prev && prev.focus) prev.focus({ preventScroll: true });
      return ok;
    }
    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
      }
      return Promise.resolve(legacyCopy(text));
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      submitted = true;
      render();
      if (!validate()) return;
      var text = currentText();
      busy = true;
      submitBtn.classList.add('is-loading'); submitBtn.setAttribute('aria-disabled', 'true');
      submitLabel.textContent = 'Открываем Telegram…';
      var copied = copyText(text);
      B.open(telegramUrl(cfg.user, text));
      resText.textContent = text;
      tgApp.href = tgSchemeUrl(cfg.user, text);
      result.hidden = false;
      resStatus.classList.remove('is-warn');
      resStatus.textContent = 'Открываем Telegram…';
      copied.then(function (ok) {
        resStatus.textContent = ok
          ? 'Текст заявки скопирован. Если поле сообщения в Telegram пустое — вставьте его.'
          : 'Скопировать автоматически не получилось. Нажмите «Скопировать текст заявки» или выделите текст ниже.';
        resStatus.classList.toggle('is-warn', !ok);
      });
      window.setTimeout(function () {
        busy = false;
        submitBtn.classList.remove('is-loading'); submitBtn.removeAttribute('aria-disabled');
        submitLabel.textContent = 'Отправить в Telegram';
      }, 1400);
      EA.G.react();
    });
    var copyTimer = 0;
    copyBtn.addEventListener('click', function () {
      copyText(resText.textContent).then(function (ok) {
        window.clearTimeout(copyTimer);
        copyBtn.classList.toggle('is-done', ok);
        copyBtn.textContent = ok ? 'Скопировано' : 'Не получилось — выделите текст выше';
        if (!ok) { var r = document.createRange(); r.selectNodeContents(resText); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
        copyTimer = window.setTimeout(function () { copyBtn.classList.remove('is-done'); copyBtn.textContent = 'Скопировать текст заявки'; }, 2200);
      });
    });
    editBtn.addEventListener('click', function () {
      $('#booking').scrollIntoView({ behavior: smooth(), block: 'start' });
      sel.focus({ preventScroll: true });
    });
    render();
  }
}());
