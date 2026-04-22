// Boggle solver: Trie + DFS. Handles multi-letter tiles (e.g. "Qu").
// Exposed globally as `BoggleSolver`.

(function () {
  'use strict';

  class Trie {
    constructor() {
      // Use Map for predictable perf across V8 and to keep children small.
      this.root = { c: new Map(), w: false };
    }

    insert(word) {
      let node = this.root;
      for (let i = 0; i < word.length; i++) {
        const ch = word.charCodeAt(i);
        let next = node.c.get(ch);
        if (!next) {
          next = { c: new Map(), w: false };
          node.c.set(ch, next);
        }
        node = next;
      }
      node.w = true;
    }

    // Walk down by a sequence of chars; returns the node or null.
    walk(node, str) {
      let cur = node;
      for (let i = 0; i < str.length; i++) {
        cur = cur.c.get(str.charCodeAt(i));
        if (!cur) return null;
      }
      return cur;
    }
  }

  function buildTrie(words, minLen) {
    const trie = new Trie();
    let count = 0;
    for (const w of words) {
      if (w.length < minLen) continue;
      trie.insert(w);
      count++;
    }
    return { trie, count };
  }

  // Classic Boggle scoring.
  function scoreWord(word) {
    const n = word.length;
    if (n <= 2) return 0;
    if (n <= 4) return 1;
    if (n === 5) return 2;
    if (n === 6) return 3;
    if (n === 7) return 5;
    return 11;
  }

  // grid: 2D array of lowercase strings per cell (one or more chars, e.g. "a", "qu").
  // trie: a Trie instance.
  // Returns Map<word, path[]> where path is array of [r, c].
  function solve(grid, trie, minLen) {
    const rows = grid.length;
    const cols = grid[0].length;
    const results = new Map();
    const visited = Array.from({ length: rows }, () => new Uint8Array(cols));

    const dirs = [
      [-1, -1], [-1, 0], [-1, 1],
      [ 0, -1],          [ 0, 1],
      [ 1, -1], [ 1, 0], [ 1, 1],
    ];

    function dfs(r, c, node, word, path) {
      const tile = grid[r][c];
      const next = trie.walk(node, tile);
      if (!next) return;

      const newWord = word + tile;
      const newPath = path.concat([[r, c]]);

      if (next.w && newWord.length >= minLen && !results.has(newWord)) {
        results.set(newWord, newPath);
      }

      visited[r][c] = 1;
      for (let i = 0; i < 8; i++) {
        const nr = r + dirs[i][0];
        const nc = c + dirs[i][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (visited[nr][nc]) continue;
        dfs(nr, nc, next, newWord, newPath);
      }
      visited[r][c] = 0;
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        dfs(r, c, trie.root, '', []);
      }
    }

    return results;
  }

  window.BoggleSolver = { Trie, buildTrie, scoreWord, solve };
})();
