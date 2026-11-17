/* Family-tree layout for the "Everyone" view.

   Every family hangs its children as one block directly under the couple, and each block
   is as wide as everything that descends from it, so a family never mixes with another.
   People are placed in generation rows.

   - A couple is drawn side by side. The partner without parents in the tree stands next
     to the one who has them.
   - When both partners have their own parents in the tree, the wife's family is a separate
     block. If that block is small (a few ancestors and siblings), it is "grafted" instead:
     she stands next to her husband and her parents and siblings are placed above and
     beside her. Otherwise she stays with her own family and one long line joins the two.
   - Unrelated or loosely related trees are placed side by side.

   Output has the same shape as an ELK result: { width, height, children, edges }. */
(function (root) {
  "use strict";

  function familyLayout(P, F, opt) {
    const NW = opt.NW, NH = opt.NH, FW = opt.FW;
    const GAP = 16, BLOCK_GAP = 28, TREE_GAP = 140, V1 = 44, ROW = NH + V1 + FW + V1, GRAFT_MAX = 10;
    const ids = Object.keys(P);
    const famIds = Object.keys(F).filter((f) => [F[f].father, F[f].mother].some((x) => x && P[x]));
    const parentsOf = (f) => [F[f].father, F[f].mother].filter((x) => x && P[x]);
    const kidsOf = (f) => F[f].children.filter((c) => P[c]);
    const birthFam = (x) => (P[x].parents || []).find((f) => F[f] && parentsOf(f).length) || null;
    const famsOf = (x) => (P[x].families || []).filter((f) => F[f] && parentsOf(f).includes(x));
    const year = (x) => { const m = /(\d{4})/.exec((P[x].birth && P[x].birth.date) || ""); return m ? +m[1] : 9999; };
    const byYear = (a, b) => year(a) - year(b);

    /* ---------- generations ---------- */
    const gen = new Map(ids.map((x) => [x, 0]));
    for (let it = 0; it < 200; it++) {
      let changed = false;
      const set = (x, v) => { if (gen.get(x) !== v) { gen.set(x, v); changed = true; } };
      for (const f of famIds) {                      // children below their parents
        const pg = Math.max(...parentsOf(f).map((x) => gen.get(x)));
        for (const k of kidsOf(f)) if (gen.get(k) < pg + 1) set(k, pg + 1);
      }
      for (const f of famIds) {                      // a couple shares one row
        const ps = parentsOf(f);
        if (ps.length === 2 && gen.get(ps[0]) !== gen.get(ps[1])) {
          const m = Math.max(gen.get(ps[0]), gen.get(ps[1]));
          ps.forEach((x) => set(x, m));
        }
      }
      for (const x of ids) {                         // nobody hangs far above their children
        const kg = famsOf(x).flatMap((f) => kidsOf(f).map((k) => gen.get(k)));
        if (kg.length && Math.min(...kg) - 1 > gen.get(x)) set(x, Math.min(...kg) - 1);
      }
      for (const x of ids) {                         // people without parents sit just above their children
        if (birthFam(x)) continue;
        const fs = famsOf(x);
        const kidGens = fs.flatMap((f) => kidsOf(f).map((k) => gen.get(k)));
        const spouseGens = fs.flatMap((f) => parentsOf(f).filter((y) => y !== x && birthFam(y)).map((y) => gen.get(y)));
        let want = gen.get(x);
        if (spouseGens.length) want = Math.max(...spouseGens);
        else if (kidGens.length) want = Math.min(...kidGens) - 1;
        if (want > gen.get(x) || (want < gen.get(x) && !spouseGens.length && kidGens.length)) set(x, want);
      }
      if (!changed) break;
    }
    const g0 = Math.min(...gen.values());
    for (const x of ids) gen.set(x, gen.get(x) - g0);

    /* ---------- who stands where ---------- */
    const host = new Map();        // family -> parent under whom the children hang
    const beside = new Map();      // person -> list of partners drawn next to them
    const besideOf = new Map();    // partner -> person they stand beside
    const longMother = new Map();  // family -> partner who stays with her own family
    const addBeside = (h, s) => { if (besideOf.has(s)) return false; (beside.get(h) || beside.set(h, []).get(h)).push(s); besideOf.set(s, h); return true; };
    for (const f of famIds) {
      const ps = parentsOf(f);
      if (ps.length === 1) { host.set(f, ps[0]); continue; }
      const [a, b] = [F[f].father, F[f].mother];
      const ha = !!birthFam(a), hb = !!birthFam(b);
      if (ha && hb) { host.set(f, a); longMother.set(f, b); continue; }
      const h = ha ? a : hb ? b : a, s = h === a ? b : a;
      if (besideOf.has(h)) {           // host already stands beside someone else: swap roles if possible
        if (!besideOf.has(s) && !birthFam(s)) { host.set(f, s); addBeside(s, h) || longMother.set(f, h); continue; }
      }
      host.set(f, h);
      if (!addBeside(h, s)) longMother.set(f, s);
    }
    const hostedFams = new Map();  // person -> families whose children hang under them
    for (const f of famIds) (hostedFams.get(host.get(f)) || hostedFams.set(host.get(f), []).get(host.get(f))).push(f);
    for (const fs of hostedFams.values()) fs.sort((a, b) => Math.min(...kidsOf(a).map(year), 9999) - Math.min(...kidsOf(b).map(year), 9999));

    // trees: start at people who have no parents and do not stand beside anyone
    const isRoot = (x) => !birthFam(x) && !besideOf.has(x);
    const treeOf = new Map();
    function collect(x, t) {
      if (treeOf.has(x)) return;
      treeOf.set(x, t); t.members.push(x);
      for (const s of beside.get(x) || []) collect(s, t);
      for (const f of hostedFams.get(x) || []) for (const k of kidsOf(f).sort(byYear)) collect(k, t);
    }
    const trees = [];
    for (const x of ids.slice().sort(byYear)) if (isRoot(x) && !treeOf.has(x)) { const t = { root: x, members: [] }; trees.push(t); collect(x, t); }
    for (const x of ids) if (!treeOf.has(x)) { const t = { root: x, members: [] }; trees.push(t); collect(x, t); }

    // graft small trees onto the partner they married into
    const grafted = new Map();     // tree -> { mother, host }
    for (const [f, m] of longMother) {
      const tm = treeOf.get(m), th = treeOf.get(host.get(f));
      if (tm === th || grafted.has(tm) || tm.members.length > GRAFT_MAX || grafted.has(th)) continue;
      if (besideOf.has(m)) continue;
      grafted.set(tm, { mother: m, host: host.get(f) });
      addBeside(host.get(f), m);
      longMother.delete(f);
    }
    // a tree that received a graft can't itself be grafted (checked above); grafts are laid out last

    /* ---------- block layout (tidy tree with per-row contours) ---------- */
    const X = new Map();
    // A block is a person, the partners standing beside them and the blocks of their children.
    // It is returned with its contour: for every generation row it occupies, the leftmost and
    // rightmost x relative to the block's own origin. Child blocks are packed left to right as
    // close as their contours allow, so a narrow family can sit under a wide neighbour's empty space.
    function block(x, skip) {
      const row = [x, ...(beside.get(x) || []).filter((s) => !skip || !skip.has(s))];
      const kids = [];
      for (const f of hostedFams.get(x) || []) for (const k of kidsOf(f).sort(byYear)) {
        if (skip && skip.has(k)) { kids.push(leaf(k)); continue; }
        if (!skip && treeOf.get(k) !== treeOf.get(x)) continue;
        kids.push(block(k, skip));
      }
      const pos = new Map(), cont = new Map();
      const addC = (g, l, r) => { const c = cont.get(g); cont.set(g, c ? [Math.min(c[0], l), Math.max(c[1], r)] : [l, r]); };
      // pack children
      let prevOff = -Infinity;
      for (const kb of kids) {
        let off = 0;
        if (cont.size) {
          off = -Infinity;
          for (const [g, [l]] of kb.cont) { const c = cont.get(g); if (c) off = Math.max(off, c[1] + BLOCK_GAP - l); }
          if (off === -Infinity) off = prevOff + NW + BLOCK_GAP;
          off = Math.max(off, prevOff + NW + GAP);
        }
        prevOff = off;
        for (const [id, px] of kb.pos) pos.set(id, px + off);
        for (const [g, [l, r]] of kb.cont) addC(g, l + off, r + off);
        kb.off = off;
      }
      // the couple's joint (between the host and the partner beside them) sits over the middle child
      const jointOff = row.length > 1 ? NW + GAP / 2 : NW / 2;
      let mid = 0;
      if (kids.length) { const xs = kids.map((kb) => pos.get(kb.id) + NW / 2); mid = (Math.min(...xs) + Math.max(...xs)) / 2; }
      else mid = jointOff;
      const rowStart = mid - jointOff;
      row.forEach((y, i) => pos.set(y, rowStart + i * (NW + GAP)));
      addC(gen.get(x), rowStart, rowStart + row.length * NW + (row.length - 1) * GAP);
      return { id: x, pos, cont };
    }
    function leaf(k) { return { id: k, pos: new Map([[k, 0]]), cont: new Map([[gen.get(k), [0, NW]]]) }; }
    const extent = (b) => { let l = Infinity, r = -Infinity; for (const [a, c] of b.cont.values()) { l = Math.min(l, a); r = Math.max(r, c); } return [l, r]; };

    // Lay out each tree, then choose the left-to-right order of the trees that keeps the lines
    // between married partners from different trees as short as possible.
    const main = trees.filter((t) => !grafted.has(t));
    const laid = main.map((t) => { const b = block(t.root), [l, r] = extent(b); return { t, b, l, w: r - l }; });
    const lidx = new Map(laid.map((L, i) => [L.t, i]));
    const homeTree = (p) => { let t = treeOf.get(p); if (grafted.has(t)) t = treeOf.get(grafted.get(t).host); return lidx.get(t); };
    const pairs = [];
    for (const [f, m] of longMother) {
      const h = host.get(f), a = homeTree(h), b = homeTree(m);
      if (a === undefined || b === undefined || a === b) continue;
      const rx = (i, p) => (laid[i].b.pos.has(p) ? laid[i].b.pos.get(p) - laid[i].l : laid[i].w / 2);
      pairs.push([a, rx(a, h), b, rx(b, m)]);
    }
    // trees are packed row by row too: a tree slides left until, in some row they share, it
    // comes within TREE_GAP of the trees already placed
    const pack = (ord) => {
      const start = new Array(laid.length), cont = new Map();
      let prev = -Infinity;
      for (const i of ord) {
        const L = laid[i];
        let off = -Infinity;
        for (const [g, [l]] of L.b.cont) { const c = cont.get(g); if (c !== undefined) off = Math.max(off, c + TREE_GAP - l); }
        if (off === -Infinity) off = prev === -Infinity ? -L.l : prev;
        off = Math.max(off, prev === -Infinity ? -Infinity : prev);
        start[i] = off; prev = off;
        for (const [g, [, r]] of L.b.cont) cont.set(g, Math.max(cont.get(g) ?? -Infinity, r + off));
      }
      return start;
    };
    const cost = (ord) => {
      const st = pack(ord);
      const ext = Math.max(...ord.map((i) => st[i] + laid[i].l + laid[i].w)) - Math.min(...ord.map((i) => st[i] + laid[i].l));
      return pairs.reduce((s, [a, ra, b, rb]) => s + Math.abs(st[a] + ra + laid[a].l - st[b] - rb - laid[b].l), 0) + ext * 0.5;
    };
    let best = laid.map((_, i) => i);
    if (laid.length <= 8) {
      let bc = cost(best);
      const perm = (arr, k) => {
        if (k === arr.length) { const c = cost(arr); if (c < bc) { bc = c; best = arr.slice(); } return; }
        for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
      };
      perm(best.slice(), 0);
    }
    const st = pack(best);
    for (const i of best) for (const [id, px] of laid[i].b.pos) X.set(id, px + st[i]);
    const order = best;

    /* ---------- grafted trees ---------- */
    const Y = (x) => gen.get(x) * ROW;
    const occupied = new Map();   // row -> sorted intervals
    const occ = (r) => occupied.get(r) || occupied.set(r, []).get(r);
    for (const [x, px] of X) occ(gen.get(x)).push([px, px + NW]);
    function freeSlot(r, want) {
      const iv = occ(r).slice().sort((a, b) => a[0] - b[0]);
      const fits = (s) => iv.every(([a, b]) => s + NW + GAP <= a || s >= b + GAP);
      if (fits(want)) return want;
      for (let d = 8; d < 20000; d += 8) { if (fits(want + d)) return want + d; if (fits(want - d)) return want - d; }
      return want;
    }
    for (const [t, gft] of grafted) {
      const rel = block(t.root, new Set([gft.mother])).pos;
      const dx = X.get(gft.mother) - (rel.get(gft.mother) ?? 0);
      // place nearest the mother first so her parents sit right above her
      const rest = t.members.filter((y) => y !== gft.mother).sort((a, b) => gen.get(b) - gen.get(a));
      for (const y of rest) {
        const want = (rel.get(y) ?? 0) + dx;
        const s = freeSlot(gen.get(y), want);
        X.set(y, s); occ(gen.get(y)).push([s, s + NW]);
      }
    }

    /* ---------- output ---------- */
    const minX = Math.min(...X.values());
    const children = [], edges = [];
    for (const x of ids) children.push({ id: x, x: X.get(x) - minX, y: Y(x), width: NW, height: NH });
    const pos = new Map(children.map((n) => [n.id, n]));
    const cx = (n) => n.x + NW / 2;
    for (const f of famIds) {
      const ps = parentsOf(f), ks = kidsOf(f);
      if (!ks.length && ps.length < 2) continue;
      const h = host.get(f), hn = pos.get(h);
      const partner = ps.find((y) => y !== h);
      const pn = partner && pos.get(partner);
      // joint between host and a partner standing next to them, else under the host
      let jx = cx(hn);
      if (pn && pn.y === hn.y && Math.abs(pn.x - hn.x) <= NW + GAP + 1) jx = (cx(hn) + cx(pn)) / 2;
      const jy = hn.y + NH + V1;
      const fid = "fam:" + f;
      children.push({ id: fid, x: jx - FW / 2, y: jy, width: FW, height: FW });
      const jc = { x: jx, y: jy + FW / 2 };
      for (const p of ps) {
        const n = pos.get(p);
        const pts = [{ x: cx(n), y: n.y + NH }, { x: cx(n), y: jc.y }, jc];
        edges.push({ id: `pe:${p}:${f}`, sources: [p], targets: [fid], long: Math.abs(cx(n) - jx) > NW + GAP,
          sections: [{ startPoint: pts[0], bendPoints: [pts[1]], endPoint: pts[2] }] });
      }
      for (const k of ks) {
        const n = pos.get(k), by = n.y - 16;
        edges.push({ id: `ce:${f}:${k}`, sources: [fid], targets: [k],
          sections: [{ startPoint: jc, bendPoints: [{ x: jc.x, y: by }, { x: cx(n), y: by }], endPoint: { x: cx(n), y: n.y } }] });
      }
    }
    const maxX = Math.max(...children.map((n) => n.x + n.width)), maxY = Math.max(...children.map((n) => n.y + n.height));
    return { id: "root", width: maxX, height: maxY, children, edges, _info: { trees: order.length, grafted: grafted.size, long: longMother.size } };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = familyLayout;
  else root.familyLayout = familyLayout;
})(this);
