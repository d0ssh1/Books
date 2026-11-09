/* Интерфейс дневника «Прочитано». */
(function () {
  'use strict';

  const GENRES = Lookup.GENRES;

  /* ---------- помощники ---------- */
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const NONE = { finished: Promise.resolve(), cancel() {} };
  function anim(el, kf, opts) {
    if (RM || !el || !el.animate) return NONE;
    return el.animate(kf, Object.assign({ easing: EASE, fill: 'backwards' }, opts));
  }
  const pad = n => String(n).padStart(2, '0');
  const YEAR = new Date().getFullYear();
  const nowISO = () => new Date().toISOString();
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function parseISO(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function longDate(s, withYear) { const d = parseISO(s); if (!d) return ''; return d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : ''); }
  function daysBetween(a, b) { const A = parseISO(a), B = parseISO(b); if (!A || !B) return null; return Math.max(1, Math.round((B - A) / 864e5) + 1); }
  function plural(n, one, few, many) { const a = n % 10, b = n % 100; if (a === 1 && b !== 11) return one; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few; return many; }
  function quoteWrap(t) { t = String(t || '').trim(); return /^[«"„“]/.test(t) ? t : '«' + t.replace(/[.]$/, '') + '»' + (/[.]$/.test(t) ? '.' : ''); }
  const surname = a => { const p = String(a || '').trim().split(/\s+/); return p[p.length - 1] || ''; };
  const pct = b => b.pages ? Math.min(100, Math.round((b.page || 0) / b.pages * 100)) : 0;
  const nid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const X_SVG = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="M5 5l14 14M19 5L5 19"/></svg>';
  function splitChars(text) {
    return String(text).split(' ').map(w => '<span class="w">' + Array.from(w).map(ch => '<span class="ch">' + esc(ch) + '</span>').join('') + '</span>').join(' ');
  }
  function countUp(el, to, from, dur) {
    if (to == null || to === '' || isNaN(to)) { el.textContent = '—'; return; }
    if (RM) { el.textContent = to; return; }
    from = from || 0; dur = dur || 900;
    const t0 = performance.now();
    const step = t => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /* ---------- данные ---------- */
  let books = [];
  const byId = id => books.find(b => b.id === id);
  const touch = b => { b.updatedAt = nowISO(); };
  function save(message) { Store.commit(message); }
  function canEdit() {
    if (Store.connected()) return true;
    openSettings('Чтобы вносить изменения, подключи сайт к GitHub. Без этого книги можно только смотреть.');
    return false;
  }

  /* ---------- состояние ---------- */
  const DEFAULT_DIR = { date: -1, rating: -1, author: 1, title: 1, pages: -1 };
  const state = { genre: 'all', sort: 'date', dir: -1, q: '', view: 'list', openId: null, loaded: false };
  let savedScroll = 0;

  function visible() {
    let arr = books.filter(b => state.genre === 'all' || (b.genres || []).includes(state.genre));
    if (state.q) { const q = norm(state.q); arr = arr.filter(b => norm(b.title + ' ' + b.author).includes(q)); }
    const keyDate = b => b.status === 'reading' ? '9999' : (b.finished || '0000');
    const cmp = {
      date: (a, b) => keyDate(a).localeCompare(keyDate(b)),
      rating: (a, b) => (a.rating || 0) - (b.rating || 0),
      author: (a, b) => surname(a.author).localeCompare(surname(b.author), 'ru'),
      title: (a, b) => a.title.localeCompare(b.title, 'ru'),
      pages: (a, b) => (a.pages || 0) - (b.pages || 0)
    }[state.sort];
    return arr.sort((a, b) => cmp(a, b) * state.dir || a.title.localeCompare(b.title, 'ru'));
  }

  /* ---------- статус сохранения ---------- */
  function renderStatus(s) {
    const el = $('#saved');
    const time = d => d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '';
    const btn = label => ' <button type="button" class="link" data-act="settings">' + label + '</button>';
    let html = '', warn = false;
    switch (s.state) {
      case 'loading': html = 'Загружаю книги…'; break;
      case 'readonly': html = 'Только просмотр.' + btn('Подключить GitHub'); break;
      case 'pending': html = 'Есть изменения, сохраняю…'; break;
      case 'saving': html = 'Сохраняю в GitHub…'; break;
      case 'synced': html = 'Сохранено в GitHub' + (s.lastSync ? ' в ' + time(s.lastSync) : ''); break;
      case 'offline':
        warn = true;
        html = s.pending ? 'Нет связи с GitHub. Изменения лежат на этом устройстве и уйдут, когда связь появится.' : 'Нет связи с GitHub. Показываю последнюю сохранённую копию.';
        break;
      case 'auth': warn = true; html = 'GitHub не принял токен.' + btn('Подключить заново'); break;
      default: html = '';
    }
    el.innerHTML = html;
    el.classList.toggle('warn', warn);
    if (s.state === 'synced' && state.loaded) anim(el, [{ backgroundColor: 'rgba(200,35,30,.9)', color: '#F3EFE6' }, { backgroundColor: 'rgba(200,35,30,0)', color: '#1C1A18' }], { duration: 1100 });
  }
  $('#saved').addEventListener('click', e => { if (e.target.closest('[data-act="settings"]')) openSettings(); });

  /* ---------- список ---------- */
  function blocks(r) { let s = ''; for (let i = 1; i <= 10; i++) s += '<i class="blk' + (r && i <= r ? ' on' : '') + '"></i>'; return s; }
  function shortDate(b) {
    if (b.status === 'reading') return 'читаю';
    if (!b.finished) return '—';
    const [y, m, d] = b.finished.split('-');
    return Number(y) === YEAR ? d + '.' + m : d + '.' + m + '.' + y.slice(2);
  }
  function rowHTML(b) {
    const g = (b.genres || []).map(x => x.toLowerCase()).join(', ');
    const aria = b.rating ? 'Оценка ' + b.rating + ' из 10' : (b.status === 'reading' ? 'Ещё читаю' : 'Без оценки');
    return '<button type="button" class="row-btn" data-open="' + esc(b.id) + '">' +
      '<span class="r-date">' + esc(shortDate(b)) + (b.status === 'reading' ? '<span class="r-pct">' + pct(b) + '%</span>' : '') + '</span>' +
      '<span class="r-main"><span class="r-author">' + esc(b.author) + '</span><span class="r-title">' + esc(b.title) + '</span></span>' +
      '<span class="r-genres">' + esc(g) + '</span>' +
      '<span class="rate" role="img" aria-label="' + aria + '">' + blocks(b.rating) + '</span>' +
      (b.status === 'reading' ? '<span class="r-prog" style="width:' + pct(b) + '%" aria-hidden="true"></span>' : '') + '</button>';
  }

  const rowEls = new Map();
  function renderList(opts) {
    opts = opts || {};
    const list = $('#list'), items = visible();
    const instant = RM || opts.instant;
    const first = new Map();
    if (!instant) rowEls.forEach((el, id) => first.set(id, el.getBoundingClientRect()));
    const lr = list.getBoundingClientRect();
    const keep = new Set(items.map(b => b.id));
    Array.from(rowEls.entries()).forEach(([id, el]) => {
      if (keep.has(id)) return;
      rowEls.delete(id);
      if (instant || !first.get(id)) { el.remove(); return; }
      const r = first.get(id);
      Object.assign(el.style, { position: 'absolute', left: (r.left - lr.left) + 'px', top: (r.top - lr.top) + 'px', width: r.width + 'px', zIndex: 0, pointerEvents: 'none' });
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(70px)' }], { duration: 340, easing: 'cubic-bezier(.6,0,.8,.2)', fill: 'forwards' }).finished.then(() => el.remove());
    });
    const created = [];
    items.forEach(b => {
      let el = rowEls.get(b.id);
      if (!el) { el = document.createElement('li'); el.className = 'row'; el.dataset.id = b.id; rowEls.set(b.id, el); created.push(el); }
      el.innerHTML = rowHTML(b);
      list.appendChild(el);
    });
    renderEmpty(items.length);
    if (instant) return created;
    items.forEach(b => {
      const el = rowEls.get(b.id), r0 = first.get(b.id);
      if (!r0) return;
      const dy = r0.top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 620, easing: EASE });
    });
    created.forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateX(-56px)', clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' }], { duration: 620, delay: 80 + i * 55 }));
    return created;
  }
  function renderEmpty(n) {
    const e = $('#empty');
    if (n || !state.loaded) { e.classList.add('is-hidden'); return; }
    const wasHidden = e.classList.contains('is-hidden');
    if (books.length) {
      e.innerHTML = '<p>Ничего не нашлось</p><span>Попробуй другой жанр или другой запрос.</span><button type="button" class="btn btn-ink btn-sm" data-act="clear">Сбросить фильтры</button>';
    } else if (Store.connected()) {
      e.innerHTML = '<p>Здесь пока пусто</p><span>Внеси первую книгу, и она появится в списке.</span><button type="button" class="btn btn-red" data-act="add">Внести книгу</button>';
    } else {
      e.innerHTML = '<p>Здесь пока пусто</p><span>Подключи сайт к GitHub, чтобы вносить книги. Это нужно сделать один раз на каждом устройстве.</span><button type="button" class="btn btn-red" data-act="settings">Подключить GitHub</button>';
    }
    e.classList.remove('is-hidden');
    if (wasHidden) anim(e, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 450, delay: 200 });
  }

  function renderChips(first) {
    const counts = {};
    books.forEach(b => (b.genres || []).forEach(g => { counts[g] = (counts[g] || 0) + 1; }));
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ru'));
    if (state.genre !== 'all' && !counts[state.genre]) state.genre = 'all';
    const chip = (val, label, n) => '<button type="button" class="chip" data-genre="' + esc(val) + '" aria-pressed="' + (state.genre === val) + '"><span>' + esc(label) + ' ' + n + '</span></button>';
    $('#genres').innerHTML = books.length ? chip('all', 'Все', books.length) + names.map(g => chip(g, g, counts[g])).join('') : '';
    if (first) $$('#genres .chip').forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translateY(-14px) rotate(-4deg)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 200 + i * 40 }));
  }

  let shownCount = 0;
  function renderCount() {
    const n = books.filter(b => b.status === 'read' && b.finished && parseISO(b.finished).getFullYear() === YEAR).length;
    $('#cYear').textContent = YEAR;
    $('#cWord').textContent = plural(n, 'книга', 'книги', 'книг');
    if (n !== shownCount) { countUp($('#cNum'), n, shownCount, 700); shownCount = n; }
    else $('#cNum').textContent = n;
  }

  function placeSortInd(instant) {
    const btn = $('.sort[aria-pressed="true"]'), ind = $('#sortInd');
    if (!btn) return;
    if (instant) ind.style.transition = 'none';
    ind.style.width = btn.offsetWidth + 'px';
    ind.style.transform = 'translate(' + btn.offsetLeft + 'px,' + (btn.offsetTop + btn.offsetHeight - 4) + 'px)';
    if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
  }
  function renderSorts() {
    $$('.sort').forEach(b => {
      const on = b.dataset.sort === state.sort;
      b.setAttribute('aria-pressed', on);
      b.querySelector('.dir').classList.toggle('up', on && state.dir === 1);
    });
    placeSortInd();
  }

  function renderAll(opts) { renderChips(); renderCount(); renderSorts(); renderList(opts); }

  /* ---------- первое появление ---------- */
  function introHero() {
    const h = $('#h1chars');
    h.innerHTML = Array.from(h.textContent).map(c => '<span class="ch">' + esc(c) + '</span>').join('');
    $('#cYear').textContent = YEAR;
    placeSortInd(true);
    if (RM) return;
    $$('.ch', h).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translateY(60%) rotate(8deg)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 60 + i * 45 }));
    anim($('.bar'), [{ transform: 'rotate(-4deg) scaleX(0)' }, { transform: 'rotate(-4deg) scaleX(1)' }], { duration: 800, delay: 260, easing: 'cubic-bezier(.7,0,.2,1)' });
    anim($('.circle'), [{ transform: 'scale(0)' }, { transform: 'scale(1.12)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 700, delay: 520 });
    anim($('#tag'), [{ opacity: 0, transform: 'translateY(-34px) rotate(-14deg)' }, { opacity: 1, transform: 'rotate(-4deg)' }], { duration: 650, delay: 760 });
    anim($('#heroSide'), [{ opacity: 0, transform: 'translateX(30px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 700 });
    anim($('.row2'), [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 900 });
  }
  function introList() {
    $('#loadingLine').hidden = true;
    renderChips(true); renderCount(); renderSorts(); placeSortInd(true);
    const created = renderList({ instant: true });
    if (RM) return;
    created.forEach((el, i) => {
      anim(el, [{ opacity: 0, transform: 'translateX(-40px)', clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' }], { duration: 700, delay: 150 + Math.min(i, 14) * 70 });
      $$('.blk.on', el).forEach((k, j) => anim(k, [{ transform: 'skewX(-12deg) scaleY(0)' }, { transform: 'skewX(-12deg) scaleY(1)' }], { duration: 360, delay: 450 + Math.min(i, 14) * 70 + j * 30 }));
    });
  }
  function rowsReturn() {
    if (RM) return;
    $$('#list .row').forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateX(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 280 + Math.min(i, 12) * 45 }));
  }

  /* ---------- переходы ---------- */
  let busy = false;
  function transition(mid) {
    if (RM) { mid(); return; }
    if (busy) return;
    busy = true;
    const w = $('#wipe'); w.hidden = false;
    const io = 'cubic-bezier(.7,0,.3,1)';
    const kf = [
      { transform: 'rotate(-8deg) translateX(-115%)', easing: io },
      { transform: 'rotate(-8deg) translateX(0)', offset: 0.45 },
      { transform: 'rotate(-8deg) translateX(0)', offset: 0.55, easing: io },
      { transform: 'rotate(-8deg) translateX(115%)' }
    ];
    const [k, r] = w.children;
    k.animate(kf, { duration: 900, easing: 'linear', fill: 'both' });
    const a = r.animate(kf, { duration: 900, delay: 90, easing: 'linear', fill: 'both' });
    setTimeout(mid, 520);
    a.finished.then(() => { w.hidden = true; k.getAnimations().forEach(x => x.cancel()); r.getAnimations().forEach(x => x.cancel()); busy = false; });
  }
  function showView(v) { $('#listView').hidden = v !== 'list'; $('#book').hidden = v !== 'book'; state.view = v; }
  function openBook(id) {
    if (!byId(id)) return;
    savedScroll = window.scrollY;
    transition(() => { state.openId = id; showView('book'); renderBook(byId(id), true); window.scrollTo(0, 0); });
  }
  function backToList() {
    transition(() => { showView('list'); renderAll({ instant: true }); placeSortInd(true); window.scrollTo(0, savedScroll); rowsReturn(); });
  }

  /* ---------- страница книги ---------- */
  function ratingButtons(r, sm) {
    let s = '<div class="rbs' + (sm ? ' sm' : '') + '" role="group" aria-label="Оценка из 10">';
    for (let i = 1; i <= 10; i++) s += '<button type="button" class="rb' + (r && i <= r ? ' on' : '') + '" data-rate="' + i + '" aria-label="Оценка ' + i + '" aria-pressed="' + (r === i) + '"></button>';
    return s + '</div>';
  }
  function factsHTML(b) {
    const days = b.status === 'reading' ? daysBetween(b.started, todayISO()) : daysBetween(b.started, b.finished);
    const notes = (b.quotes || []).length + (b.thoughts || []).length;
    const f = (k, label, v) => '<div class="fact"><dt>' + label + '</dt><dd data-count="' + (v == null ? '' : v) + '" data-k="' + k + '">' + (v == null ? '—' : v) + '</dd></div>';
    return f('year', 'год издания', b.year || null) + f('pages', 'страниц', b.pages || null) + f('days', b.status === 'reading' ? 'читаю, дней' : 'читал, дней', days) + f('notes', 'цитат и мыслей', notes);
  }
  function datesText(b) {
    if (b.status === 'reading') return b.started ? 'Читаю с ' + longDate(b.started, true) : 'Читаю сейчас';
    if (b.started && b.finished) {
      const s = parseISO(b.started), e = parseISO(b.finished);
      return 'С ' + longDate(b.started, s.getFullYear() !== e.getFullYear()) + ' по ' + longDate(b.finished, true);
    }
    return b.finished ? 'Дочитал ' + longDate(b.finished, true) : '';
  }
  function genresHTML(b, editing) {
    const chips = (b.genres || []).map(g => '<span class="gchip" data-g="' + esc(g) + '">' + esc(g) + (editing ? '<button type="button" data-act="grem" data-g="' + esc(g) + '" aria-label="Убрать жанр ' + esc(g) + '">' + X_SVG + '</button>' : '') + '</span>').join('');
    if (editing) {
      const opts = GENRES.filter(g => !(b.genres || []).includes(g)).map(g => '<option>' + esc(g) + '</option>').join('');
      return '<div class="gchips" id="bChips">' + chips + '</div><div class="gedit"><label for="gAdd" class="sr">Добавить жанр</label><select id="gAdd" class="inp"><option value="">Добавить жанр…</option>' + opts + '</select><button type="button" class="btn btn-ink btn-sm" data-act="gdone">Готово</button></div>';
    }
    const note = (b.genres || []).length ? (b.genresAuto ? 'Жанры определены автоматически.' : 'Жанры указаны вручную.') : 'Жанры не указаны.';
    return '<div class="gchips" id="bChips">' + chips + '</div><p class="gnote">' + note + ' <button type="button" class="link" data-act="gedit">' + ((b.genres || []).length ? 'Исправить' : 'Добавить') + '</button></p>';
  }
  function reviewHTML(b, editing) {
    if (editing) return '<h3 class="sec-h">Отзыв</h3><div class="nform" style="padding:0"><label for="rText" class="sr">Отзыв</label><textarea id="rText" class="inp" rows="5">' + esc(b.review || '') + '</textarea><div class="acts"><button type="button" class="btn btn-red btn-sm" data-act="rsave">Сохранить отзыв</button><button type="button" class="btn btn-ghost btn-sm" data-act="rcancel">Отмена</button></div></div>';
    return '<h3 class="sec-h">Отзыв</h3>' + (b.review ? '<p class="review-text">' + esc(b.review) + '</p><button type="button" class="link" data-act="redit">Изменить отзыв</button>' : '<p class="muted">Отзыва пока нет.</p><button type="button" class="link" data-act="redit">Написать отзыв</button>');
  }
  function quoteHTML(q) {
    return '<figure class="quote" data-id="' + esc(q.id) + '"><blockquote class="clamp">' + esc(quoteWrap(q.text)) + '</blockquote>' + MORE_BTN +
      (q.ref ? '<span class="ref">' + esc(q.ref) + '</span>' : '') +
      (q.comment ? '<span class="cmt">Мой комментарий: ' + esc(q.comment) + '</span>' : '') +
      '<button type="button" class="x ed" data-act="editq" data-id="' + esc(q.id) + '" aria-label="Изменить цитату">' + PEN_SVG + '</button>' +
      '<button type="button" class="x" data-act="delq" data-id="' + esc(q.id) + '" aria-label="Удалить цитату">' + X_SVG + '</button></figure>';
  }
  function thoughtHTML(t) {
    return '<div class="thought" data-id="' + esc(t.id) + '"><div class="txt clamp">' + esc(t.text) + '</div>' + MORE_BTN +
      '<button type="button" class="x ed" data-act="editt" data-id="' + esc(t.id) + '" aria-label="Изменить мысль">' + PEN_SVG + '</button>' +
      '<button type="button" class="x" data-act="delt" data-id="' + esc(t.id) + '" aria-label="Удалить мысль">' + X_SVG + '</button></div>';
  }
  const PEN_SVG = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>';
  function quoteEditHTML(q) {
    return '<div class="nform inline"><label for="eqText">Цитата</label><textarea id="eqText" class="inp" rows="5">' + esc(q.text) + '</textarea>' +
      '<label for="eqRef">Где в книге</label><input id="eqRef" class="inp" value="' + esc(q.ref || '') + '" placeholder="Глава, страница">' +
      '<label for="eqCmt">Мой комментарий</label><textarea id="eqCmt" class="inp" rows="2" placeholder="Необязательно">' + esc(q.comment || '') + '</textarea>' +
      '<span class="err is-hidden" id="eqErr">Цитата не может быть пустой</span>' +
      '<div class="acts"><button type="button" class="btn btn-red btn-sm" data-act="qsave" data-id="' + esc(q.id) + '">Сохранить</button><button type="button" class="btn btn-ghost btn-sm" data-act="qcancel" data-id="' + esc(q.id) + '">Отмена</button></div></div>';
  }
  function thoughtEditHTML(t) {
    return '<div class="nform inline"><label for="etText" class="sr">Мысль</label><textarea id="etText" class="inp" rows="8">' + esc(t.text) + '</textarea>' +
      '<span class="err is-hidden" id="etErr" style="color:#F3A19D">Мысль не может быть пустой</span>' +
      '<div class="acts"><button type="button" class="btn btn-red btn-sm" data-act="tsave" data-id="' + esc(t.id) + '">Сохранить</button><button type="button" class="btn btn-ghost btn-sm" data-act="tcancel" data-id="' + esc(t.id) + '">Отмена</button></div></div>';
  }
  // Заменить запись на свежую разметку.
  function replaceItem(el, html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fresh = tmp.firstElementChild;
    el.replaceWith(fresh);
    setupClamps(fresh);
    return fresh;
  }
  function cancelEdit(el, b) {
    if (!el) return;
    const q = (b.quotes || []).find(x => x.id === el.dataset.id);
    const t = (b.thoughts || []).find(x => x.id === el.dataset.id);
    if (q) replaceItem(el, quoteHTML(q)); else if (t) replaceItem(el, thoughtHTML(t)); else el.remove();
  }

  /* Длинные цитаты и мысли показываем первыми строками, остальное по кнопке. */
  const MORE_BTN = '<button type="button" class="more" data-act="more" aria-expanded="false" hidden>Читать полностью</button>';
  function setupClamps(root) {
    $$('.clamp', root || document).forEach(box => {
      const btn = box.parentElement.querySelector(':scope > .more');
      if (!btn || box.classList.contains('open')) return;
      btn.hidden = box.scrollHeight <= box.clientHeight + 2;
    });
  }
  function toggleClamp(btn) {
    const box = btn.parentElement.querySelector(':scope > .clamp');
    if (!box) return;
    const from = box.offsetHeight;
    const open = !box.classList.contains('open');
    box.classList.toggle('open', open);
    const to = box.offsetHeight;
    btn.textContent = open ? 'Свернуть' : 'Читать полностью';
    btn.setAttribute('aria-expanded', open);
    anim(box, [{ height: from + 'px', overflow: 'hidden' }, { height: to + 'px', overflow: 'hidden' }], { duration: Math.min(700, 300 + Math.abs(to - from) * 0.6) });
    if (!open) {
      const top = btn.parentElement.getBoundingClientRect().top;
      if (top < 0) btn.parentElement.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
    }
  }
  const quotesList = b => (b.quotes || []).length ? b.quotes.map(quoteHTML).join('') : '<p class="muted">Цитат пока нет.</p>';
  const thoughtsList = b => (b.thoughts || []).length ? b.thoughts.map(thoughtHTML).join('') : '<p class="muted">Мыслей пока нет.</p>';

  function renderBook(b, enter) {
    const v = $('#book');
    const reading = b.status === 'reading';
    v.innerHTML =
      '<div class="book-top"><button type="button" class="back" data-act="back"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M20 12H5M11 5l-7 7 7 7"/></svg>Все книги</button>' +
      '<div class="book-actions" id="bActs"><button type="button" class="btn btn-ghost btn-sm" data-act="edit">Изменить</button><button type="button" class="btn btn-ghost btn-sm" data-act="del">Удалить</button></div></div>' +
      '<span class="b-author" id="bAuthor">' + esc(b.author) + '</span>' +
      '<div class="title-wrap"><h2 class="b-title" aria-label="' + esc(b.title) + '"><span aria-hidden="true">' + splitChars(b.title) + '</span></h2><div class="stamp" id="stamp" hidden aria-hidden="true">Прочитано</div></div>' +
      '<dl class="facts" id="facts">' + factsHTML(b) + '</dl>' +
      (reading ? '<div class="progress" id="progress"><label for="pPage">Я на странице</label><input id="pPage" class="inp" type="number" min="0" ' + (b.pages ? 'max="' + b.pages + '"' : '') + ' value="' + (b.page || 0) + '"><span>из ' + (b.pages || '?') + '</span><div class="pbar" aria-hidden="true"><i id="pBar"></i></div><span class="pct" id="pPct">' + pct(b) + '%</span><button type="button" class="btn btn-red" data-act="finish">Дочитал</button></div>' : '') +
      '<div class="rate-row" id="rateRow"><div class="rate-l">' + ratingButtons(b.rating) + '<span class="rate-num"><span class="v" id="rNum">' + (b.rating || '—') + '</span><span class="of">/ 10</span></span></div><span class="dates">' + esc(datesText(b)) + '</span></div>' +
      '<div class="genres-row" id="gRow">' + genresHTML(b, false) + '</div>' +
      '<section class="review" id="review" aria-label="Отзыв">' + reviewHTML(b, false) + '</section>' +
      '<div class="cols">' +
        '<section class="col-q" aria-labelledby="qh"><h3 class="sec-h" id="qh">Цитаты <span class="n" id="qN">' + (b.quotes || []).length + '</span></h3>' +
          '<div class="quotes" id="quotes">' + quotesList(b) + '</div>' +
          '<button type="button" class="btn btn-red" data-act="qopen" id="qOpen">Добавить цитату</button>' +
          '<div class="expand" id="qX"><div><form class="nform" id="qForm" novalidate>' +
            '<label for="qText">Цитата</label><textarea id="qText" class="inp" rows="3" placeholder="Текст цитаты"></textarea>' +
            '<label for="qRef">Где в книге</label><input id="qRef" class="inp" placeholder="Глава, страница">' +
            '<label for="qCmt">Мой комментарий</label><textarea id="qCmt" class="inp" rows="2" placeholder="Необязательно"></textarea>' +
            '<span class="err is-hidden" id="qErr">Впиши текст цитаты</span>' +
            '<div class="acts"><button type="submit" class="btn btn-red btn-sm">Сохранить цитату</button><button type="button" class="btn btn-ghost btn-sm" data-act="qclose">Отмена</button></div>' +
          '</form></div></div></section>' +
        '<section class="col-t" aria-labelledby="th"><h3 class="sec-h" id="th">Мысли <span class="n" id="tN">' + (b.thoughts || []).length + '</span></h3>' +
          '<div class="thoughts" id="thoughts">' + thoughtsList(b) + '</div>' +
          '<button type="button" class="btn btn-red" data-act="topen" id="tOpen">Записать мысль</button>' +
          '<div class="expand" id="tX"><div><form class="nform" id="tForm" novalidate>' +
            '<label for="tText">Мысль</label><textarea id="tText" class="inp" rows="3" placeholder="Что пришло в голову"></textarea>' +
            '<span class="err is-hidden" id="tErr" style="color:#F3A19D">Впиши текст мысли</span>' +
            '<div class="acts"><button type="submit" class="btn btn-red btn-sm">Сохранить мысль</button><button type="button" class="btn btn-ghost btn-sm" data-act="tclose">Отмена</button></div>' +
          '</form></div></div></section>' +
      '</div>';

    if (reading) requestAnimationFrame(() => { const bar = $('#pBar'); if (bar) bar.style.width = pct(b) + '%'; });
    setupClamps(v);
    if (!enter) { $$('.fact dd', v).forEach(dd => { const c = dd.dataset.count; dd.textContent = c === '' ? '—' : c; }); return; }
    if (RM) return;
    const d0 = 300;
    $$('.b-title .ch', v).forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translateY(.45em) rotate(7deg)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: d0 + Math.min(i, 40) * 24 }));
    anim($('#bAuthor'), [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: d0 });
    ['.book-top', '#facts', '#progress', '#rateRow', '#gRow', '#review', '.cols'].forEach((s, i) => {
      const el = $(s, v); if (el) anim(el, [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: d0 + 200 + i * 80 });
    });
    $$('.fact dd', v).forEach((dd, i) => {
      const c = dd.dataset.count; if (c === '') return;
      const to = Number(c), from = dd.dataset.k === 'year' ? Math.max(0, to - 120) : 0;
      dd.textContent = from;
      setTimeout(() => countUp(dd, to, from, 1000), d0 + 300 + i * 90);
    });
    $$('.rb.on', v).forEach((k, j) => anim(k, [{ transform: 'skewX(-12deg) scaleY(0)' }, { transform: 'skewX(-12deg) scaleY(1.15)', offset: 0.7 }, { transform: 'skewX(-12deg) scaleY(1)' }], { duration: 420, delay: d0 + 600 + j * 45 }));
    $$('.gchip', v).forEach((g, j) => anim(g, [{ opacity: 0, transform: 'scale(1.7) rotate(-8deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: d0 + 800 + j * 90, easing: 'cubic-bezier(.3,1.4,.5,1)' }));
  }

  function refreshCounts(b) {
    const qn = $('#qN'), tn = $('#tN');
    if (qn) qn.textContent = (b.quotes || []).length;
    if (tn) tn.textContent = (b.thoughts || []).length;
    const dd = $('#facts [data-k="notes"]');
    if (dd) { dd.textContent = (b.quotes || []).length + (b.thoughts || []).length; anim(dd, [{ transform: 'scale(1.35)', color: '#C8231E' }, { transform: 'none', color: '#1C1A18' }], { duration: 500 }); }
  }

  function setRatingUI(group, n, old, animate) {
    $$('.rb', group).forEach(btn => {
      const i = Number(btn.dataset.rate);
      btn.classList.toggle('on', !!n && i <= n);
      btn.setAttribute('aria-pressed', n === i);
      if (!animate) return;
      if (n && i <= n && (!old || i > old)) anim(btn, [{ transform: 'skewX(-12deg) scaleY(.2)' }, { transform: 'skewX(-12deg) scaleY(1.25)', offset: 0.6 }, { transform: 'skewX(-12deg) scaleY(1)' }], { duration: 420, delay: (i - (old || 0) - 1) * 40 });
    });
  }
  function previewRating(root) {
    root.addEventListener('mouseover', e => {
      const r = e.target.closest('.rb'); if (!r) return;
      const grp = r.closest('.rbs'), n = Number(r.dataset.rate);
      grp.classList.add('preview');
      $$('.rb', grp).forEach(x => x.classList.toggle('pre', Number(x.dataset.rate) <= n));
    });
    root.addEventListener('mouseout', e => {
      const grp = e.target.closest('.rbs'); if (!grp) return;
      if (!grp.contains(e.relatedTarget)) { grp.classList.remove('preview'); $$('.rb', grp).forEach(x => x.classList.remove('pre')); }
    });
  }

  /* ---------- события страницы книги ---------- */
  const bookEl = $('#book');
  const READ_ONLY_ACTS = new Set(['back', 'qclose', 'tclose', 'rcancel', 'delno', 'gdone', 'more', 'qcancel', 'tcancel']);
  bookEl.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-rate]');
    if (!t) return;
    const b = byId(state.openId); if (!b) return;
    const act = t.dataset.act;
    if (!READ_ONLY_ACTS.has(act) && !canEdit()) return;
    if (t.dataset.rate) {
      const n = Number(t.dataset.rate), old = b.rating;
      if (n === old) return;
      b.rating = n; touch(b); save('Поставил «' + b.title + '» ' + n + ' из 10');
      const grp = t.closest('.rbs'); grp.classList.remove('preview');
      setRatingUI(grp, n, old, true);
      const num = $('#rNum'); num.textContent = n;
      anim(num, [{ transform: 'translateY(-70%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380 });
      const ask = $('#ask'); if (ask) anim(ask, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(20px)' }], { duration: 260, fill: 'forwards' }).finished.then(() => ask.remove());
      return;
    }
    if (act === 'back') backToList();
    else if (act === 'more') toggleClamp(t);
    else if (act === 'editq' || act === 'editt') {
      const isQ = act === 'editq';
      const item = (isQ ? b.quotes : b.thoughts).find(x => x.id === t.dataset.id);
      if (!item) return;
      $$('.editing', bookEl).forEach(el => cancelEdit(el, b));
      const el = bookEl.querySelector((isQ ? '.quote' : '.thought') + '[data-id="' + CSS.escape(item.id) + '"]');
      if (!el) return;
      el.classList.add('editing');
      el.innerHTML = isQ ? quoteEditHTML(item) : thoughtEditHTML(item);
      anim(el, [{ opacity: 0.3, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
      const ta = $(isQ ? '#eqText' : '#etText', el);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    else if (act === 'qcancel' || act === 'tcancel') cancelEdit(t.closest('.editing'), b);
    else if (act === 'qsave' || act === 'tsave') {
      const isQ = act === 'qsave';
      const el = t.closest('.editing');
      const item = (isQ ? b.quotes : b.thoughts).find(x => x.id === t.dataset.id);
      if (!el || !item) return;
      const text = $(isQ ? '#eqText' : '#etText', el).value.trim();
      if (!text) { showErr(isQ ? '#eqErr' : '#etErr', isQ ? '#eqText' : '#etText'); return; }
      item.text = text;
      if (isQ) { item.ref = $('#eqRef', el).value.trim(); item.comment = $('#eqCmt', el).value.trim(); }
      touch(b);
      save(isQ ? 'Поправил цитату из «' + b.title + '»' : 'Поправил мысль к книге «' + b.title + '»');
      const fresh = replaceItem(el, isQ ? quoteHTML(item) : thoughtHTML(item));
      anim(fresh, [{ backgroundColor: 'rgba(200,35,30,.35)' }, { backgroundColor: 'rgba(200,35,30,0)' }], { duration: 1100 });
      toast(isQ ? 'Цитата обновлена' : 'Мысль обновлена');
    }
    else if (act === 'edit') openPanel(b);
    else if (act === 'del') {
      const box = $('#bActs');
      box.innerHTML = '<span class="confirm">Удалить книгу вместе с записями? <button type="button" class="btn btn-red btn-sm" data-act="delyes">Да, удалить</button><button type="button" class="btn btn-ghost btn-sm" data-act="delno">Нет</button></span>';
      anim(box.firstChild, [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], { duration: 350 });
      $('[data-act="delno"]', box).focus();
    }
    else if (act === 'delno') { $('#bActs').innerHTML = '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Изменить</button><button type="button" class="btn btn-ghost btn-sm" data-act="del">Удалить</button>'; }
    else if (act === 'delyes') {
      Store.removeBook(b.id); books = Store.data.books; save('Удалил книгу «' + b.title + '»');
      const row = rowEls.get(b.id); if (row) { row.remove(); rowEls.delete(b.id); }
      backToList(); setTimeout(() => toast('Книга удалена'), 700);
    }
    else if (act === 'gedit') { $('#gRow').innerHTML = genresHTML(b, true); anim($('.gedit'), [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 350 }); $('#gAdd').focus(); }
    else if (act === 'gdone') { $('#gRow').innerHTML = genresHTML(b, false); }
    else if (act === 'grem') {
      const g = t.dataset.g, chip = t.closest('.gchip');
      b.genres = b.genres.filter(x => x !== g); b.genresAuto = false; touch(b); save('Поправил жанры книги «' + b.title + '»');
      anim(chip, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.4) rotate(10deg)' }], { duration: 260, fill: 'forwards' }).finished.then(() => { $('#gRow').innerHTML = genresHTML(b, true); });
    }
    else if (act === 'redit') { $('#review').innerHTML = reviewHTML(b, true); const ta = $('#rText'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    else if (act === 'rcancel') { $('#review').innerHTML = reviewHTML(b, false); }
    else if (act === 'rsave') {
      b.review = $('#rText').value.trim(); touch(b); save('Обновил отзыв о книге «' + b.title + '»');
      $('#review').innerHTML = reviewHTML(b, false);
      const p = $('#review .review-text'); if (p) anim(p, [{ backgroundColor: 'rgba(200,35,30,.25)' }, { backgroundColor: 'rgba(200,35,30,0)' }], { duration: 900 });
      toast('Отзыв сохранён');
    }
    else if (act === 'qopen') openForm('q');
    else if (act === 'qclose') closeForm('q');
    else if (act === 'topen') openForm('t');
    else if (act === 'tclose') closeForm('t');
    else if (act === 'delq' || act === 'delt') {
      const key = act === 'delq' ? 'quotes' : 'thoughts';
      const el = t.closest(act === 'delq' ? '.quote' : '.thought');
      b[key] = b[key].filter(x => x.id !== t.dataset.id); touch(b);
      save(act === 'delq' ? 'Удалил цитату из «' + b.title + '»' : 'Удалил мысль к книге «' + b.title + '»');
      const h = el.offsetHeight;
      el.style.overflow = 'hidden';
      anim(el, [{ opacity: 1, height: h + 'px', transform: 'none' }, { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'translateX(40px)' }], { duration: 380, fill: 'forwards' }).finished.then(() => {
        el.remove();
        if (!b[key].length) { const box = key === 'quotes' ? $('#quotes') : $('#thoughts'); box.innerHTML = key === 'quotes' ? quotesList(b) : thoughtsList(b); }
      });
      refreshCounts(b);
    }
    else if (act === 'finish') {
      b.status = 'read'; b.finished = todayISO(); if (b.pages) b.page = b.pages; touch(b);
      save('Дочитал «' + b.title + '»');
      renderBook(b, false);
      celebrate(b);
    }
  });
  previewRating(bookEl);
  bookEl.addEventListener('change', e => {
    const b = byId(state.openId); if (!b) return;
    if (e.target.id === 'gAdd' && e.target.value) {
      if (!canEdit()) return;
      const g = e.target.value; b.genres = (b.genres || []).concat(g); b.genresAuto = false; touch(b); save('Поправил жанры книги «' + b.title + '»');
      $('#gRow').innerHTML = genresHTML(b, true);
      const chip = $('#bChips .gchip[data-g="' + CSS.escape(g) + '"]');
      anim(chip, [{ opacity: 0, transform: 'scale(1.8) rotate(-10deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      $('#gAdd').focus();
    }
    if (e.target.id === 'pPage') {
      if (!canEdit()) { e.target.value = b.page || 0; return; }
      let p = Math.max(0, Number(e.target.value) || 0); if (b.pages) p = Math.min(p, b.pages);
      e.target.value = p; b.page = p; touch(b); save('Отметил, что в «' + b.title + '» дошёл до страницы ' + p);
      $('#pBar').style.width = pct(b) + '%';
      const el = $('#pPct'), from = parseInt(el.textContent, 10) || 0, to = pct(b);
      if (RM) el.textContent = to + '%';
      else { const t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / 700); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))) + '%'; if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
    }
  });
  bookEl.addEventListener('submit', e => {
    e.preventDefault();
    const b = byId(state.openId); if (!b) return;
    if (!canEdit()) return;
    if (e.target.id === 'qForm') {
      const text = $('#qText').value.trim();
      if (!text) { showErr('#qErr', '#qText'); return; }
      const q = { id: nid('q'), text, ref: $('#qRef').value.trim(), comment: $('#qCmt').value.trim() };
      b.quotes = (b.quotes || []).concat(q); touch(b); save('Добавил цитату из «' + b.title + '»');
      const box = $('#quotes'); if (!box.querySelector('.quote')) box.innerHTML = '';
      box.insertAdjacentHTML('beforeend', quoteHTML(q));
      setupClamps(box.lastElementChild);
      anim(box.lastElementChild, [{ opacity: 0, transform: 'translateX(-40px)', backgroundColor: 'rgba(200,35,30,.35)' }, { opacity: 1, transform: 'none', backgroundColor: 'rgba(200,35,30,.18)', offset: 0.5 }, { backgroundColor: 'rgba(200,35,30,0)' }], { duration: 1200 });
      e.target.reset(); closeForm('q'); refreshCounts(b); toast('Цитата сохранена');
    }
    if (e.target.id === 'tForm') {
      const text = $('#tText').value.trim();
      if (!text) { showErr('#tErr', '#tText'); return; }
      const t = { id: nid('t'), text };
      b.thoughts = (b.thoughts || []).concat(t); touch(b); save('Записал мысль к книге «' + b.title + '»');
      const box = $('#thoughts'); if (!box.querySelector('.thought')) box.innerHTML = '';
      box.insertAdjacentHTML('beforeend', thoughtHTML(t));
      setupClamps(box.lastElementChild);
      anim(box.lastElementChild, [{ opacity: 0, transform: 'translateX(-40px)', color: '#C8231E' }, { opacity: 1, transform: 'none', color: '#DEDAD0' }], { duration: 900 });
      e.target.reset(); closeForm('t'); refreshCounts(b); toast('Мысль записана');
    }
  });
  function showErr(errSel, inpSel) {
    const err = $(errSel), inp = $(inpSel);
    err.classList.remove('is-hidden');
    anim(inp, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 420 });
    inp.focus();
  }
  function openForm(k) {
    $('#' + k + 'X').classList.add('open');
    $('#' + k + 'Open').classList.add('is-hidden');
    setTimeout(() => { const f = $('#' + k + 'Text'); if (f) f.focus({ preventScroll: true }); }, RM ? 0 : 200);
  }
  function closeForm(k) {
    $('#' + k + 'X').classList.remove('open');
    const btn = $('#' + k + 'Open'); btn.classList.remove('is-hidden');
    const err = $('#' + k + 'Err'); if (err) err.classList.add('is-hidden');
    anim(btn, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 150 });
  }
  function celebrate(b) {
    toast('Книга отмечена как прочитанная');
    const st = $('#stamp'); st.hidden = false;
    anim(st, [{ opacity: 0, transform: 'rotate(-12deg) scale(2.8)' }, { opacity: 1, transform: 'rotate(-12deg) scale(.92)', offset: 0.65 }, { opacity: 1, transform: 'rotate(-12deg) scale(1)' }], { duration: 620, easing: 'cubic-bezier(.5,0,.3,1)' });
    anim($('.b-title'), [{ transform: 'none' }, { transform: 'translate(-5px,3px)', offset: 0.62 }, { transform: 'translate(4px,-2px)', offset: 0.75 }, { transform: 'none' }], { duration: 700 });
    setTimeout(() => {
      anim(st, [{ opacity: 1 }, { opacity: 0, transform: 'rotate(-12deg) scale(1.1)' }], { duration: 600, fill: 'forwards' }).finished.then(() => { st.hidden = true; st.getAnimations && st.getAnimations().forEach(a => a.cancel()); });
    }, 2200);
    if (!b.rating) {
      $('#rateRow .rate-l').insertAdjacentHTML('beforeend', '<span class="ask" id="ask">Поставь оценку</span>');
      anim($('#ask'), [{ opacity: 0, transform: 'translateX(-16px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 700 });
      $$('#rateRow .rb').forEach((k, i) => anim(k, [{ transform: 'skewX(-12deg)' }, { transform: 'skewX(-12deg) translateY(-10px)', backgroundColor: '#DB6A66', offset: 0.5 }, { transform: 'skewX(-12deg)' }], { duration: 500, delay: 800 + i * 50 }));
    }
  }

  /* ---------- всплывающее сообщение ---------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    if (t.getAnimations) t.getAnimations().forEach(a => a.cancel());
    anim(t, [{ transform: 'translateX(-130%) rotate(-3deg)' }, { transform: 'translateX(6%) rotate(-3deg)', offset: 0.7 }, { transform: 'rotate(-3deg)' }], { duration: 520 });
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      const a = anim(t, [{ transform: 'rotate(-3deg)', opacity: 1 }, { transform: 'translateX(-130%) rotate(-3deg)', opacity: 0 }], { duration: 380, fill: 'forwards', easing: 'cubic-bezier(.6,0,.8,.2)' });
      a.finished.then(() => { t.hidden = true; a.cancel(); });
    }, 2300);
  }

  /* ---------- боковая панель ---------- */
  let panelOpen = false, editingId = null, draft = null, fillToken = 0, lastFocus = null, lastResults = [];
  const panel = $('#panel'), scrim = $('#scrim');

  function showPanel(focusSel) {
    lastFocus = document.activeElement;
    scrim.hidden = false; panel.hidden = false; panelOpen = true;
    panel.scrollTop = 0;
    document.documentElement.style.overflow = 'hidden';
    anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
    anim(panel, [{ transform: 'translateX(105%)' }, { transform: 'none' }], { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)' });
    anim($('.panel-head', panel), [{ clipPath: 'polygon(0 0,0 0,0 70%,0 100%)' }, { clipPath: 'polygon(0 0,100% 0,100% 70%,0 100%)' }], { duration: 700, delay: 160, easing: 'cubic-bezier(.7,0,.2,1)' });
    $$('.pi', panel).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 260 + i * 45 }));
    setTimeout(() => { const f = $(focusSel, panel); if (f) f.focus({ preventScroll: true }); }, RM ? 0 : 420);
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false; fillToken++;
    document.documentElement.style.overflow = '';
    const a = anim(panel, [{ transform: 'none' }, { transform: 'translateX(105%)' }], { duration: 420, fill: 'forwards', easing: 'cubic-bezier(.6,0,.8,.2)' });
    anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: 'forwards' });
    a.finished.then(() => {
      panel.hidden = true; scrim.hidden = true;
      if (panel.getAnimations) panel.getAnimations().forEach(x => x.cancel());
      if (scrim.getAnimations) scrim.getAnimations().forEach(x => x.cancel());
      if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    });
  }

  /* --- форма книги --- */
  function bookFormHTML() {
    const ed = !!editingId;
    return '<div class="panel-head"><h2 id="pTitle">' + (ed ? 'Изменить книгу' : 'Новая книга') + '</h2><button type="button" class="pclose" data-act="close" aria-label="Закрыть">' + X_SVG + '</button></div>' +
    '<form class="panel-body" id="bf" novalidate>' +
      (ed ? '' : '<div class="find pi"><label for="fFind" class="flabel">Найти книгу</label><div class="find-row"><input id="fFind" class="inp" placeholder="Название или автор" autocomplete="off"><button type="button" class="btn btn-ink" data-act="find" id="findBtn">Найти</button></div>' +
        '<p class="hint">Ищу в Google Books и Open Library. Выбери издание, и название, автор, год, страницы и жанры заполнятся сами.</p><ul class="results" id="results"></ul></div>') +
      '<div class="f pi"><label for="fTitle">Название</label><input id="fTitle" class="inp" autocomplete="off"><span class="err is-hidden" id="eTitle">Впиши название книги</span></div>' +
      '<div class="f pi"><label for="fAuthor">Автор</label><input id="fAuthor" class="inp" autocomplete="off"></div>' +
      '<div class="grid2 pi"><div class="f"><label for="fYear">Год издания</label><input id="fYear" class="inp" type="number" inputmode="numeric"></div><div class="f"><label for="fPages">Страниц</label><input id="fPages" class="inp" type="number" inputmode="numeric"></div></div>' +
      '<fieldset class="f seg pi"><legend>Статус</legend><label><input type="radio" name="st" value="read"><span>Дочитал</span></label><label><input type="radio" name="st" value="reading"><span>Читаю</span></label></fieldset>' +
      '<div class="grid2 pi"><div class="f"><label for="fStart">Начал</label><input id="fStart" class="inp" type="date"></div>' +
        '<div class="f" id="finBox"><label for="fFin">Дочитал</label><input id="fFin" class="inp" type="date"></div>' +
        '<div class="f" id="pageBox"><label for="fPage">Сейчас на странице</label><input id="fPage" class="inp" type="number" inputmode="numeric"></div></div>' +
      '<div class="f pi"><span class="flabel">Оценка</span><div class="rate-l">' + ratingButtons(draft.rating, true) + '<span class="rate-num" style="font-size:28px"><span class="v" id="fRNum">' + (draft.rating || '—') + '</span><span class="of">/ 10</span></span></div></div>' +
      '<div class="f pi"><span class="flabel">Жанры</span><div class="gchips" id="fG"></div><div class="gedit"><label for="fGAdd" class="sr">Добавить жанр</label><select id="fGAdd" class="inp"></select></div><p class="gnote" id="fGNote"></p></div>' +
      '<div class="f pi"><label for="fReview">Отзыв</label><textarea id="fReview" class="inp" rows="4" placeholder="Что думаешь о книге"></textarea></div>' +
      '<div class="pactions pi"><button type="submit" class="btn btn-red">' + (ed ? 'Сохранить' : 'Внести книгу') + '</button><button type="button" class="btn btn-ghost" data-act="close">Отмена</button></div>' +
    '</form>';
  }
  function renderPanelGenres(added) {
    const box = $('#fG'); if (!box) return;
    box.innerHTML = draft.genres.map(g => '<span class="gchip" data-g="' + esc(g) + '">' + esc(g) + '<button type="button" data-act="pgrem" data-g="' + esc(g) + '" aria-label="Убрать жанр ' + esc(g) + '">' + X_SVG + '</button></span>').join('');
    $('#fGAdd').innerHTML = '<option value="">Добавить жанр…</option>' + GENRES.filter(g => !draft.genres.includes(g)).map(g => '<option>' + esc(g) + '</option>').join('');
    $('#fGNote').textContent = draft.genres.length
      ? (draft.genresAuto ? 'Жанры определены автоматически. Если что-то не так, убери лишнее или добавь своё.' : '')
      : (editingId ? '' : 'Жанры подставятся сами, когда выберешь книгу из поиска.');
    if (added) { const c = $('#fG .gchip[data-g="' + CSS.escape(added) + '"]'); anim(c, [{ opacity: 0, transform: 'scale(1.9) rotate(-10deg)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' }); }
  }
  function syncStatus(animate) {
    const reading = draft.status === 'reading';
    const fin = $('#finBox'), pg = $('#pageBox');
    fin.classList.toggle('is-hidden', reading); pg.classList.toggle('is-hidden', !reading);
    if (animate) anim(reading ? pg : fin, [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 350 });
  }
  function openPanel(b) {
    if (!canEdit()) return;
    editingId = b ? b.id : null;
    draft = b ? JSON.parse(JSON.stringify(b)) : { status: 'read', genres: [], genresAuto: false, rating: null, started: '', finished: todayISO(), page: 0, review: '' };
    panel.innerHTML = bookFormHTML();
    $('#fTitle').value = draft.title || ''; $('#fAuthor').value = draft.author || '';
    $('#fYear').value = draft.year || ''; $('#fPages').value = draft.pages || '';
    $('#fStart').value = draft.started || ''; $('#fFin').value = draft.finished || ''; $('#fPage').value = draft.page || '';
    $('#fReview').value = draft.review || '';
    $$('input[name="st"]', panel).forEach(r => { r.checked = r.value === draft.status; });
    syncStatus(false); renderPanelGenres();
    showPanel(b ? '#fTitle' : '#fFind');
  }

  async function doFind() {
    const inp = $('#fFind'), q = inp.value.trim();
    if (!q) { anim(inp, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 360 }); inp.focus(); return; }
    const btn = $('#findBtn'), ul = $('#results');
    btn.classList.add('loading'); btn.textContent = 'Ищу'; btn.disabled = true;
    let found = [], failed = false;
    try { found = await Lookup.search(q); } catch (e) { failed = true; }
    if (!panelOpen || !$('#results')) return;
    btn.classList.remove('loading'); btn.textContent = 'Найти'; btn.disabled = false;
    lastResults = found;
    if (failed) {
      ul.innerHTML = '<li class="res-none">Не получилось связаться с Google Books и Open Library. Проверь интернет или заполни поля вручную.</li>';
    } else if (!found.length) {
      ul.innerHTML = '<li class="res-none">Ничего не нашлось. Название я перенёс в поле ниже, остальное можно дописать вручную.</li>';
      const token = ++fillToken;
      if (!$('#fTitle').value.trim()) await typeInto($('#fTitle'), q, token);
      if (token === fillToken) $('#fAuthor').focus();
    } else {
      ul.innerHTML = found.map((c, i) => '<li><button type="button" class="res" data-res="' + i + '"><span class="res-t">' + esc(c.title) + '</span><span class="res-m">' +
        esc([c.author, c.firstYear || c.year, c.pages ? c.pages + ' с.' : ''].filter(Boolean).join(', ')) + '</span><span class="res-src">' + esc(c.source) + '</span></button></li>').join('');
    }
    $$('li', ul).forEach((li, i) => anim(li, [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 60 }));
  }
  async function typeInto(el, text, token) {
    if (!el) return;
    el.classList.add('typing');
    if (RM) el.value = text;
    else {
      el.value = '';
      const step = Math.max(12, Math.min(38, 420 / Math.max(1, text.length)));
      for (let i = 1; i <= text.length; i++) { if (token !== fillToken) return; el.value = text.slice(0, i); await wait(step); }
    }
    el.classList.remove('typing');
  }
  async function pickResult(c) {
    const token = ++fillToken;
    const ul = $('#results');
    anim(ul, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 220, fill: 'forwards' }).finished.then(() => {
      if (token === fillToken && ul.isConnected) { ul.innerHTML = ''; if (ul.getAnimations) ul.getAnimations().forEach(a => a.cancel()); }
    });
    const details = Lookup.enrich(c).catch(() => ({ year: c.year, genres: [] }));
    await typeInto($('#fTitle'), c.title, token); if (token !== fillToken) return;
    await typeInto($('#fAuthor'), c.author || '', token); if (token !== fillToken) return;
    const info = await details; if (token !== fillToken) return;
    if (info.year) await typeInto($('#fYear'), String(info.year), token); if (token !== fillToken) return;
    if (c.pages) await typeInto($('#fPages'), String(c.pages), token); if (token !== fillToken) return;
    draft.genres = []; draft.genresAuto = true; renderPanelGenres();
    if (!info.genres.length) { $('#fGNote').textContent = 'Жанры определить не получилось, выбери их из списка.'; draft.genresAuto = false; return; }
    for (const g of info.genres) { if (token !== fillToken) return; draft.genres.push(g); renderPanelGenres(g); await wait(RM ? 0 : 200); }
  }

  /* --- подключение к GitHub --- */
  function settingsHTML(note) {
    const c = Store.config;
    const on = Store.connected();
    return '<div class="panel-head"><h2 id="pTitle">GitHub</h2><button type="button" class="pclose" data-act="close" aria-label="Закрыть">' + X_SVG + '</button></div>' +
    '<form class="panel-body" id="sf" novalidate>' +
      (note ? '<p class="note pi">' + esc(note) + '</p>' : '') +
      '<p class="conn pi">' + (on ? 'Подключено к <b>' + esc(c.owner + '/' + c.repo) + '</b>' : 'Не подключено') + '</p>' +
      '<p class="lead pi">Книги хранятся в файле <code>' + esc(c.path) + '</code> в репозитории. Каждое изменение сохраняется коммитом от твоего имени. Чтобы сайт мог сохранять, ему нужен токен доступа. Вводишь его один раз на каждом устройстве.</p>' +
      '<ol class="steps pi">' +
        '<li>Открой <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">создание токена на GitHub</a>.</li>' +
        '<li>Название любое, срок действия выбери сам, например год.</li>' +
        '<li>В «Repository access» выбери <code>Only select repositories</code> и отметь репозиторий <code>' + esc(c.repo || 'books') + '</code>.</li>' +
        '<li>В «Permissions» найди <code>Contents</code> и поставь <code>Read and write</code>.</li>' +
        '<li>Нажми «Generate token», скопируй его и вставь ниже.</li>' +
      '</ol>' +
      '<div class="grid2 pi"><div class="f"><label for="sOwner">Владелец</label><input id="sOwner" class="inp" autocomplete="off" value="' + esc(c.owner) + '"></div><div class="f"><label for="sRepo">Репозиторий</label><input id="sRepo" class="inp" autocomplete="off" value="' + esc(c.repo) + '"></div></div>' +
      '<div class="f pi"><label for="sToken">Токен</label><input id="sToken" class="inp" type="password" autocomplete="off" spellcheck="false" placeholder="' + (on ? 'Токен уже сохранён на этом устройстве' : 'github_pat_…') + '"></div>' +
      '<span class="err is-hidden pi" id="sErr"></span>' +
      '<div class="pactions pi"><button type="submit" class="btn btn-red" id="sGo">' + (on ? 'Подключить заново' : 'Подключить') + '</button>' +
        (on ? '<button type="button" class="btn btn-ghost" data-act="disconnect">Отключить это устройство</button>' : '') + '</div>' +
      '<hr class="panel-sep pi">' +
      '<h3 class="pi">Резервная копия</h3>' +
      '<p class="lead pi">Загрузи файл JSON, который раньше скачал через «Экспорт всех данных». Книги из файла добавятся к текущим, а совпадающие обновятся.</p>' +
      '<label class="btn btn-ghost file-btn pi">Выбрать файл JSON<input type="file" id="sImport" accept=".json,application/json"></label>' +
      '<span class="err is-hidden pi" id="iErr"></span>' +
    '</form>';
  }
  function openSettings(note) {
    editingId = null; draft = null;
    panel.innerHTML = settingsHTML(note);
    showPanel(Store.connected() ? '#sGo' : '#sToken');
  }
  async function submitSettings() {
    const err = $('#sErr'), go = $('#sGo');
    err.classList.add('is-hidden');
    const token = $('#sToken').value.trim();
    if (!token) { err.textContent = 'Вставь токен из GitHub.'; showErr('#sErr', '#sToken'); return; }
    go.disabled = true; go.textContent = 'Проверяю…';
    try {
      await Store.connect({ owner: $('#sOwner').value, repo: $('#sRepo').value, token });
      closePanel();
      toast('GitHub подключён');
    } catch (e) {
      err.textContent = e.message || 'Не получилось подключиться.';
      showErr('#sErr', '#sToken');
      go.disabled = false; go.textContent = 'Подключить';
    }
  }
  async function importFile(file) {
    const err = $('#iErr'); err.classList.add('is-hidden');
    if (!Store.connected()) { err.textContent = 'Сначала подключи GitHub, иначе загруженные книги некуда сохранить.'; err.classList.remove('is-hidden'); return; }
    try {
      const j = JSON.parse(await file.text());
      const list = Array.isArray(j) ? j : j.books;
      if (!Array.isArray(list)) throw new Error('В файле нет списка книг.');
      const clean = list.filter(b => b && b.id && b.title);
      if (!clean.length) throw new Error('В файле нет ни одной книги.');
      Store.importBooks(clean);
      save('Загрузил книги из резервной копии');
      closePanel();
      toast('Загружено книг: ' + clean.length);
    } catch (e) {
      err.textContent = 'Не получилось прочитать файл. ' + (e.message || '');
      err.classList.remove('is-hidden');
    }
  }

  /* --- события панели --- */
  panel.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-res],[data-rate]');
    if (!t) return;
    if (t.dataset.res) { const c = lastResults[Number(t.dataset.res)]; if (c) pickResult(c); return; }
    if (t.dataset.rate && draft) {
      const n = Number(t.dataset.rate), old = draft.rating;
      draft.rating = old === n ? null : n;
      const grp = t.closest('.rbs'); grp.classList.remove('preview');
      setRatingUI(grp, draft.rating, old, true);
      const v = $('#fRNum'); v.textContent = draft.rating || '—';
      anim(v, [{ transform: 'translateY(-70%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340 });
      return;
    }
    const act = t.dataset.act;
    if (act === 'close') closePanel();
    else if (act === 'find') doFind();
    else if (act === 'disconnect') { Store.disconnect(); closePanel(); toast('Устройство отключено'); }
    else if (act === 'pgrem') {
      const g = t.dataset.g, chip = t.closest('.gchip');
      draft.genres = draft.genres.filter(x => x !== g); draft.genresAuto = false;
      anim(chip, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.4) rotate(10deg)' }], { duration: 240, fill: 'forwards' }).finished.then(() => renderPanelGenres());
    }
  });
  previewRating(panel);
  panel.addEventListener('change', e => {
    if (e.target.name === 'st') { draft.status = e.target.value; syncStatus(true); }
    if (e.target.id === 'fGAdd' && e.target.value) { const g = e.target.value; draft.genres.push(g); draft.genresAuto = false; renderPanelGenres(g); $('#fGAdd').focus(); }
    if (e.target.id === 'sImport' && e.target.files && e.target.files[0]) importFile(e.target.files[0]);
  });
  panel.addEventListener('keydown', e => {
    if (e.target.id === 'fFind' && e.key === 'Enter') { e.preventDefault(); doFind(); }
  });
  panel.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'sf') { submitSettings(); return; }
    if (e.target.id !== 'bf') return;
    fillToken++;
    const title = $('#fTitle').value.trim();
    if (!title) { showErr('#eTitle', '#fTitle'); return; }
    const num = id => { const v = parseInt($(id).value, 10); return isNaN(v) ? null : v; };
    Object.assign(draft, {
      title, author: $('#fAuthor').value.trim(), year: num('#fYear'), pages: num('#fPages'),
      started: $('#fStart').value, review: $('#fReview').value.trim(), updatedAt: nowISO()
    });
    if (draft.status === 'read') { draft.finished = $('#fFin').value || todayISO(); if (draft.pages) draft.page = draft.pages; }
    else { draft.finished = ''; draft.page = num('#fPage') || 0; }
    const isNew = !editingId;
    if (isNew) {
      Object.assign(draft, { id: nid('b'), createdAt: nowISO(), quotes: [], thoughts: [] });
      Store.addBook(draft);
      save('Добавил книгу «' + draft.title + '»');
    } else {
      const b = byId(editingId);
      Object.assign(b, draft);
      save('Обновил «' + b.title + '»');
    }
    books = Store.data.books;
    const id = isNew ? draft.id : editingId;
    closePanel();
    if (state.view === 'book' && !isNew) {
      setTimeout(() => { renderBook(byId(id), true); toast('Изменения сохранены'); }, RM ? 0 : 300);
    } else {
      setTimeout(() => {
        if (isNew) { state.genre = 'all'; state.q = ''; $('#q').value = ''; }
        renderAll();
        const row = rowEls.get(id);
        if (row) {
          row.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
          anim(row, [{ backgroundColor: '#C8231E' }, { backgroundColor: '#DEDAD0' }], { duration: 1400, delay: 400 });
        }
        toast(isNew ? 'Книга внесена' : 'Изменения сохранены');
      }, RM ? 0 : 320);
    }
  });

  document.addEventListener('keydown', e => {
    if (!panelOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
    if (e.key === 'Tab') {
      const f = $$('button,input,select,textarea,a[href]', panel).filter(x => !x.disabled && x.offsetParent !== null && !(x.type === 'radio' && !x.checked));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  scrim.addEventListener('click', closePanel);

  /* ---------- экспорт ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function exportData(kind) {
    const stamp = todayISO();
    const list = books.slice().sort((a, b) => (b.finished || '9999').localeCompare(a.finished || '9999'));
    if (kind === 'json') {
      download('prochitano-' + stamp + '.json', JSON.stringify(Store.data, null, 2) + '\n', 'application/json');
    } else if (kind === 'csv') {
      const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['Название', 'Автор', 'Год издания', 'Страниц', 'Статус', 'Начал', 'Дочитал', 'Оценка из 10', 'Жанры', 'Отзыв', 'Цитаты', 'Мысли'];
      const rows = list.map(b => [
        b.title, b.author, b.year, b.pages, b.status === 'reading' ? 'Читаю' : 'Прочитано', b.started, b.finished, b.rating,
        (b.genres || []).join(', '), b.review,
        (b.quotes || []).map(q => quoteWrap(q.text) + (q.ref ? ' (' + q.ref + ')' : '') + (q.comment ? ' — ' + q.comment : '')).join('\n'),
        (b.thoughts || []).map(t => t.text).join('\n')
      ].map(cell).join(';'));
      download('prochitano-' + stamp + '.csv', '﻿' + [head.map(cell).join(';')].concat(rows).join('\r\n'), 'text/csv;charset=utf-8');
    } else if (kind === 'md') {
      const out = ['# Прочитано', '', 'Выгрузка от ' + longDate(stamp, true) + ', книг: ' + list.length + '.', ''];
      list.forEach(b => {
        out.push('## ' + b.title + (b.author ? ' — ' + b.author : ''), '');
        const meta = [];
        if (b.year) meta.push('год издания ' + b.year);
        if (b.pages) meta.push(b.pages + ' с.');
        if (b.genres && b.genres.length) meta.push(b.genres.join(', ').toLowerCase());
        if (meta.length) out.push(meta.join(', ') + '  ');
        const d = datesText(b); if (d) out.push(d + '  ');
        out.push('Оценка: ' + (b.rating ? b.rating + ' из 10' : 'нет'), '');
        if (b.review) out.push(b.review, '');
        if ((b.quotes || []).length) {
          out.push('### Цитаты', '');
          b.quotes.forEach(q => { out.push('> ' + quoteWrap(q.text).replace(/\n/g, '\n> ') + (q.ref ? '  \n> — ' + q.ref : ''), ''); if (q.comment) out.push('Мой комментарий: ' + q.comment, ''); });
        }
        if ((b.thoughts || []).length) {
          out.push('### Мысли', '');
          b.thoughts.forEach(t => out.push('- ' + t.text.replace(/\n/g, ' ')));
          out.push('');
        }
      });
      download('prochitano-' + stamp + '.md', out.join('\n'), 'text/markdown;charset=utf-8');
    }
    toast('Файл скачивается');
  }
  $('#exportBtn').addEventListener('click', () => {
    const x = $('#exportX'), open = !x.classList.contains('open');
    x.classList.toggle('open', open);
    $('#exportBtn').setAttribute('aria-expanded', open);
    if (open) {
      $$('.export-opts > *', x).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 60 }));
      setTimeout(() => x.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'nearest' }), 200);
    }
  });
  $('#exportX').addEventListener('click', e => { const b = e.target.closest('[data-export]'); if (b) exportData(b.dataset.export); });
  $('#settingsBtn').addEventListener('click', () => openSettings());

  /* ---------- события списка ---------- */
  $('#addBtn').addEventListener('click', () => openPanel(null));
  $('#list').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openBook(b.dataset.open); });
  $('#genres').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.genre = c.dataset.genre;
    $$('#genres .chip').forEach(x => x.setAttribute('aria-pressed', x === c));
    renderList();
  });
  $('#sorts').addEventListener('click', e => {
    const s = e.target.closest('.sort'); if (!s) return;
    const key = s.dataset.sort;
    if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = DEFAULT_DIR[key]; }
    renderSorts(); renderList();
  });
  let qT;
  $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value; renderList(); }, 140); });
  $('#empty').addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.dataset.act === 'add') openPanel(null);
    if (t.dataset.act === 'settings') openSettings();
    if (t.dataset.act === 'clear') { state.genre = 'all'; state.q = ''; $('#q').value = ''; renderChips(); renderList(); }
  });
  let rT;
  window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { placeSortInd(true); if (state.view === 'book') setupClamps(bookEl); }, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeSortInd(true); setupClamps(bookEl); });

  /* ---------- данные с другого устройства ---------- */
  Store.onStatus(renderStatus);
  Store.onData(d => {
    books = d.books;
    if (!state.loaded) return;
    if (state.view === 'list') renderAll();
    else if (state.view === 'book') {
      const b = byId(state.openId);
      const editing = document.activeElement && bookEl.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (!b) backToList();
      else if (!editing) renderBook(b, false);
    }
  });

  /* ---------- запуск ---------- */
  introHero();
  Store.load().then(d => {
    books = d.books;
    state.loaded = true;
    introList();
  });
})();
