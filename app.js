// UI + dictionary + orchestration.
(function () {
  'use strict';

  const { Trie, scoreWord, solve } = window.BoggleSolver;

  // --- DOM refs -----------------------------------------------------------
  const gridEl = document.getElementById('grid');
  const sizeEl = document.getElementById('size');
  const minLenEl = document.getElementById('minLen');
  const solveBtn = document.getElementById('solve');
  const clearBtn = document.getElementById('clear');
  const randomBtn = document.getElementById('random');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');
  const summaryEl = document.getElementById('summary');
  const wordListEl = document.getElementById('wordList');
  const filterEl = document.getElementById('filter');

  // --- State --------------------------------------------------------------
  let size = 4;
  let cells = [];
  let dictionary = null;
  let fullTrie = null;
  let lastResults = null;
  let activeWord = null;

  // --- Grid rendering -----------------------------------------------------
  function renderGrid(n) {
    size = n;
    gridEl.dataset.size = String(n);
    gridEl.innerHTML = '';
    cells = [];
    for (let i = 0; i < n * n; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'cell';
      wrap.dataset.index = i;

      const order = document.createElement('span');
      order.className = 'order';
      wrap.appendChild(order);

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'text';
      input.autocapitalize = 'characters';
      input.autocomplete = 'off';
      input.autocorrect = 'off';
      input.spellcheck = false;
      input.maxLength = 2;
      input.dataset.index = i;
      wrap.appendChild(input);

      gridEl.appendChild(wrap);
      cells.push(input);
    }
    wireCellEvents();
    cells[0]?.focus();
  }

  function wireCellEvents() {
    cells.forEach((input, i) => {
      input.addEventListener('input', (e) => {
        const isDelete = e.inputType && e.inputType.startsWith('delete');
        const v = input.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
        if (!v) { input.value = ''; return; }
        if (isDelete) { input.value = v; return; }
        if (v === 'Q') {
          input.value = 'QU';
        } else {
          input.value = v[v.length - 1];
        }
        moveFocus(i + 1);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value) {
          e.preventDefault();
          moveFocus(i - 1, { select: true });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); moveFocus(i + 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); moveFocus(i - 1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); moveFocus(i + size);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); moveFocus(i - size);
        } else if (e.key === 'Enter') {
          e.preventDefault(); solveBtn.click();
        }
      });

      input.addEventListener('focus', () => input.select());

      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;
        e.preventDefault();
        fillFromText(text, i);
      });
    });
  }

  function moveFocus(i, opts = {}) {
    if (i < 0 || i >= cells.length) return;
    cells[i].focus();
    if (opts.select) cells[i].select();
  }

  function fillFromText(text, startAt = 0) {
    const tokens = [];
    const up = text.toUpperCase();
    let i = 0;
    while (i < up.length && tokens.length < cells.length - startAt) {
      const ch = up[i];
      if (ch < 'A' || ch > 'Z') { i++; continue; }
      if (ch === 'Q' && up[i + 1] === 'U') {
        tokens.push('QU'); i += 2;
      } else {
        tokens.push(ch); i += 1;
      }
    }
    tokens.forEach((tok, k) => {
      const idx = startAt + k;
      if (idx < cells.length) cells[idx].value = tok;
    });
    const landing = Math.min(startAt + tokens.length, cells.length - 1);
    moveFocus(landing);
  }

  // --- Dictionary ---------------------------------------------------------
  // SOWPODS (Collins Scrabble Words) — ~178k Scrabble-valid words. Tighter
  // than a general English corpus, so the word list is recognisable and the
  // per-word definition lookups hit far more often.
  const DICT_URL = 'https://raw.githubusercontent.com/jonbcard/scrabble-bot/master/src/dictionary.txt';
  const DB_NAME = 'boggle-solver';
  const STORE = 'kv';
  const DICT_KEY = 'dict-sowpods-v1';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbGet(key) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  function idbPut(key, value) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function buildFullTrie() {
    if (!dictionary) return;
    const trie = new Trie();
    for (const w of dictionary) trie.insert(w);
    fullTrie = trie;
  }

  async function loadDictionary() {
    if (dictionary) return dictionary;
    setStatus('Fetching the Scrabble dictionary…');

    try {
      const cached = await idbGet(DICT_KEY);
      if (cached && Array.isArray(cached) && cached.length > 10000) {
        dictionary = cached;
        setStatus(`Dictionary loaded — ${dictionary.length.toLocaleString()} words at hand.`, 'good');
        buildFullTrie();
        return dictionary;
      }
    } catch (_) { /* fall through */ }

    try {
      const res = await fetch(DICT_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const words = [];
      for (const raw of text.split('\n')) {
        const w = raw.trim().toLowerCase();
        if (w.length < 3 || w.length > 25) continue;
        if (!/^[a-z]+$/.test(w)) continue;
        words.push(w);
      }
      dictionary = words;
      try { await idbPut(DICT_KEY, words); } catch (_) {}
      setStatus(`Dictionary loaded — ${dictionary.length.toLocaleString()} words at hand.`, 'good');
      buildFullTrie();
      return dictionary;
    } catch (err) {
      setStatus('Dictionary failed to load — check your connection.', 'error');
      throw err;
    }
  }

  // --- Status -------------------------------------------------------------
  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  // --- Solve --------------------------------------------------------------
  function readGrid() {
    const rows = [];
    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        const v = cells[r * size + c].value.trim().toLowerCase();
        if (!v) return null;
        row.push(v);
      }
      rows.push(row);
    }
    return rows;
  }

  async function doSolve() {
    const grid = readGrid();
    if (!grid) {
      setStatus('A letter is missing somewhere on the board.', 'error');
      return;
    }
    const minLen = parseInt(minLenEl.value, 10) || 3;

    solveBtn.disabled = true;
    setStatus('Hunting for words…');
    await new Promise((r) => setTimeout(r, 10));

    try {
      await loadDictionary();
      if (!fullTrie) buildFullTrie();

      const t0 = performance.now();
      const results = solve(grid, fullTrie, minLen);
      const t1 = performance.now();

      lastResults = results;
      activeWord = null;
      resetDefQueue();
      for (const c of gridEl.querySelectorAll('.cell.hl')) {
        c.classList.remove('hl');
        const o = c.querySelector('.order'); if (o) o.textContent = '';
      }
      renderResults();
      const n = results.size;
      const speed = (t1 - t0) < 200 ? ' quickly' : '';
      setStatus(`${n.toLocaleString()} word${n === 1 ? '' : 's'} hidden in those dice${speed}.`, 'good');
    } catch (err) {
      console.error(err);
      setStatus('Something went wrong: ' + err.message, 'error');
    } finally {
      solveBtn.disabled = false;
    }
  }

  // --- Results rendering --------------------------------------------------
  function renderResults() {
    if (!lastResults) return;
    const needle = filterEl.value.trim().toLowerCase();

    const all = [...lastResults.keys()].filter((w) => !needle || w.includes(needle));
    // Highest score first; for equal scores, longer word first; then alpha.
    all.sort((a, b) => {
      const d = scoreWord(b) - scoreWord(a);
      if (d) return d;
      const dl = b.length - a.length;
      if (dl) return dl;
      return a.localeCompare(b);
    });

    resultsEl.hidden = false;

    const totalScore = all.reduce((s, w) => s + scoreWord(w), 0);
    const longest = all.reduce((m, w) => Math.max(m, w.length), 0);
    summaryEl.innerHTML =
      `<strong>${all.length.toLocaleString()}</strong> words · ` +
      `longest <strong>${longest}</strong> letters · ` +
      `<strong>${totalScore.toLocaleString()}</strong> points total`;

    wordListEl.innerHTML = '';
    for (const w of all) wordListEl.appendChild(wordItem(w));
  }

  function wordItem(w) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.dataset.word = w;

    const row = document.createElement('div');
    row.className = 'word-row';
    const name = document.createElement('span');
    name.className = 'word-name';
    name.textContent = w;
    const len = document.createElement('span');
    len.className = 'len';
    len.textContent = w.length;
    const leader = document.createElement('span');
    leader.className = 'leader';
    const pts = document.createElement('span');
    pts.className = 'pts';
    const s = scoreWord(w);
    pts.textContent = s + ' pt' + (s === 1 ? '' : 's');
    row.appendChild(name);
    row.appendChild(len);
    row.appendChild(leader);
    row.appendChild(pts);

    const body = document.createElement('div');
    body.className = 'wd-body';
    body.innerHTML = '<span class="wd-placeholder">…</span>';

    li.appendChild(row);
    li.appendChild(body);

    row.addEventListener('click', () => highlight(w, li));
    ensureDefObserver().observe(li);

    return li;
  }

  function highlight(word, li) {
    for (const c of gridEl.querySelectorAll('.cell.hl')) {
      c.classList.remove('hl');
      const o = c.querySelector('.order'); if (o) o.textContent = '';
    }
    for (const l of wordListEl.querySelectorAll('li.active')) l.classList.remove('active');

    if (activeWord === word) { activeWord = null; return; }
    activeWord = word;
    li.classList.add('active');

    const path = lastResults.get(word);
    if (!path) return;
    path.forEach(([r, c], step) => {
      const idx = r * size + c;
      const cell = gridEl.children[idx];
      cell.classList.add('hl');
      const o = cell.querySelector('.order'); if (o) o.textContent = String(step + 1);
    });
  }

  // --- Inline definition loading ----------------------------------------
  // Each word row renders a placeholder. An IntersectionObserver enqueues
  // rows as they scroll near the viewport; a small worker pool drains the
  // queue so we don't exceed Datamuse's 10 req/sec limit.
  const DEF_KEY_PREFIX = 'def-v3:'; // bumped: proper-noun filter added
  const defMemCache = new Map();
  const MAX_CONCURRENT_DEFS = 4;
  let inFlightDefs = 0;
  const defQueue = [];
  let defObserver = null;

  function ensureDefObserver() {
    if (defObserver) return defObserver;
    defObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          queueDefFetch(entry.target);
          defObserver.unobserve(entry.target);
        }
      }
    }, { rootMargin: '400px 0px' });
    return defObserver;
  }

  function resetDefQueue() {
    defQueue.length = 0;
    // Existing in-flight fetches still resolve, but their DOM target will
    // already be gone (old <li>s removed on re-render), so renderInlineDef
    // silently no-ops on missing .wd-body.
  }

  function queueDefFetch(li) {
    if (li.dataset.defState) return;
    li.dataset.defState = 'queued';
    defQueue.push(li);
    drainDefQueue();
  }

  function drainDefQueue() {
    while (inFlightDefs < MAX_CONCURRENT_DEFS && defQueue.length > 0) {
      const li = defQueue.shift();
      const word = li.dataset.word;
      li.dataset.defState = 'loading';
      inFlightDefs++;
      fetchWordInfo(word)
        .then((info) => renderInlineDef(li, info))
        .catch(() => renderInlineDef(li, null))
        .finally(() => {
          li.dataset.defState = 'loaded';
          inFlightDefs--;
          drainDefQueue();
        });
    }
  }

  function renderInlineDef(li, info) {
    const body = li.querySelector('.wd-body');
    if (!body) return;
    body.innerHTML = '';
    if (!info || (!info.def && (!info.syns || !info.syns.length))) {
      body.classList.add('empty');
      return;
    }
    if (info.def) {
      const def = document.createElement('div');
      def.className = 'wd-def';
      if (info.pos) {
        const pos = document.createElement('em');
        pos.className = 'wd-pos';
        pos.textContent = info.pos;
        def.appendChild(pos);
        def.appendChild(document.createTextNode(' '));
      }
      def.appendChild(document.createTextNode(info.def));
      body.appendChild(def);
    }
    if (info.syns && info.syns.length) {
      const syns = document.createElement('div');
      syns.className = 'wd-syns';
      const label = document.createElement('strong');
      label.textContent = 'similar: ';
      syns.appendChild(label);
      syns.appendChild(document.createTextNode(info.syns.join(', ')));
      body.appendChild(syns);
    }
  }

  async function fetchWordInfo(word) {
    if (defMemCache.has(word)) return defMemCache.get(word);
    try {
      const cached = await idbGet(DEF_KEY_PREFIX + word);
      if (cached !== undefined) {
        defMemCache.set(word, cached);
        return cached;
      }
    } catch (_) {}

    const [defInfo, synList] = await Promise.all([
      fetchDefinition(word),
      fetchSynonyms(word),
    ]);

    const info = {
      def: defInfo ? defInfo.def : null,
      pos: defInfo ? defInfo.pos : null,
      syns: synList || [],
    };
    defMemCache.set(word, info);
    try { await idbPut(DEF_KEY_PREFIX + word, info); } catch (_) {}
    return info;
  }

  // Datamuse returns defs as "pos\tDefinition text. ". One call gives us
  // the part-of-speech tag and the gloss. Proper nouns get uppercase tags
  // ("N") and a capitalised defHeadword — we drop those so the Scrabble
  // word "alpines" doesn't show "a British duo" as its definition.
  async function fetchDefinition(word) {
    try {
      const res = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dp&max=1`);
      if (!res.ok) return null;
      const data = await res.json();
      const first = data && data[0];
      if (!first || !first.defs || !first.defs.length) return null;
      if (first.defHeadword && /^[A-Z]/.test(first.defHeadword)) return null; // proper noun
      const common = first.defs.find((d) => {
        const tab = d.indexOf('\t');
        if (tab < 0) return true;
        const tag = d.slice(0, tab);
        return tag === tag.toLowerCase();
      });
      if (!common) return null;
      const tab = common.indexOf('\t');
      const posTag = tab >= 0 ? common.slice(0, tab).trim() : '';
      const def = (tab >= 0 ? common.slice(tab + 1) : common).trim().replace(/\s+$/, '');
      return { def, pos: expandPos(posTag.toLowerCase()) };
    } catch (_) {
      return null;
    }
  }

  function expandPos(tag) {
    const map = {
      n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb',
      prep: 'preposition', pron: 'pronoun', u: '',
    };
    return map[tag] !== undefined ? map[tag] : tag;
  }

  async function fetchSynonyms(word) {
    try {
      const res = await fetch('https://api.datamuse.com/words?max=5&rel_syn=' + encodeURIComponent(word));
      if (!res.ok) return [];
      const data = await res.json();
      return data.map((x) => x.word).filter(Boolean).slice(0, 5);
    } catch (_) {
      return [];
    }
  }

  // --- Random grid --------------------------------------------------------
  const FREQ = 'eeeeeeeeeeeeeeeeettttttttttttaaaaaaaaaooooooooiiiiiiinnnnnnnsssssshhhhhrrrrrddddlllcccuummwwffggyyppbbvvkjxqz';
  function randomize() {
    for (const input of cells) {
      const ch = FREQ[Math.floor(Math.random() * FREQ.length)].toUpperCase();
      input.value = (ch === 'Q') ? 'QU' : ch;
    }
  }

  // --- Wiring -------------------------------------------------------------
  sizeEl.addEventListener('change', () => renderGrid(parseInt(sizeEl.value, 10)));
  solveBtn.addEventListener('click', doSolve);
  clearBtn.addEventListener('click', () => {
    cells.forEach((c) => (c.value = ''));
    cells[0]?.focus();
    lastResults = null;
    resultsEl.hidden = true;
    resetDefQueue();
    setStatus('');
  });
  randomBtn.addEventListener('click', randomize);
  filterEl.addEventListener('input', renderResults);

  renderGrid(4);
  setStatus('Type the dice, tap Solve.');
  loadDictionary().catch(() => {});
})();
