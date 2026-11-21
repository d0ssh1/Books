/* Форматирование текста: разметка, отображение и маленький редактор.
   В данных хранится простая разметка, похожая на Markdown:
   **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~, ||спойлер||.
   Служебные символы в обычном тексте экранируются обратной косой чертой. */
window.Rich = (function () {
  'use strict';

  const MARK = { b: '**', i: '*', u: '__', s: '~~', p: '||' };
  const ORDER = ['b', 'i', 'u', 's', 'p'];
  const SPECIAL = '*_~|\\';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- разбор разметки ---------- */
  function tokenize(line) {
    const toks = [];
    let buf = '';
    const flush = () => { if (buf) { toks.push({ t: buf }); buf = ''; } };
    for (let i = 0; i < line.length;) {
      const c = line[i];
      if (c === '\\' && i + 1 < line.length && SPECIAL.includes(line[i + 1])) { buf += line[i + 1]; i += 2; continue; }
      const two = line.substr(i, 2);
      const m = two === '**' ? 'b' : two === '__' ? 'u' : two === '~~' ? 's' : two === '||' ? 'p' : null;
      if (m) { flush(); toks.push({ m, raw: two }); i += 2; continue; }
      if (c === '*') { flush(); toks.push({ m: 'i', raw: '*' }); i++; continue; }
      buf += c; i++;
    }
    flush();
    // Пара — ближайшая следующая такая же метка. Метка без пары остаётся обычным текстом.
    const open = {};
    toks.forEach((tk, idx) => {
      if (!tk.m) return;
      if (open[tk.m] != null) { toks[open[tk.m]].open = true; tk.close = true; delete open[tk.m]; }
      else open[tk.m] = idx;
    });
    return toks.map(tk => (tk.m && !tk.open && !tk.close) ? { t: tk.raw } : tk);
  }

  function render(line, tags) {
    const toks = tokenize(line);
    const stack = [];
    let out = '', group = 0, spGroup = 0;
    const open = m => { stack.push(m); if (m === 'p' && !spGroup) spGroup = ++group; out += tags.open(m, spGroup); };
    const close = m => { out += tags.close(m); };
    toks.forEach(tk => {
      if (!tk.m) { out += tags.text(tk.t); return; }
      if (tk.open) { if (tk.m === 'p') spGroup = 0; open(tk.m); return; }
      if (!stack.includes(tk.m)) return;
      const reopen = [];
      while (stack[stack.length - 1] !== tk.m) { const x = stack.pop(); close(x); reopen.push(x); }
      stack.pop(); close(tk.m);
      if (tk.m === 'p') spGroup = 0;
      reopen.reverse().forEach(x => { stack.push(x); out += tags.open(x, spGroup); });
    });
    while (stack.length) close(stack.pop());
    return out;
  }

  let uid = 0;
  const HTML = {
    text: esc,
    open: (m, g) => m === 'p'
      ? '<span class="spoiler" data-g="' + (uid + '-' + g) + '" role="button" tabindex="0" aria-expanded="false" aria-label="Спойлер. Нажми, чтобы показать">'
      : '<' + { b: 'strong', i: 'em', u: 'u', s: 's' }[m] + '>',
    close: m => m === 'p' ? '</span>' : '</' + { b: 'strong', i: 'em', u: 'u', s: 's' }[m] + '>'
  };
  const EDITOR = {
    text: esc,
    open: m => m === 'p' ? '<span class="sp">' : '<' + m + '>',
    close: m => m === 'p' ? '</span>' : '</' + m + '>'
  };
  const PLAIN = { text: s => s, open: () => '', close: () => '' };
  const MD = { text: s => s, open: m => ({ b: '**', i: '*', s: '~~', p: '||' }[m] || ''), close: m => ({ b: '**', i: '*', s: '~~', p: '||' }[m] || '') };

  const lines = text => String(text || '').split('\n');
  // Одна строка в HTML.
  function line(text) { uid++; return render(String(text || ''), HTML); }
  // Несколько строк в HTML, переносы сохраняются как \n (для блоков с white-space: pre-line).
  function html(text) { uid++; return lines(text).map(l => render(l, HTML)).join('\n'); }
  const plain = text => lines(text).map(l => render(l, PLAIN)).join('\n');
  const md = text => lines(text).map(l => render(l, MD)).join('\n');

  /* ---------- редактор -> разметка ---------- */
  const BLOCK = /^(DIV|P|LI|UL|OL|BLOCKQUOTE|H[1-6]|PRE|SECTION|ARTICLE)$/;
  function formatsOf(el, inherited) {
    const f = new Set(inherited);
    const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG') f.add('b');
    if (tag === 'I' || tag === 'EM') f.add('i');
    if (tag === 'U' || tag === 'INS') f.add('u');
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.add('s');
    if (el.classList && el.classList.contains('sp')) f.add('p');
    const st = el.style;
    if (st) {
      if (st.fontWeight === 'bold' || parseInt(st.fontWeight, 10) >= 600) f.add('b');
      if (st.fontStyle === 'italic') f.add('i');
      const deco = (st.textDecoration || '') + ' ' + (st.textDecorationLine || '');
      if (/underline/.test(deco)) f.add('u');
      if (/line-through/.test(deco)) f.add('s');
    }
    return f;
  }
  function serialize(root) {
    const out = [[]];
    const cur = () => out[out.length - 1];
    const br = () => out.push([]);
    (function walk(node, fmt) {
      node.childNodes.forEach(ch => {
        if (ch.nodeType === 3) {
          ch.nodeValue.replace(/ /g, ' ').split('\n').forEach((part, k) => { if (k) br(); if (part) cur().push({ t: part, f: fmt }); });
        } else if (ch.nodeType === 1) {
          if (ch.tagName === 'BR') { br(); return; }
          const block = BLOCK.test(ch.tagName);
          if (block && cur().length) br();
          walk(ch, formatsOf(ch, fmt));
          if (block && cur().length) br();
        }
      });
    })(root, new Set());
    const escText = s => s.replace(/[\\*_~|]/g, '\\$&');
    const text = out.map(runs => {
      const stack = [];
      let s = '';
      runs.forEach(r => {
        const want = ORDER.filter(m => r.f.has(m));
        let keep = 0;
        while (keep < stack.length && want.includes(stack[keep])) keep++;
        while (stack.length > keep) s += MARK[stack.pop()];
        want.forEach(m => { if (!stack.includes(m)) { stack.push(m); s += MARK[m]; } });
        s += escText(r.t);
      });
      while (stack.length) s += MARK[stack.pop()];
      return s.replace(/\s+$/, '');
    });
    while (text.length && !text[text.length - 1]) text.pop();
    while (text.length && !text[0]) text.shift();
    return text.join('\n');
  }
  function toEditorHTML(text) {
    if (!text) return '';
    return lines(text).map(l => '<div>' + (render(l, EDITOR) || '<br>') + '</div>').join('');
  }

  /* ---------- редактор ---------- */
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const MOD = isMac ? '⌘' : 'Ctrl+';
  const BUTTONS = [
    { cmd: 'b', label: 'Жирный', keys: MOD + 'B', face: '<b>Ж</b>' },
    { cmd: 'i', label: 'Курсив', keys: MOD + 'I', face: '<i>К</i>' },
    { cmd: 'u', label: 'Подчёркнутый', keys: MOD + 'U', face: '<u>Ч</u>' },
    { cmd: 's', label: 'Зачёркнутый', keys: MOD + 'Shift+X', face: '<s>З</s>' },
    { cmd: 'p', label: 'Спойлер', keys: MOD + 'Shift+P', face: '<span class="ed-sp-ico" aria-hidden="true"></span>Спойлер', wide: true }
  ];
  function editor(o) {
    const rows = o.rows || 3;
    return '<div class="rte">' +
      '<div class="ed-bar" role="toolbar" aria-label="Форматирование">' +
        BUTTONS.map(b => '<button type="button" class="ed-btn' + (b.wide ? ' wide' : '') + '" data-cmd="' + b.cmd + '" aria-pressed="false" title="' + b.label + ' (' + b.keys + ')" aria-label="' + b.label + '">' + b.face + '</button>').join('') +
      '</div>' +
      '<div class="ed-area inp' + (o.value ? '' : ' is-empty') + '" id="' + o.id + '" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true"' +
        ' aria-label="' + esc(o.label || '') + '" data-placeholder="' + esc(o.placeholder || '') + '" style="min-height:' + (rows * 1.5 + 1.2).toFixed(1) + 'em">' + toEditorHTML(o.value) + '</div>' +
    '</div>';
  }
  const areaOf = el => el && el.closest ? el.closest('.ed-area') : null;
  function refreshEmpty(area) { area.classList.toggle('is-empty', !area.textContent.trim()); }
  function value(area) { return area ? serialize(area) : ''; }
  function set(area, text) { if (!area) return; area.innerHTML = toEditorHTML(text); refreshEmpty(area); }
  function focusEnd(area) {
    if (!area) return;
    area.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(area);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function spoilerAt(node, area) {
    let el = node && node.nodeType === 3 ? node.parentNode : node;
    while (el && el !== area) { if (el.classList && el.classList.contains('sp')) return el; el = el.parentNode; }
    return null;
  }
  function unwrap(el) {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }
  function toggleSpoiler(area) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!area.contains(range.commonAncestorContainer)) return;
    const existing = spoilerAt(range.startContainer, area) || spoilerAt(range.endContainer, area);
    if (existing) { unwrap(existing); return; }
    if (range.collapsed) return;
    const frag = range.extractContents();
    frag.querySelectorAll('.sp').forEach(unwrap);
    const span = document.createElement('span');
    span.className = 'sp';
    span.appendChild(frag);
    range.insertNode(span);
    const r = document.createRange();
    r.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function apply(cmd, area) {
    area.focus({ preventScroll: true });
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* старые браузеры */ }
    if (cmd === 'p') toggleSpoiler(area);
    else document.execCommand({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[cmd], false, null);
    refreshEmpty(area);
    updateBar(area);
  }
  function updateBar(area) {
    const bar = area && area.parentNode.querySelector('.ed-bar');
    if (!bar) return;
    const sel = getSelection();
    const inside = sel.rangeCount && area.contains(sel.anchorNode);
    bar.querySelectorAll('.ed-btn').forEach(btn => {
      let on = false;
      if (inside) {
        const c = btn.dataset.cmd;
        if (c === 'p') on = !!spoilerAt(sel.anchorNode, area);
        else { try { on = document.queryCommandState({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[c]); } catch (e) { on = false; } }
      }
      btn.setAttribute('aria-pressed', on);
    });
  }

  document.addEventListener('keydown', e => {
    const area = areaOf(e.target);
    if (!area || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    // e.code, а не e.key: горячие клавиши работают и в русской раскладке.
    const map = e.shiftKey ? { KeyX: 's', KeyP: 'p' } : { KeyB: 'b', KeyI: 'i', KeyU: 'u' };
    const cmd = map[e.code];
    if (!cmd) return;
    e.preventDefault();
    apply(cmd, area);
  });
  document.addEventListener('mousedown', e => { if (e.target.closest('.ed-btn')) e.preventDefault(); });
  document.addEventListener('click', e => {
    const btn = e.target.closest('.ed-btn');
    if (btn) { const area = btn.closest('.rte').querySelector('.ed-area'); apply(btn.dataset.cmd, area); return; }
    const lbl = e.target.closest('label[for]');
    if (lbl) { const t = document.getElementById(lbl.htmlFor); if (t && t.classList.contains('ed-area')) focusEnd(t); }
  });
  document.addEventListener('paste', e => {
    const area = areaOf(e.target);
    if (!area) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  document.addEventListener('drop', e => { if (areaOf(e.target)) e.preventDefault(); });
  document.addEventListener('input', e => { const area = areaOf(e.target); if (area) refreshEmpty(area); });
  document.addEventListener('selectionchange', () => {
    const area = areaOf(document.activeElement);
    if (area) updateBar(area);
  });

  /* ---------- спойлеры при чтении ---------- */
  function toggleReveal(sp) {
    const open = !sp.classList.contains('open');
    const box = sp.parentNode.closest('p, blockquote, .cmt, .prose, .txt') || sp.parentNode;
    box.querySelectorAll('.spoiler[data-g="' + sp.dataset.g + '"]').forEach(x => {
      x.classList.toggle('open', open);
      x.setAttribute('aria-expanded', open);
      x.setAttribute('aria-label', open ? 'Спойлер открыт. Нажми, чтобы скрыть' : 'Спойлер. Нажми, чтобы показать');
    });
  }
  document.addEventListener('click', e => {
    const sp = e.target.closest('.spoiler');
    if (!sp) return;
    e.preventDefault();
    toggleReveal(sp);
  });
  document.addEventListener('keydown', e => {
    const sp = e.target.closest && e.target.closest('.spoiler');
    if (!sp || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggleReveal(sp);
  });

  return { html, line, plain, md, editor, value, set, focusEnd };
})();
