/* Поиск книг и определение жанров.
   Источники: Wikidata (русские названия, авторы, год первой публикации, жанры),
   Open Library (русские издания, число страниц, темы) и Google Books, если указан свой ключ. */
window.Lookup = (function () {
  'use strict';

  const GENRES = [
    'Классика', 'Современная проза', 'Психологическая проза', 'Фантастика', 'Фэнтези', 'Антиутопия',
    'Постапокалипсис', 'Мистика', 'Магический реализм', 'Сатира', 'Юмор', 'Детектив', 'Триллер', 'Ужасы',
    'Роман о любви', 'Исторический роман', 'Военная проза', 'Приключения', 'Young Adult', 'Рассказы',
    'Притча', 'Поэзия', 'Драматургия', 'Биография и мемуары', 'История', 'Философия', 'Психология',
    'Научпоп', 'Бизнес', 'Саморазвитие', 'Публицистика', 'Эссе', 'Путешествия', 'Детская литература',
    'Комиксы и манга'
  ];

  // Художественные жанры можно угадывать и по описанию книги.
  const FICTION = new Set(['Фантастика', 'Фэнтези', 'Антиутопия', 'Постапокалипсис', 'Мистика', 'Магический реализм',
    'Сатира', 'Юмор', 'Детектив', 'Триллер', 'Ужасы', 'Роман о любви', 'Исторический роман', 'Военная проза',
    'Приключения', 'Психологическая проза', 'Young Adult', 'Рассказы', 'Притча']);
  // Нон-фикшн у романов ставим только по прямому указанию источника, не по темам.
  const NONFICTION = new Set(['История', 'Философия', 'Психология', 'Научпоп', 'Бизнес', 'Саморазвитие',
    'Публицистика', 'Эссе', 'Биография и мемуары', 'Путешествия']);

  const STRICT = new Set(['Комиксы и манга', 'Детская литература']);
  const RULES = [
    ['Классика', /\bclassics?\b|classic (fiction|literature)|классическ/],
    ['Психологическая проза', /psychological (fiction|novel)|confessional|психологическ\w* (роман|проз)|исповед/],
    ['Фантастика', /science fiction|sci-fi|space opera|cyberpunk|(?<!non-)time travel|научн\w* фантаст|фантастик|киберпанк|космическ\w* опер/],
    ['Фэнтези', /\bfantasy\b|фэнтези|wizards?|dragons?|волшебник/],
    ['Антиутопия', /dystopi|антиутоп|totalitarian/],
    ['Постапокалипсис', /post-?apocalyp|постапокалип/],
    ['Мистика', /occult|supernatural|paranormal|ghost|мистик|потусторонн/],
    ['Магический реализм', /magic(al)? realism|магическ\w* реализм|фантастическ\w* реализм|fantastic realism/],
    ['Сатира', /satire|satirical|сатир/],
    ['Юмор', /\bhumou?r|humorous|юмор|comic novel|комическ/],
    ['Детектив', /detective|mystery fiction|crime fiction|police procedural|детектив/],
    ['Триллер', /thriller|suspense|триллер/],
    ['Ужасы', /\bhorror|ужас/],
    ['Роман о любви', /\bromance\b|romance fiction|love stor|любовн\w* роман|роман о любви|романтическ/],
    ['Исторический роман', /historical (fiction|novel)|исторически\w* роман/],
    ['Военная проза', /war (fiction|novel|stories)|military fiction|военн\w* (роман|проз|литератур)/],
    ['Приключения', /adventure|приключен/],
    ['Young Adult', /young adult|juvenile fiction|подростков|юношеск/],
    ['Рассказы', /short stor|сборник рассказов|сборник новелл/],
    ['Притча', /parable|притч/],
    ['Поэзия', /poetry|poems|\bverse\b|стихотвор|поэзи|поэм/],
    ['Драматургия', /^drama\b|\bplays?\b|пьес|драматург/],
    ['Биография и мемуары', /biograph|autobiograph|memoir|мемуар|биограф|воспоминани/],
    ['История', /\bhistory\b|world history|всемирн\w* истори|истори\w* (стран|человечеств|цивилизац)/],
    ['Философия', /philosoph|философ/],
    ['Психология', /psycholog(?!ical (fiction|novel|thriller))|психолог(?!ическ\w* (роман|проз|триллер))/],
    ['Научпоп', /popular science|\bscience\b|scientific|evolution|biology|physics|astronomy|neuroscience|научно-популяр|научпоп|эволюц|физик|биолог/],
    ['Бизнес', /business|economics|management|marketing|investing|finance|бизнес|экономик|маркетинг|менеджмент|инвестиц/],
    ['Саморазвитие', /self-help|self-improvement|personal growth|personal development|motivation|habits|саморазвит|привычк|мотивац|личн\w* эффективн/],
    ['Публицистика', /journalism|публицист/],
    ['Эссе', /\bessays?\b|эссе/],
    ['Путешествия', /(?<!time )travel(?! fiction)|путешеств/],
    ['Детская литература', /children'?s (books|literature|stories)|детск\w* литератур|для детей/],
    ['Комиксы и манга', /comics|graphic novel|\bmanga\b|манга|комикс/]
  ];

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const keyPart = s => norm(s).replace(/[^a-zа-я0-9]/g, '');
  const surname = a => { const p = String(a || '').split(',')[0].trim().split(/\s+/).filter(Boolean); return p[p.length - 1] || ''; };
  const stripHtml = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const NOW = new Date().getFullYear();
  const okYear = y => (y && y >= 1450 && y <= NOW + 1) ? y : null;
  // «Владимир Владимирович Набоков» → «Владимир Набоков»
  const shortName = n => {
    const p = String(n || '').trim().split(/\s+/);
    return p.length === 3 && /(вич|вна|ична|ич)$/i.test(p[1]) ? p[0] + ' ' + p[2] : String(n || '').trim();
  };

  async function getJSON(url, ms, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 9000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* ---------- Wikidata ---------- */
  function wdQuery(search) {
    return 'SELECT ?item ?ord ?ru ?en ?desc ?authorRu ?authorEn ?date ?pages ?links ?genreRu ?genreEn WHERE {\n' +
      ' SERVICE wikibase:mwapi { bd:serviceParam wikibase:api "Search"; wikibase:endpoint "www.wikidata.org"; ' +
      'mwapi:srsearch ' + JSON.stringify(search + ' haswbstatement:P50') + '; mwapi:srlimit "12". ' +
      '?item wikibase:apiOutputItem mwapi:title. ?ord wikibase:apiOrdinal true. }\n' +
      ' ?item wdt:P31 ?cls . ?cls wdt:P279* ?root . VALUES ?root { wd:Q7725634 wd:Q571 }\n' +
      ' ?item wikibase:sitelinks ?links .\n' +
      ' OPTIONAL { ?item rdfs:label ?ru FILTER(LANG(?ru)="ru") }\n' +
      ' OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en)="en") }\n' +
      ' OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc)="ru") }\n' +
      ' OPTIONAL { ?item wdt:P50 ?a. OPTIONAL { ?a rdfs:label ?authorRu FILTER(LANG(?authorRu)="ru") } OPTIONAL { ?a rdfs:label ?authorEn FILTER(LANG(?authorEn)="en") } }\n' +
      ' OPTIONAL { ?item wdt:P577 ?date }\n' +
      ' OPTIONAL { ?item wdt:P1104 ?pages }\n' +
      ' OPTIONAL { { ?item wdt:P136 ?g } UNION { ?item wdt:P7937 ?g } OPTIONAL { ?g rdfs:label ?genreRu FILTER(LANG(?genreRu)="ru") } OPTIONAL { ?g rdfs:label ?genreEn FILTER(LANG(?genreEn)="en") } }\n' +
      '} ORDER BY ?ord LIMIT 300';
  }
  async function searchWikidata(q) {
    const j = await getJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(wdQuery(q)), 12000,
      { headers: { Accept: 'application/sparql-results+json' } });
    const map = new Map();
    j.results.bindings.forEach(b => {
      const v = k => b[k] ? b[k].value : '';
      const id = v('item').split('/').pop();
      let o = map.get(id);
      if (!o) {
        o = {
          source: 'Wikidata', wd: id, ord: Number(v('ord')),
          title: v('ru') || v('en'), titleEn: v('en'),
          author: shortName(v('authorRu') || v('authorEn')), authorEn: v('authorEn'),
          year: null, years: [], pages: Number(v('pages')) || null, links: Number(v('links')) || 0,
          wdGenres: new Set(), categories: [], subjects: [], description: v('desc')
        };
        map.set(id, o);
      }
      const y = okYear(parseInt(v('date').slice(0, 4), 10));
      if (y && !o.years.includes(y)) o.years.push(y);
      if (y && (!o.year || y < o.year)) o.year = y;
      if (v('genreRu')) o.wdGenres.add(v('genreRu'));
      if (v('genreEn')) o.wdGenres.add(v('genreEn'));
    });
    return Array.from(map.values()).sort((a, b) => a.ord - b.ord)
      .map(o => Object.assign(o, { firstYear: o.year, wdGenres: Array.from(o.wdGenres) }));
  }

  // Русское имя автора по латинскому написанию.
  const authorCache = new Map();
  async function russianAuthor(name) {
    if (!name || /[а-яё]/i.test(name)) return name;
    if (authorCache.has(name)) return authorCache.get(name);
    const p = getJSON('https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&type=item&limit=1&language=en&uselang=ru&search=' +
      encodeURIComponent(name), 6000).then(j => {
      const s = j.search && j.search[0];
      const lbl = s && s.display && s.display.label;
      return lbl && lbl.language === 'ru' ? shortName(lbl.value) : name;
    }).catch(() => name);
    authorCache.set(name, p);
    return p;
  }

  /* ---------- Open Library ---------- */
  function olDoc(d) {
    const ed = d.editions && d.editions.docs && d.editions.docs.find(e => (e.language || []).includes('rus') && e.title);
    return {
      source: 'Open Library',
      title: ed ? ed.title : (d.title || ''),
      titleEn: d.title || '',
      author: (d.author_name || []).slice(0, 2).join(', '),
      year: okYear(d.first_publish_year),
      firstYear: okYear(d.first_publish_year),
      pages: d.number_of_pages_median || null,
      categories: [], wdGenres: [],
      subjects: (d.subject || []).slice(0, 60),
      description: '', links: 0
    };
  }
  const OL_FIELDS = 'key,title,author_name,first_publish_year,number_of_pages_median,subject,editions,editions.title,editions.language';
  async function searchOpenLibrary(q) {
    const j = await getJSON('https://openlibrary.org/search.json?q=' + encodeURIComponent(q) + '&lang=ru&limit=8&fields=' + OL_FIELDS);
    return (j.docs || []).map(olDoc).filter(r => r.title);
  }
  async function openLibraryByTitle(title, author) {
    const j = await getJSON('https://openlibrary.org/search.json?title=' + encodeURIComponent(title) +
      (author ? '&author=' + encodeURIComponent(surname(author)) : '') + '&lang=ru&limit=3&fields=' + OL_FIELDS, 8000);
    return (j.docs || []).map(olDoc);
  }

  /* ---------- Google Books (только со своим ключом: общий лимит без ключа почти всегда исчерпан) ---------- */
  const GB_KEY = 'prochitano:gbooks';
  function googleKey() { try { return localStorage.getItem(GB_KEY) || ''; } catch (e) { return ''; } }
  function setGoogleKey(k) { try { if (k) localStorage.setItem(GB_KEY, k); else localStorage.removeItem(GB_KEY); } catch (e) { /* недоступно */ } }
  async function searchGoogle(q) {
    const key = googleKey();
    if (!key) return [];
    const j = await getJSON('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) +
      '&maxResults=10&printType=books&orderBy=relevance&key=' + encodeURIComponent(key));
    return (j.items || []).map(it => {
      const v = it.volumeInfo || {};
      return {
        source: 'Google Books', lang: v.language || '',
        title: v.title || '', titleEn: '',
        author: (v.authors || []).join(', '),
        year: okYear(parseInt(String(v.publishedDate || '').slice(0, 4), 10)),
        pages: v.pageCount || null,
        categories: v.categories || [], subjects: [], wdGenres: [],
        description: stripHtml(v.description), links: 0
      };
    }).filter(r => r.title).sort((a, b) => (b.lang === 'ru') - (a.lang === 'ru'));
  }

  /* ---------- общий поиск ---------- */
  function keysOf(r) {
    const ks = new Set();
    [r.title, r.titleEn].filter(Boolean).forEach(t => [r.author, r.authorEn].filter(Boolean).forEach(a => ks.add(keyPart(t) + '|' + keyPart(surname(a)))));
    return ks;
  }
  function absorb(into, r) {
    if (!into.pages && r.pages) into.pages = r.pages;
    // Год из Wikidata надёжнее: в Open Library у старых книг встречаются ошибки вроде 1777 года у «Лолиты».
    if (r.firstYear && (!into.firstYear || (into.source !== 'Wikidata' && r.firstYear < into.firstYear))) into.firstYear = r.firstYear;
    if (!into.year && r.year) into.year = r.year;
    if (r.subjects.length && !into.subjects.length) into.subjects = r.subjects;
    if (r.categories.length && !into.categories.length) into.categories = r.categories;
    if (!into.description && r.description) into.description = r.description;
  }
  // Насколько название похоже на запрос: точное совпадение выше частичного.
  function titleScore(r, q) {
    const nq = keyPart(q);
    let best = 0;
    [r.title, r.titleEn].filter(Boolean).forEach(t => {
      const nt = keyPart(t);
      if (!nt) return;
      let sc = 0;
      if (nt === nq) sc = 3;
      else if (nq.startsWith(nt) || nt.startsWith(nq)) sc = 2;
      else if (nq.includes(nt) || nt.includes(nq)) sc = 1;
      best = Math.max(best, sc);
    });
    if (/[а-яё]/i.test(q) && /[а-яё]/i.test(r.title)) best += 0.5;
    if (r.source === 'Wikidata') best += 0.3;
    return best;
  }
  async function search(q) {
    let found = await searchOnce(q);
    // «1984 Оруэлл»: если ничего не нашлось, пробуем без первого или последнего слова и оставляем книги нужного автора.
    const words = q.trim().split(/\s+/);
    if (!found.length && words.length > 1) {
      const tries = [[words.slice(0, -1).join(' '), words[words.length - 1]], [words.slice(1).join(' '), words[0]]];
      for (const [rest, dropped] of tries) {
        const list = await searchOnce(rest);
        const stem = norm(dropped).slice(0, Math.max(3, Math.min(5, dropped.length - 1)));
        const match = list.filter(r => norm(r.author).includes(stem) || norm(r.authorEn).includes(stem));
        if (match.length) { found = match; break; }
      }
    }
    return found;
  }
  async function searchOnce(q) {
    const [wd, gb, ol] = await Promise.allSettled([searchWikidata(q), searchGoogle(q), searchOpenLibrary(q)]);
    if (wd.status === 'rejected' && ol.status === 'rejected' && (gb.status === 'rejected' || !googleKey())) throw new Error('network');
    const pick = s => s.status === 'fulfilled' ? s.value : [];
    const out = [];
    const index = new Map();
    pick(wd).concat(pick(gb), pick(ol)).forEach(r => {
      const ks = keysOf(r);
      const prev = Array.from(ks).map(k => index.get(k)).find(Boolean);
      if (prev) { absorb(prev, r); ks.forEach(k => index.set(k, prev)); return; }
      ks.forEach(k => index.set(k, r));
      out.push(r);
    });
    out.forEach((r, i) => { r._i = i; r._s = titleScore(r, q); });
    out.sort((a, b) => b._s - a._s || a._i - b._i);
    const top = out.slice(0, 8);
    await Promise.all(top.map(async r => { r.author = (await Promise.all(r.author.split(', ').map(russianAuthor))).join(', '); }));
    return top;
  }

  // Детали для выбранной книги: год первой публикации, страницы, жанры.
  async function enrich(r) {
    const tasks = [];
    if (r.source === 'Wikidata' && (r.titleEn || r.title)) {
      tasks.push(openLibraryByTitle(r.titleEn || r.title, r.authorEn || r.author).then(list => {
        const best = list[0];
        if (!best) return;
        absorb(r, best);
        // У некоторых книг в Wikidata несколько дат (у «Мастера и Маргариты» 1928 и 1967): берём ближайшую к Open Library.
        if (r.years && r.years.length > 1 && best.firstYear) {
          r.firstYear = r.years.reduce((a, b) => Math.abs(b - best.firstYear) < Math.abs(a - best.firstYear) ? b : a);
        }
        // Если Open Library знает чуть более ранний год, это обычно первая публикация (у «Преступления и наказания» 1866, а не 1886).
        if (best.firstYear && r.firstYear && best.firstYear < r.firstYear && r.firstYear - best.firstYear <= 40) r.firstYear = best.firstYear;
      }).catch(() => {}));
    }
    if (r.source !== 'Wikidata') {
      tasks.push(searchWikidata(r.title + ' ' + surname(r.author)).then(list => {
        const hit = list.find(x => keyPart(x.title) === keyPart(r.title) || (x.titleEn && keyPart(x.titleEn) === keyPart(r.titleEn || r.title)));
        if (!hit) return;
        r.wdGenres = hit.wdGenres; r.links = hit.links;
        if (hit.year) r.firstYear = hit.year;
        if (!r.pages && hit.pages) r.pages = hit.pages;
      }).catch(() => {}));
    }
    await Promise.all(tasks);
    const year = r.firstYear || r.year || null;
    return { year, pages: r.pages || null, genres: detectGenres(r, year) };
  }

  function detectGenres(r, year) {
    const wd = norm((r.wdGenres || []).join(' | '));
    const cat = norm((r.categories || []).join(' | '));
    const subj = norm((r.subjects || []).join(' | '));
    const desc = norm(r.description);
    const all = wd + ' | ' + cat + ' | ' + subj;
    // Художественная книга или нет: сравниваем признаки по каждому источнику, а не ищем одно слово.
    const FIC = /fiction|novel|роман|проза|повест|рассказ|stories/;
    const NONFIC = /non-?fiction|нон-?фикшн|history|histoire|historia|science|biograph|self-help|psycholog|business|philosoph|essays|научн|истори/;
    const clean = x => norm(x).replace(/non-?fiction|graphic novels?|comics & graphic/g, m => m.startsWith('non') ? 'nonfic' : ' ');
    let fic = 0, non = 0;
    (r.subjects || []).forEach(x => { const c = clean(x); if (FIC.test(c)) fic++; if (/nonfic/.test(c) || NONFIC.test(c)) non++; });
    [wd, cat].forEach(x => { const c = clean(x); if (FIC.test(c)) fic += 3; if (/nonfic/.test(c) || NONFIC.test(c)) non += 3; });
    if (/\bроман\b|повесть/.test(desc)) fic += 2;
    const isFiction = fic > non;
    const score = {};
    const add = (g, n) => { score[g] = (score[g] || 0) + n; };
    const noSF = s => s.replace(/science fiction|научн\w* фантаст\w*/g, ' ');
    RULES.forEach(([g, re]) => {
      const hit = s => s && re.test(g === 'Научпоп' ? noSF(s) : s);
      if (hit(wd)) add(g, 2);
      if (hit(cat)) add(g, 2);
      if (NONFICTION.has(g) && isFiction) return;
      const n = (r.subjects || []).filter(x => hit(norm(x))).length;
      // Комиксы и детские книги по одним только темам не ставим: у известных книг часто есть комикс-адаптации.
      if (n && !(STRICT.has(g) && n < 3)) add(g, 1.5 * Math.min(n, 2));
      if (FICTION.has(g) || !isFiction) { if (hit(desc)) add(g, 1); }
    });
    // Классика: старые книги и известные книги прошлого века (их статьи есть во многих Википедиях).
    if (isFiction && year && (year <= 1945 || (year <= 1985 && (r.links || 0) >= 30))) add('Классика', 3);
    const hasFiction = Object.keys(score).some(g => FICTION.has(g) && score[g] >= 2);
    if (isFiction && !hasFiction && !(score['Классика'] >= 2)) add('Современная проза', 2);
    return Object.keys(score)
      .filter(g => score[g] >= 2)
      .sort((a, b) => score[b] - score[a] || GENRES.indexOf(a) - GENRES.indexOf(b))
      .slice(0, 3);
  }

  return { GENRES, search, enrich, detectGenres, googleKey, setGoogleKey };
})();
