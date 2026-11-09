/* Хранилище: файл data/books.json в репозитории на GitHub.
   Каждое изменение уходит отдельным коммитом через GitHub API.
   Пока коммит не дошёл, копия лежит в браузере и отправится при следующем открытии. */
window.Store = (function () {
  'use strict';

  const CFG_KEY = 'prochitano:github';
  const CACHE_KEY = 'prochitano:cache';
  const API = 'https://api.github.com';

  const ls = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } }
  };

  const empty = () => ({ version: 1, updated: null, books: [], deleted: {} });
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      updated: d.updated || null,
      books: Array.isArray(d.books) ? d.books : [],
      deleted: d.deleted && typeof d.deleted === 'object' ? d.deleted : {}
    };
  }

  // На GitHub Pages адрес вида owner.github.io/repo подсказывает, куда сохранять.
  function guess() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return { owner: '', repo: '' };
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: seg && !/\.html?$/i.test(seg) ? seg : m[1] + '.github.io' };
  }

  let cfg = Object.assign({ branch: 'main', path: 'data/books.json', token: '' }, guess(), ls.get(CFG_KEY) || {});
  let data = empty();
  let sha = null;
  let pending = false;
  let queue = [];
  let rev = 0;
  let timer = null;
  let pushing = false;
  let lastSync = null;
  const subs = [];
  const dataSubs = [];
  let status = { state: 'loading' };

  function emit(state, extra) {
    status = Object.assign({ state, pending, lastSync }, extra || {});
    subs.forEach(f => f(status));
  }
  const emitData = () => dataSubs.forEach(f => f(data));
  const connected = () => !!(cfg.token && cfg.owner && cfg.repo);
  const saveCache = () => ls.set(CACHE_KEY, { data, pending, queue });

  class HttpError extends Error {
    constructor(statusCode, msg) { super(msg || 'HTTP ' + statusCode); this.status = statusCode; }
  }

  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64dec(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function headers(c, extra) {
    return Object.assign({
      'Authorization': 'Bearer ' + c.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, extra || {});
  }
  const contentsUrl = c => API + '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) +
    '/contents/' + c.path.split('/').map(encodeURIComponent).join('/');

  function parseFile(text) {
    try { return normalize(JSON.parse(text)); }
    catch (e) { throw new HttpError(0, 'Файл ' + cfg.path + ' повреждён: это не JSON'); }
  }

  async function apiGet() {
    const ref = '?ref=' + encodeURIComponent(cfg.branch);
    const r = await fetch(contentsUrl(cfg) + ref, { headers: headers(cfg), cache: 'no-store' });
    if (r.status === 404) return { data: empty(), sha: null };
    if (!r.ok) throw new HttpError(r.status);
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64dec(j.content);
    else {
      // Файлы больше 1 МБ API отдаёт только в «сыром» виде.
      const r2 = await fetch(contentsUrl(cfg) + ref, { headers: headers(cfg, { 'Accept': 'application/vnd.github.raw+json' }), cache: 'no-store' });
      if (!r2.ok) throw new HttpError(r2.status);
      text = await r2.text();
    }
    return { data: parseFile(text), sha: j.sha };
  }

  async function staticGet() {
    const r = await fetch(cfg.path + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) return { data: empty(), sha: null };
    if (!r.ok) throw new HttpError(r.status);
    return { data: parseFile(await r.text()), sha: null };
  }

  async function apiPut(text, message) {
    const body = { message, content: b64enc(text), branch: cfg.branch };
    if (sha) body.sha = sha;
    const r = await fetch(contentsUrl(cfg), {
      method: 'PUT',
      headers: headers(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new HttpError(r.status);
    const j = await r.json();
    return j.content && j.content.sha;
  }

  // Слияние двух версий: по каждой книге побеждает более свежая правка.
  function merge(remote, local) {
    const deleted = Object.assign({}, remote.deleted);
    Object.keys(local.deleted || {}).forEach(id => {
      if (!deleted[id] || local.deleted[id] > deleted[id]) deleted[id] = local.deleted[id];
    });
    const map = new Map();
    remote.books.forEach(b => map.set(b.id, b));
    local.books.forEach(b => {
      const r = map.get(b.id);
      if (!r || (b.updatedAt || '') >= (r.updatedAt || '')) map.set(b.id, b);
    });
    const books = Array.from(map.values()).filter(b => !(deleted[b.id] && deleted[b.id] >= (b.updatedAt || '')));
    return { version: 1, updated: local.updated || remote.updated, books, deleted };
  }

  async function load() {
    const cache = ls.get(CACHE_KEY);
    emit('loading');
    try {
      const remote = connected() ? await apiGet() : await staticGet();
      sha = remote.sha;
      if (connected() && cache && cache.pending && cache.data) {
        data = merge(remote.data, normalize(cache.data));
        pending = true;
        queue = cache.queue && cache.queue.length ? cache.queue : ['Обновил записи о книгах'];
        rev++;
        schedule(400);
      } else {
        data = remote.data;
        pending = false;
        queue = [];
      }
      if (connected()) lastSync = new Date();
      saveCache();
      emit(pending ? 'pending' : connected() ? 'synced' : 'readonly');
    } catch (e) {
      if (cache && cache.data) {
        data = normalize(cache.data);
        pending = !!cache.pending;
        queue = cache.queue || [];
      }
      emit(e.status === 401 || e.status === 403 ? 'auth' : 'offline', { error: e });
      if (pending && connected()) schedule(20000);
    }
    emitData();
    return data;
  }

  // Подтянуть свежие данные, если книги правили с другого устройства.
  async function refresh() {
    if (!connected() || pushing) return;
    try {
      const remote = await apiGet();
      if (remote.sha === sha) return;
      data = pending ? merge(remote.data, data) : remote.data;
      sha = remote.sha;
      lastSync = new Date();
      saveCache();
      emitData();
      emit(pending ? 'pending' : 'synced');
    } catch (e) { /* попробуем в следующий раз */ }
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(push, ms); }

  function commit(message) {
    if (!connected()) return false;
    data.updated = new Date().toISOString();
    pending = true;
    rev++;
    if (message && !queue.includes(message)) queue.push(message);
    saveCache();
    emit('pending');
    schedule(1500);
    return true;
  }

  function commitMessage(list) {
    if (list.length === 1) return list[0];
    if (!list.length) return 'Обновил записи о книгах';
    return 'Обновил записи о книгах\n\n' + list.map(m => '- ' + m).join('\n');
  }

  async function push() {
    if (!pending || !connected()) return;
    if (pushing) { schedule(800); return; }
    pushing = true;
    emit('saving');
    const startRev = rev;
    const sent = queue.slice();
    const message = commitMessage(sent);
    try {
      let newSha;
      try {
        newSha = await apiPut(JSON.stringify(data, null, 2) + '\n', message);
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        // Файл успели поменять с другого устройства: сливаем и пробуем ещё раз.
        const remote = await apiGet();
        data = merge(remote.data, data);
        sha = remote.sha;
        emitData();
        newSha = await apiPut(JSON.stringify(data, null, 2) + '\n', message);
      }
      sha = newSha || sha;
      lastSync = new Date();
      if (rev === startRev) { pending = false; queue = []; }
      else { queue = queue.filter(m => !sent.includes(m)); schedule(1200); }
      saveCache();
      emit(pending ? 'pending' : 'synced');
    } catch (e) {
      if (e.status === 401 || e.status === 403) emit('auth', { error: e });
      else { emit('offline', { error: e }); schedule(30000); }
    } finally {
      pushing = false;
    }
  }

  async function connect(next) {
    const c = Object.assign({}, cfg, next);
    c.owner = String(c.owner || '').trim();
    c.repo = String(c.repo || '').trim();
    c.branch = String(c.branch || 'main').trim() || 'main';
    c.token = String(c.token || '').trim();
    if (!c.owner || !c.repo) throw new Error('Укажи владельца и название репозитория.');
    if (!c.token) throw new Error('Вставь токен доступа.');
    const r = await fetch(API + '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo),
      { headers: headers(c), cache: 'no-store' });
    if (r.status === 401) throw new Error('GitHub не принял токен. Проверь, что скопировал его целиком и срок действия не истёк.');
    if (r.status === 404 || r.status === 403) throw new Error('Репозиторий не найден, или у токена нет к нему доступа. Проверь, что в настройках токена выбран репозиторий ' + c.repo + '.');
    if (!r.ok) throw new Error('GitHub ответил ошибкой ' + r.status + '. Попробуй ещё раз через минуту.');
    const j = await r.json();
    if (j.permissions && j.permissions.push === false) throw new Error('У этого аккаунта нет права записи в репозиторий.');
    cfg = c;
    ls.set(CFG_KEY, cfg);
    await load();
  }

  function disconnect() {
    cfg = Object.assign({}, cfg, { token: '' });
    ls.set(CFG_KEY, cfg);
    emit('readonly');
  }

  // Удаление книги оставляет отметку, чтобы она не вернулась с другого устройства.
  function removeBook(id) {
    data.books = data.books.filter(b => b.id !== id);
    data.deleted[id] = new Date().toISOString();
  }
  function addBook(b) { data.books.push(b); }
  function importBooks(list) {
    const now = new Date().toISOString();
    const incoming = { version: 1, updated: now, books: list.map(b => Object.assign({}, b, { updatedAt: b.updatedAt || now })), deleted: {} };
    data = merge(data, incoming);
    emitData();
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending) push();
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('beforeunload', e => {
    if (pending) { e.preventDefault(); e.returnValue = ''; }
  });

  return {
    load, refresh, commit, connect, disconnect, removeBook, addBook, importBooks,
    get data() { return data; },
    get config() { return Object.assign({}, cfg, { token: cfg.token ? '••••' : '' }); },
    get status() { return status; },
    connected,
    onStatus(f) { subs.push(f); },
    onData(f) { dataSubs.push(f); }
  };
})();
