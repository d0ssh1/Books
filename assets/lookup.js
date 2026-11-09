/* Поиск книг в Google Books и Open Library и определение жанров. */
window.Lookup = (function () {
  'use strict';

  const GENRES = [
    'Классика', 'Современная проза', 'Фантастика', 'Фэнтези', 'Антиутопия', 'Мистика',
    'Магический реализм', 'Сатира', 'Юмор', 'Детектив', 'Триллер', 'Ужасы', 'Роман о любви',
    'Исторический роман', 'Приключения', 'Поэзия', 'Драматургия', 'Биография и мемуары',
    'История', 'Философия', 'Психология', 'Научпоп', 'Бизнес', 'Саморазвитие', 'Эссе',
    'Детская литература', 'Комиксы и манга'
  ];

  // Жанры художественной литературы: для них можно опираться и на описание книги.
  const FICTION = new Set(['Фантастика', 'Фэнтези', 'Антиутопия', 'Мистика', 'Магический реализм', 'Сатира',
    'Юмор', 'Детектив', 'Триллер', 'Ужасы', 'Роман о любви', 'Исторический роман', 'Приключения']);
  // Жанры нон-фикшна: у романов их ставим только по прямой категории из Google Books.
  const NONFICTION = new Set(['История', 'Философия', 'Психология', 'Научпоп', 'Бизнес', 'Саморазвитие', 'Эссе', 'Биография и мемуары']);

  const RULES = [
    ['Классика', /\bclassics?\b|classic literature|классическ/],
    ['Фантастика', /science fiction|sci-fi|space opera|cyberpunk|time travel|научн\w* фантаст|фантастик/],
    ['Фэнтези', /\bfantasy\b|фэнтези|wizards?|dragons?|волшебник/],
    ['Антиутопия', /dystopi|антиутоп|totalitarian/],
    ['Мистика', /occult|supernatural|paranormal|ghost|мистик|потусторонн/],
    ['Магический реализм', /magic(al)? realism|магическ\w* реализм/],
    ['Сатира', /satire|satirical|сатир/],
    ['Юмор', /\bhumou?r|humorous|юмор|comic novel/],
    ['Детектив', /detective|mystery fiction|crime fiction|police procedural|детектив/],
    ['Триллер', /thriller|suspense|триллер/],
    ['Ужасы', /\bhorror|ужас/],
    ['Роман о любви', /\bromance\b|love stor|любовн\w* роман|роман о любви/],
    ['Исторический роман', /historical fiction|исторически\w* роман/],
    ['Приключения', /adventure|приключен/],
    ['Поэзия', /poetry|poems|\bverse\b|стихотвор|поэзи|поэм/],
    ['Драматургия', /^drama\b|\bplays\b|пьес|драматург/],
    ['Биография и мемуары', /biograph|autobiograph|memoir|мемуар|биограф|воспоминани/],
    ['История', /\bhistory\b|historical studies|всемирн\w* истори|истори\w* (стран|человечеств|цивилизац)/],
    ['Философия', /philosoph|философ/],
    ['Психология', /psycholog(?!ical fiction)|психолог(?!ическ\w* роман)/],
    ['Научпоп', /popular science|\bscience\b|scientific|evolution|biology|physics|astronomy|neuroscience|научно-популяр|научпоп|эволюц|физик|биолог/],
    ['Бизнес', /business|economics|management|marketing|investing|finance|бизнес|экономик|маркетинг|менеджмент|инвестиц/],
    ['Саморазвитие', /self-help|self-improvement|personal growth|personal development|motivation|habits|саморазвит|привычк|мотивац|личн\w* эффективн/],
    ['Эссе', /\bessays?\b|эссе|публицист/],
    ['Детская литература', /juvenile|children|детск|для детей/],
    ['Комиксы и манга', /comics|graphic novel|\bmanga\b|манга|комикс/]
  ];

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const surname = a => { const p = String(a || '').trim().split(/[\s,]+/).filter(Boolean); return p[p.length - 1] || ''; };
  const stripHtml = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  async function getJSON(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 9000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function searchGoogle(q) {
    const url = 'https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) +
      '&maxResults=12&printType=books&orderBy=relevance';
    const j = await getJSON(url);
    return (j.items || []).map(it => {
      const v = it.volumeInfo || {};
      return {
        source: 'Google Books',
        title: v.title || '',
        author: (v.authors || []).join(', '),
        year: parseInt(String(v.publishedDate || '').slice(0, 4), 10) || null,
        pages: v.pageCount || null,
        categories: v.categories || [],
        subjects: [],
        description: stripHtml(v.description),
        lang: v.language || ''
      };
    }).filter(r => r.title);
  }

  async function searchOpenLibrary(q) {
    const url = 'https://openlibrary.org/search.json?q=' + encodeURIComponent(q) +
      '&limit=8&fields=title,author_name,first_publish_year,number_of_pages_median,subject';
    const j = await getJSON(url);
    return (j.docs || []).map(d => ({
      source: 'Open Library',
      title: d.title || '',
      author: (d.author_name || []).slice(0, 2).join(', '),
      year: d.first_publish_year || null,
      firstYear: d.first_publish_year || null,
      pages: d.number_of_pages_median || null,
      categories: [],
      subjects: (d.subject || []).slice(0, 60),
      description: '',
      lang: ''
    })).filter(r => r.title);
  }

  async function search(q) {
    const [g, o] = await Promise.allSettled([searchGoogle(q), searchOpenLibrary(q)]);
    if (g.status === 'rejected' && o.status === 'rejected') throw new Error('network');
    const gr = g.status === 'fulfilled' ? g.value : [];
    const or = o.status === 'fulfilled' ? o.value : [];
    // Русские издания вперёд, остальное по релевантности.
    gr.sort((a, b) => (b.lang === 'ru') - (a.lang === 'ru'));
    const seen = new Map();
    const out = [];
    gr.concat(or).forEach(r => {
      const key = norm(r.title).replace(/[^a-zа-я0-9]/g, '') + '|' + norm(surname(r.author));
      const prev = seen.get(key);
      if (prev) {
        // Дополняем уже найденное: страницы, год, категории.
        if (!prev.pages && r.pages) prev.pages = r.pages;
        if (r.firstYear && (!prev.firstYear || r.firstYear < prev.firstYear)) prev.firstYear = r.firstYear;
        if (r.subjects.length && !prev.subjects.length) prev.subjects = r.subjects;
        if (r.categories.length && !prev.categories.length) prev.categories = r.categories;
        if (!prev.description && r.description) prev.description = r.description;
        return;
      }
      seen.set(key, r);
      out.push(r);
    });
    return out.slice(0, 8);
  }

  // Год первой публикации и тематики из Open Library, затем жанры.
  async function enrich(r) {
    let firstYear = r.firstYear || null;
    let subjects = r.subjects || [];
    if (!firstYear || !subjects.length) {
      try {
        const url = 'https://openlibrary.org/search.json?title=' + encodeURIComponent(r.title) +
          (r.author ? '&author=' + encodeURIComponent(surname(r.author)) : '') +
          '&limit=3&fields=title,first_publish_year,subject';
        const j = await getJSON(url, 7000);
        const d = (j.docs || [])[0];
        if (d) {
          if (!firstYear && d.first_publish_year) firstYear = d.first_publish_year;
          if (!subjects.length) subjects = (d.subject || []).slice(0, 60);
        }
      } catch (e) { /* без Open Library обойдёмся */ }
    }
    const year = firstYear && (!r.year || firstYear < r.year) ? firstYear : r.year;
    const genres = detectGenres({ categories: r.categories || [], subjects, description: r.description || '', year });
    return { year: year || null, genres };
  }

  function detectGenres({ categories, subjects, description, year }) {
    const cat = norm(categories.join(' | '));
    const subj = norm(subjects.join(' | '));
    const desc = norm(description);
    const all = cat + ' | ' + subj;
    const isFiction = /fiction|novel|роман|проза|повест|рассказ/.test(all) || /\bроман\b|повесть/.test(desc);
    const score = {};
    const add = (g, n) => { score[g] = (score[g] || 0) + n; };
    const noSF = s => s.replace(/science fiction|научн\w* фантаст\w*/g, ' ');

    RULES.forEach(([g, re]) => {
      const test = s => re.test(g === 'Научпоп' ? noSF(s) : s);
      if (NONFICTION.has(g) && isFiction) {
        if (test(cat)) add(g, 3);
        return;
      }
      if (test(cat)) add(g, 3);
      if (test(subj)) add(g, 3);
      if (test(desc)) add(g, 1);
    });

    if (isFiction && year && year <= 1945) add('Классика', 3);
    const hasFictionGenre = Object.keys(score).some(g => FICTION.has(g) && score[g] >= 2);
    if (isFiction && !hasFictionGenre && !(score['Классика'] >= 2)) add('Современная проза', 2);

    return Object.keys(score)
      .filter(g => score[g] >= 2)
      .sort((a, b) => score[b] - score[a] || GENRES.indexOf(a) - GENRES.indexOf(b))
      .slice(0, 3);
  }

  return { GENRES, search, enrich, detectGenres };
})();
