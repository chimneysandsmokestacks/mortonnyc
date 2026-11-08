/* Family tree: one person in focus, parents and grandparents above,
   partners beside, children below. Tap anyone to bring them into focus. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), canvas = $("canvas"), wires = $("wires");
  const rowGP = $("rowGP"), rowP = $("rowP"), rowF = $("rowF"), rowC = $("rowC");
  const sheet = $("sheet"), sheetBody = $("sheetBody"), grip = $("grip");
  const q = $("q"), results = $("results");
  const wide = window.matchMedia("(min-width: 900px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let DATA = null, P = {}, F = {};
  let focusId = null, pendingRect = null, sheetPid = null;

  /* ---------- helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const year = (d) => { const m = d && d.date && d.date.match(/\b(\d{4})\b/); return m ? m[1] : ""; };
  function lifespan(p) {
    if (!p || p.living) return "";
    const b = year(p.birth), d = year(p.death);
    if (b && d) return `${b}–${d}`;
    if (b) return `born ${b}`;
    if (d) return `died ${d}`;
    return "";
  }
  const soft = (s) => s.replace(/\//g, "/\u200b"); // allow line breaks after slashes
  const fullName = (p) => [p.given, p.surname].filter(Boolean).join(" ");
  const marker = (p) => h("i", { class: `dot ${p.gender} ${p.living ? "living" : ""}`.trim(), "aria-hidden": "true" });
  function initials(p) {
    const g = (p.given || "").replace(/[^\p{L}]/gu, " ").trim(), s = (p.surname || "").trim();
    return ((g.charAt(0) || "?") + (s.charAt(0) || "")).toUpperCase();
  }
  const avatar = (p, extra = "") => h("span", { class: `av ${extra}`.trim(), "aria-hidden": "true", text: initials(p) });
  const docIcon = () => svg('<path d="M4 1.5h5L12.5 5v9.5h-8.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.5 8.5h4M6.5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>');
  function svg(inner, cls = "") {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 16 16"); el.setAttribute("aria-hidden", "true");
    if (cls) el.setAttribute("class", cls);
    el.innerHTML = inner;
    return el;
  }
  const SITE_STYLE = {
    "Czech National Archives": ["NA", "#1f8a70"],
    "FamilySearch": ["FS", "#5b8c2a"],
    "GenTeam": ["GT", "#d0661e"],
    "USC Shoah Foundation": ["USC", "#9d2235"],
    "Geni photo": ["G", "#6b4fbb"],
    "Facebook": ["f", "#1877f2"],
  };
  const siteBadge = (site) => {
    const [t, c] = SITE_STYLE[site] || [site.replace(/^www\./, "").charAt(0).toUpperCase(), "#555c73"];
    const el = h("span", { class: "site-badge", "aria-hidden": "true", text: t });
    el.style.background = c;
    return el;
  };
  // Sites that allow their pages to be shown inside this one (others refuse to load in a frame).
  const EMBEDDABLE = new Set(["vademecum.nacr.cz"]);
  const host = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
  const recTitle = (l) => l.label || (l.context && l.context !== "Person" ? l.context : l.site);
  const recSub = (l) => [l.context && l.context !== "Person" ? l.context : "", l.label].filter(Boolean).join(": ") || "Linked record";
  const genderWord = { m: "male", f: "female", u: "gender unknown" };

  function familyLinks(p) {
    const out = [];
    for (const fid of p.families || []) {
      const f = F[fid];
      if (f && f.links) for (const l of f.links) out.push(l);
    }
    return out;
  }
  function allLinks(p) {
    const seen = new Set(), out = [];
    for (const l of [...(p.links || []), ...familyLinks(p)]) {
      if (!seen.has(l.url) && /^https?:\/\//i.test(l.url)) { seen.add(l.url); out.push(l); }
    }
    return out;
  }

  /* relatives */
  const parentsOf = (p) => {
    const f = p && p.parents && F[p.parents[0]];
    return f ? { fam: f, father: P[f.father] || null, mother: P[f.mother] || null } : null;
  };
  function siblingsOf(p) {
    const ids = new Set();
    for (const fid of p.parents || []) for (const c of (F[fid] || {}).children || []) if (c !== p.id) ids.add(c);
    return [...ids].map((id) => P[id]).filter(Boolean);
  }
  function unions(p) {
    return (p.families || []).map((fid) => F[fid]).filter(Boolean).map((f) => ({
      fam: f,
      spouse: P[f.father === p.id ? f.mother : f.father] || null,
      children: f.children.map((c) => P[c]).filter(Boolean),
    }));
  }

  /* ---------- nodes ---------- */
  function node(p, extra = "") {
    const links = p.living ? 0 : allLinks(p).length;
    const label = `${fullName(p)}${p.living ? "" : ", " + (lifespan(p) || "dates unknown")}, ${genderWord[p.gender]}` +
      (links ? `, ${links} linked record${links > 1 ? "s" : ""}` : "");
    return h("button", {
      type: "button", class: `node ${p.gender} ${p.living ? "living" : ""} ${extra}`.trim(),
      "data-id": p.id, "aria-label": label,
    },
      avatar(p),
      h("span", { class: "given", text: soft(p.given || "Unknown") }),
      p.surname ? h("span", { class: "sur", text: soft(p.surname) }) : null,
      lifespan(p) ? h("span", { class: "yrs", text: lifespan(p) }) : null,
      links ? h("span", { class: "badge", "aria-hidden": "true" }, docIcon(), `${links} record${links > 1 ? "s" : ""}`) : null,
    );
  }
  const ghost = () => h("div", { class: "ghost", "aria-hidden": "true", text: "Unknown" });

  /* ---------- render tree ---------- */
  function render(id) {
    const p = P[id];
    if (!p) return;
    closeViewer();
    focusId = id;
    const fromRect = pendingRect; pendingRect = null;
    const animate = fromRect && !reduceMotion.matches;

    rowGP.replaceChildren(); rowP.replaceChildren(); rowF.replaceChildren(); rowC.replaceChildren();
    const pr = parentsOf(p);

    // grandparents: father's side on the left, mother's on the right
    if (pr) {
      const sides = [pr.father, pr.mother].map((par) => {
        const g = parentsOf(par);
        const side = h("div", { class: "side" });
        if (g && (g.father || g.mother)) {
          side.append(g.father ? node(g.father, "gpn") : ghost(), g.mother ? node(g.mother, "gpn") : ghost());
          side.dataset.has = "1";
        }
        return side;
      });
      if (sides.some((s) => s.dataset.has)) rowGP.append(...sides);

      rowP.append(
        h("div", { class: "side" }, pr.father ? node(pr.father) : ghost()),
        h("div", { class: "side" }, pr.mother ? node(pr.mother) : ghost()),
      );
    }

    const us = unions(p);
    const focusEl = node(p, "focus keep");
    focusEl.setAttribute("aria-expanded", String(sheet.classList.contains("open")));
    rowF.append(
      h("div", { class: "pad" }),
      focusEl,
      h("div", { class: "spouses" }, us.filter((u) => u.spouse).map((u) => node(u.spouse))),
    );

    const groups = us.filter((u) => u.children.length);
    for (const u of groups) {
      rowC.append(h("div", { class: "group", "data-fam": u.fam.id }, u.children.map((c) => {
        const el = node(c), n = descendantCount(c.id);
        if (n) el.append(h("span", { class: "desc", text: `${n} descendant${n > 1 ? "s" : ""}` }));
        return el;
      })));
    }
    if (groups.length) {
      const n = groups.reduce((t, u) => t + u.children.length, 0);
      rowC.prepend(h("span", { class: "row-label", text: n === 1 ? "1 child" : `${n} children` }));
    }

    renderSheet(p);
    document.title = `${fullName(p)} | ${DATA.title}`;

    if (animate) canvas.classList.add("entering");
    // layout is ready after this frame
    requestAnimationFrame(() => {
      drawWires(p, pr, us);
      centerOn(focusEl, !fromRect);
      if (animate) flip(focusEl, fromRect);
      requestAnimationFrame(() => canvas.classList.remove("entering"));
    });
  }

  function centerOn(el, initial) {
    const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    // on phones keep the focused person and their partner(s) in view together
    const row = [...rowF.querySelectorAll(".node")].map((n) => n.getBoundingClientRect());
    const left = wide.matches ? r.left : Math.min(...row.map((x) => x.left));
    const right = wide.matches ? r.right : Math.max(...row.map((x) => x.right));
    stage.scrollLeft += (left + right) / 2 - (s.left + s.width / 2);
    const visibleBottom = wide.matches ? s.bottom : Math.min(s.bottom, sheet.getBoundingClientRect().top);
    if (initial || r.top < s.top || r.bottom > visibleBottom - 8) {
      const target = r.top - s.top - Math.max(16, ((visibleBottom - s.top) - r.height) / 2);
      stage.scrollTop += Math.max(0, target - 40);
    }
  }

  function flip(el, from) {
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = from.height / to.height;
    el.style.transformOrigin = "0 0";
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.getBoundingClientRect();
    el.style.transition = "transform .42s cubic-bezier(.2,.8,.2,1)";
    el.style.transform = "";
    el.addEventListener("transitionend", () => { el.style.transition = ""; el.style.transformOrigin = ""; }, { once: true });
  }

  /* ---------- connectors ---------- */
  function drawWires(p, pr, us) {
    const c = canvas.getBoundingClientRect();
    wires.setAttribute("width", canvas.scrollWidth);
    wires.setAttribute("height", canvas.scrollHeight);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - c.left, r: r.right - c.left, t: r.top - c.top, b: r.bottom - c.top, cx: r.left - c.left + r.width / 2, cy: r.top - c.top + r.height / 2 };
    };
    const find = (scope, id) => scope.querySelector(`[data-id="${CSS.escape(id)}"]`);
    let d = "", couples = "";

    // parents (array of elements, may contain nulls) -> children elements
    function family(parentEls, childEls, yOffset = 0) {
      const ps = parentEls.filter(Boolean).map(box);
      const cs = childEls.filter(Boolean).map(box);
      if (!ps.length || !cs.length) return;
      let x0, y0;
      if (ps.length === 2) {
        const [a, b] = ps[0].cx < ps[1].cx ? ps : [ps[1], ps[0]];
        const y = Math.min(a.cy, b.cy) + yOffset;
        couples += `M${a.r},${y}H${b.l}`;
        x0 = (a.r + b.l) / 2; y0 = y;
      } else {
        x0 = ps[0].cx; y0 = ps[0].b;
      }
      // a short stem from the couple, then a smooth curve to each child
      const top = Math.min(...cs.map((k) => k.t));
      const stem = Math.max(y0, Math.max(...ps.map((k) => k.b)) + 6);
      for (const k of cs) {
        const my = (stem + k.t) / 2;
        d += `M${x0},${y0}V${stem}C${x0},${my} ${k.cx},${my} ${k.cx},${k.t - 2}`;
      }
    }

    const focusEl = find(rowF, p.id);
    if (pr) {
      const fEl = pr.father && find(rowP, pr.father.id), mEl = pr.mother && find(rowP, pr.mother.id);
      family([fEl, mEl], [focusEl]);
      for (const par of [pr.father, pr.mother]) {
        const g = parentsOf(par);
        if (!g) continue;
        family([g.father && find(rowGP, g.father.id), g.mother && find(rowGP, g.mother.id)], [find(rowP, par.id)]);
      }
    }
    us.forEach((u, i) => {
      const sEl = u.spouse && find(rowF, u.spouse.id);
      const group = rowC.querySelector(`[data-fam="${CSS.escape(u.fam.id)}"]`);
      const kids = group ? [...group.querySelectorAll(".node")] : [];
      if (kids.length) family([focusEl, sEl], kids, i * 6);
      else if (sEl) { const a = box(focusEl), b = box(sEl); couples += `M${a.r},${a.cy + i * 6}H${b.l}`; }
    });

    wires.innerHTML = `<path d="${d}"/><path class="couple" d="${couples}"/>`;
  }

  /* ---------- details sheet ---------- */
  function chip(p) {
    return h("button", { type: "button", class: `chip ${p.living ? "living" : ""}`, "data-id": p.id },
      marker(p), fullName(p), p.living ? null : h("span", { class: "sr-only", text: lifespan(p) }));
  }

  function renderSheet(p) {
    sheetPid = p.id;
    const links = p.living ? [] : allLinks(p);
    const us = unions(p), pr = parentsOf(p), sibs = siblingsOf(p);
    const body = [];

    const whoAv = avatar(p, p.living ? "living" : "");
    whoAv.style.setProperty("--c", `var(--${{ m: "male", f: "female", u: "unknown" }[p.gender]})`);
    whoAv.style.background = p.living ? "" : `var(--${{ m: "male", f: "female", u: "unknown" }[p.gender]})`;
    body.push(h("div", { class: "who", id: "who" },
      whoAv,
      h("div", {},
        h("h1", { text: fullName(p) }),
        p.nick ? h("div", { class: "nick", text: `“${p.nick}”` }) : null,
        h("p", { class: "lifespan", text: p.living ? "Living" : (lifespan(p) || "Dates unknown") }),
        h("p", { class: "peek-hint" }, links.length ? docIcon() : null, links.length ? `${links.length} record${links.length > 1 ? "s" : ""}. Tap to see them.` : "Tap for family and details"),
      ),
      h("button", { type: "button", class: "rel-start", "data-rel": p.id, title: `See how ${fullName(p)} is related to someone else` },
        svg('<circle cx="4" cy="4" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 6.5v1.5a3 3 0 0 0 3 3h2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
        h("span", { text: "Compare" })),
    ));

    if (p.living) {
      body.push(h("p", { class: "private-note", text: "Dates, places and records are kept private for living relatives." }));
    } else {
      const facts = [];
      const fact = (label, ev) => {
        if (!ev) return;
        const txt = [ev.date, ev.place && (ev.date ? `in ${ev.place}` : ev.place)].filter(Boolean).join(" ");
        if (txt) facts.push(h("dt", { text: label }), h("dd", { text: txt }));
      };
      fact("Born", p.birth);
      for (const u of us) if (u.fam.marriage) fact(u.spouse ? `Married` : "Married", u.fam.marriage);
      for (const e of p.events || []) fact(e.type, e);
      fact("Died", p.death);
      if (facts.length) body.push(h("dl", { class: "facts" }, facts));

      if (links.length) {
        body.push(h("h2", {}, "Records", h("span", { class: "count", text: String(links.length) })));
        body.push(h("ul", { class: "records" }, links.map((l, i) => h("li", { class: "rec" },
          h("button", { type: "button", class: "rec-open", "data-rec": String(i) },
            siteBadge(l.site),
            h("span", { class: "rec-text" },
              h("span", { class: "site", text: l.site }),
              h("span", { class: "ctx", text: recSub(l) }),
              (() => {
                const o = sharedWith(l.url, p.id);
                if (!o.length) return null;
                const first = fullName(P[o[0]]);
                return h("span", { class: "shared-line" }, linkIcon(),
                  o.length === 1 ? `Shared with ${first}` : `Shared with ${o.length} other people`);
              })()),
          ),
          h("a", { class: "rec-ext", href: l.url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open ${l.site} record in a new tab` }, extIcon()),
        ))));
      }
      if (p.notes && p.notes.length) {
        body.push(h("h2", { text: "Notes" }));
        body.push(h("ul", { class: "notes" }, p.notes.map((n) => h("li", { text: n }))));
      }
    }

    const kin = [];
    const row = (label, people) => { people = people.filter((x, i) => people.findIndex((y) => y.id === x.id) === i); if (people.length) kin.push(h("dt", { text: label }), h("dd", {}, people.map(chip))); };
    row("Parents", pr ? [pr.father, pr.mother].filter(Boolean) : []);
    row(us.filter((u) => u.spouse).length > 1 ? "Partners" : "Partner", us.map((u) => u.spouse).filter(Boolean));
    row("Siblings", sibs);
    row("Children", us.flatMap((u) => u.children));
    if (kin.length) {
      body.push(h("h2", { text: "Family" }));
      body.push(h("dl", { class: "kin" }, kin));
    }
    body.push(h("p", { class: "foot", text: `Gramps ID ${p.id}` }));

    sheetBody.replaceChildren(...body);
    sheetBody.scrollTop = 0;
  }

  const extIcon = () => svg('<path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V14H2V4h4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>');

  /* ---------- records shared between people ---------- */
  let SHARED = new Map();   // url -> [person ids]
  function buildShared() {
    SHARED = new Map();
    for (const p of Object.values(P)) {
      if (p.living) continue;
      for (const l of allLinks(p)) {
        if (!SHARED.has(l.url)) SHARED.set(l.url, []);
        SHARED.get(l.url).push(p.id);
      }
    }
  }
  const sharedWith = (url, id) => (SHARED.get(url) || []).filter((x) => x !== id);
  function relWord(fromId, toId) {
    const path = findPath(fromId, toId);
    return path ? describe(path) : "not linked in the tree";
  }
  function sharedReason(l, fromId, others) {
    const kinds = others.map((o) => {
      const path = findPath(fromId, o);
      if (!path) return "other";
      if (path.blood && path.a + path.b === 1) return "parent";
      if (path.blood && path.a === 1 && path.b === 1) return "sibling";
      if (!path.blood && path.edges.length === 1 && path.edges[0] === "spouse") return "spouse";
      return "other";
    });
    if (/marriage/i.test(l.context || "")) return "This is a marriage record. Marriage entries name the bride and groom and often their parents, so the same record is linked from each person it mentions.";
    if (kinds.includes("parent")) return "One register entry often names several people. A birth record, for example, lists the child together with the father and mother, so the same record is linked from each of them.";
    if (kinds.every((k) => k === "spouse")) return "It names both partners, as a marriage entry does, or a child’s birth entry that lists both parents.";
    if (kinds.includes("sibling")) return "Archive scans show a whole register page, and siblings were often registered close together, so their entries can share a page.";
    return "Archive scans show a whole register page, so entries for several relatives can appear on the same page.";
  }
  const linkIcon = () => svg('<path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>');

  /* ---------- record viewer ---------- */
  const viewer = $("viewer"), vBackdrop = $("vBackdrop"), vTabs = $("vTabs"), vBody = $("vBody");
  let vLinks = [], vReturnFocus = null, vPerson = null;
  const vShared = $("vShared");

  function openViewer(p, index) {
    vLinks = allLinks(p);
    if (!vLinks.length) return;
    vPerson = p.id;
    vReturnFocus = document.activeElement;
    $("vName").textContent = fullName(p);
    $("vSub").textContent = `${lifespan(p) || "Dates unknown"}, ${vLinks.length} record${vLinks.length > 1 ? "s" : ""}`;
    vTabs.replaceChildren(...vLinks.map((l, i) => h("button", {
      type: "button", class: "v-tab", role: "tab", "data-i": String(i), title: `${l.site}: ${recSub(l)}`,
    }, siteBadge(l.site), h("span", { text: `${i + 1}. ${recTitle(l)}` }),
      sharedWith(l.url, p.id).length ? h("span", { class: "tab-shared", "aria-label": "shared record" }, linkIcon()) : null)));
    vTabs.hidden = vLinks.length < 2;
    showRecord(index);
    viewer.setAttribute("aria-hidden", "false");
    viewer.classList.add("show"); vBackdrop.classList.add("show");
    $("vClose").focus({ preventScroll: true });
  }

  function showRecord(i) {
    const l = vLinks[i];
    [...vTabs.children].forEach((t, k) => t.setAttribute("aria-selected", String(k === i)));
    const tab = vTabs.children[i];
    if (tab) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    $("vExt").href = l.url;
    const others = sharedWith(l.url, vPerson);
    if (others.length) {
      vShared.replaceChildren(
        h("p", { class: "vs-title" }, linkIcon(), `Shared record: also linked to ${others.length === 1 ? "1 other person" : others.length + " other people"}`),
        h("div", { class: "vs-people" }, others.map((o) => h("button", { type: "button", class: "chip", "data-id": o },
          marker(P[o]), fullName(P[o]), h("span", { class: "vs-rel", text: relWord(vPerson, o) })))),
        h("p", { class: "vs-why", text: sharedReason(l, vPerson, others) }),
      );
      vShared.hidden = false;
    } else {
      vShared.hidden = true;
      vShared.replaceChildren();
    }
    if (EMBEDDABLE.has(host(l.url))) {
      const loading = h("div", { class: "v-loading", text: `Loading ${l.site}` });
      const frame = h("iframe", { src: l.url, title: `${l.site}: ${recSub(l)}`, allow: "fullscreen" });
      frame.addEventListener("load", () => loading.remove(), { once: true });
      vBody.replaceChildren(frame, loading);
    } else {
      vBody.replaceChildren(h("div", { class: "v-fallback" },
        siteBadge(l.site),
        h("h3", { text: l.site }),
        h("p", { text: `${l.label ? l.label + ". " : ""}${l.site} doesn't allow its pages to be shown inside other sites, so this record opens in a new tab.` }),
        h("a", { class: "v-btn", href: l.url, target: "_blank", rel: "noopener noreferrer" }, extIcon(), "Open record"),
      ));
    }
  }

  function closeViewer() {
    if (!viewer.classList.contains("show")) return false;
    viewer.classList.remove("show"); vBackdrop.classList.remove("show");
    viewer.setAttribute("aria-hidden", "true");
    setTimeout(() => { if (!viewer.classList.contains("show")) vBody.replaceChildren(); }, 350);
    if (vReturnFocus && vReturnFocus.focus) vReturnFocus.focus({ preventScroll: true });
    return true;
  }
  vShared.addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    closeViewer();
    if (!wide.matches) setSheet(false);
    go(c.dataset.id, null);
  });
  vTabs.addEventListener("click", (e) => { const t = e.target.closest(".v-tab"); if (t) showRecord(+t.dataset.i); });
  vTabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const cur = [...vTabs.children].findIndex((t) => t.getAttribute("aria-selected") === "true");
    const next = (cur + (e.key === "ArrowRight" ? 1 : -1) + vLinks.length) % vLinks.length;
    showRecord(next); vTabs.children[next].focus();
  });
  $("vClose").addEventListener("click", closeViewer);
  vBackdrop.addEventListener("click", closeViewer);

  function setSheet(open) {
    sheet.classList.toggle("open", open);
    grip.setAttribute("aria-expanded", String(open));
    const f = rowF.querySelector(".focus");
    if (f) f.setAttribute("aria-expanded", String(open));
  }

  /* ---------- relationships between two people ---------- */
  const relView = $("relView"), relCanvas = $("relCanvas"), relWires = $("relWires"), relBar = $("relBar"), pickBanner = $("pickBanner");
  let relMode = null;      // { a, b } while the path view is showing
  let pickFrom = null;     // id of the first person while choosing the second

  const G = (p, m, f, u) => (p.gender === "m" ? m : p.gender === "f" ? f : u);
  const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const ord = (n) => ORD[n] || `${n}th`;
  const nth = (n) => n + ((n % 10 === 1 && n % 100 !== 11) ? "st" : (n % 10 === 2 && n % 100 !== 12) ? "nd" : (n % 10 === 3 && n % 100 !== 13) ? "rd" : "th");
  const greats = (n) => (n <= 0 ? "" : n <= 2 ? "great-".repeat(n) : `${nth(n)} great-`);
  const times = (n) => ["", "once", "twice", "three times"][n] || `${n} times`;
  const parentIds = (id) => {
    const out = [];
    for (const fid of P[id].parents || []) { const f = F[fid]; if (f) for (const x of [f.father, f.mother]) if (x && P[x]) out.push(x); }
    return out;
  };
  const childIds = (id) => (P[id].families || []).flatMap((fid) => (F[fid] ? F[fid].children : [])).filter((c) => P[c]);
  const spouseIds = (id) => (P[id].families || []).map((fid) => F[fid]).filter(Boolean)
    .map((f) => (f.father === id ? f.mother : f.father)).filter((x) => x && P[x]);

  // ancestors of id: Map ancestor -> { d: generations up, next: the person one step closer to id }
  function ancestors(id) {
    const m = new Map([[id, { d: 0, next: null }]]);
    const queue = [id];
    while (queue.length) {
      const x = queue.shift();
      for (const par of parentIds(x)) if (!m.has(par)) { m.set(par, { d: m.get(x).d + 1, next: x }); queue.push(par); }
    }
    return m;
  }

  // Kinship term for "B is A's ___", where B sits b generations below and A sits a generations
  // below their closest common ancestor.
  function kinTerm(a, b, B, half) {
    const hp = half ? "half-" : "";
    if (a === 0 && b === 0) return "same person";
    if (a === 0) return b === 1 ? G(B, "son", "daughter", "child")
      : greats(b - 2) + G(B, "grandson", "granddaughter", "grandchild");
    if (b === 0) return a === 1 ? G(B, "father", "mother", "parent")
      : greats(a - 2) + G(B, "grandfather", "grandmother", "grandparent");
    if (a === 1 && b === 1) return hp + G(B, "brother", "sister", "sibling");
    if (b === 1) return hp + greats(a - 2) + G(B, "uncle", "aunt", "aunt or uncle");
    if (a === 1) return hp + greats(b - 2) + G(B, "nephew", "niece", "niece or nephew");
    const deg = Math.min(a, b) - 1, rem = Math.abs(a - b);
    return `${hp}${ord(deg)} cousin${rem ? ` ${times(rem)} removed` : ""}`;
  }

  // Find the path between two people. Blood relationships come first; otherwise the
  // shortest route through parents, children and marriages.
  function findPath(aId, bId) {
    const A = ancestors(aId), B = ancestors(bId);
    let best = null;
    for (const [x, ia] of A) {
      const ib = B.get(x);
      if (!ib) continue;
      const score = [ia.d + ib.d, Math.max(ia.d, ib.d)];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { x, ia, ib, score };
    }
    if (best) {
      const up = []; for (let x = best.x; x; x = A.get(x).next) up.unshift(x);   // a ... apex
      const down = []; for (let x = B.get(best.x).next; x; x = B.get(x).next) down.push(x); // apex ... b (excl. apex)
      const nodes = [...up, ...down];
      const edges = [...up.slice(1).map(() => "up"), ...down.map(() => "down")];
      // every common ancestor at the same distance (two of them = full relation, one = half)
      const apexes = [...A].filter(([x, i]) => B.has(x) && i.d === best.ia.d && B.get(x).d === best.ib.d).map(([x]) => x);
      return { nodes, edges, blood: true, a: best.ia.d, b: best.ib.d, apexes };
    }
    const prev = new Map([[aId, null]]), queue = [aId];
    while (queue.length && !prev.has(bId)) {
      const x = queue.shift();
      for (const [y, kind] of [...parentIds(x).map((y) => [y, "up"]), ...childIds(x).map((y) => [y, "down"]), ...spouseIds(x).map((y) => [y, "spouse"])]) {
        if (!prev.has(y)) { prev.set(y, [x, kind]); queue.push(y); }
      }
    }
    if (!prev.has(bId)) return null;
    const nodes = [bId], edges = [];
    for (let x = bId; prev.get(x); x = prev.get(x)[0]) { nodes.unshift(prev.get(x)[0]); edges.unshift(prev.get(x)[1]); }
    return { nodes, edges, blood: false };
  }

  // "B is A's ___" for any path, splitting it at marriages.
  function describe(path) {
    const { nodes, edges } = path;
    if (path.blood) {
      const half = path.a > 0 && path.b > 0 && path.apexes.length < 2;
      return kinTerm(path.a, path.b, P[nodes[nodes.length - 1]], half);
    }
    const terms = [];
    let i = 0;
    while (i < edges.length) {
      if (edges[i] === "spouse") { terms.push({ t: "spouse", p: P[nodes[i + 1]] }); i++; continue; }
      let ups = 0, downs = 0, j = i;
      while (j < edges.length && edges[j] === "up" && downs === 0) { ups++; j++; }
      while (j < edges.length && edges[j] === "down") { downs++; j++; }
      if (j === i) { j++; downs = 1; }
      terms.push({ t: "blood", a: ups, b: downs, p: P[nodes[j]] });
      i = j;
    }
    const word = (x) => x.t === "spouse" ? G(x.p, "husband", "wife", "spouse") : kinTerm(x.a, x.b, x.p, false);
    // a few familiar in-law and step terms
    const pair = (x, y) => {
      const S = (t) => t.t === "spouse", K = (t, a, b) => t.t === "blood" && t.a === a && t.b === b;
      if (S(x) && K(y, 1, 0)) return G(y.p, "father-in-law", "mother-in-law", "parent-in-law");
      if (S(x) && K(y, 1, 1)) return G(y.p, "brother-in-law", "sister-in-law", "sibling-in-law");
      if (K(x, 1, 1) && S(y)) return G(y.p, "brother-in-law", "sister-in-law", "sibling-in-law");
      if (K(x, 0, 1) && S(y)) return G(y.p, "son-in-law", "daughter-in-law", "child-in-law");
      if (S(x) && K(y, 0, 1)) return G(y.p, "stepson", "stepdaughter", "stepchild");
      if (K(x, 1, 0) && S(y)) return G(y.p, "stepfather", "stepmother", "step-parent");
      return null;
    };
    const words = [];
    for (let k = 0; k < terms.length; k++) {
      const merged = k + 1 < terms.length && pair(terms[k], terms[k + 1]);
      if (merged) { words.push(merged); k++; } else words.push(word(terms[k]));
    }
    return words.join("’s ");
  }

  function stepRole(x, y, kind) {
    if (kind === "up") return G(P[y], "father", "mother", "parent");
    if (kind === "down") return G(P[y], "son", "daughter", "child");
    return G(P[y], "husband", "wife", "spouse");
  }

  // Lay the path out as columns: going up stays in a column, the turn at a common ancestor
  // gets its own middle column, marriages step sideways.
  function layoutPath(path) {
    const pos = [{ col: 0, row: 0 }];
    let col = 0, row = 0, prev = null;
    path.edges.forEach((e, i) => {
      if (e === "spouse") { col++; }
      else if (e === "up") { if (prev === "down") { col++; pos[i].col = col; col++; } row--; }
      else { if (prev === "up") { col++; pos[i].col = col; col++; } row++; }
      pos.push({ col, row });
      prev = e;
    });
    const minRow = Math.min(...pos.map((p) => p.row));
    return pos.map((p) => ({ col: p.col, row: p.row - minRow }));
  }

  function showRelation(aId, bId) {
    closeViewer();
    pickFrom = null; pickBanner.hidden = true;
    relMode = { a: aId, b: bId };
    document.body.classList.add("rel-mode");
    const path = findPath(aId, bId);

    relBar.replaceChildren(
      h("button", { type: "button", class: "rel-btn", id: "relExit" }, svg('<path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'), "Back to tree"),
      h("button", { type: "button", class: "rel-btn", id: "relSwap" }, svg('<path d="M3 5h9.5M10 2.5 12.5 5 10 7.5M13 11H3.5M6 8.5 3.5 11 6 13.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'), "Swap"),
    );

    relCanvas.replaceChildren(relWires);
    if (!path) {
      relCanvas.append(h("div", { class: "rel-empty" },
        h("p", { text: `No connection between ${fullName(P[aId])} and ${fullName(P[bId])} was found in the tree.` })));
      renderRelSheet(aId, bId, null);
      relWires.innerHTML = "";
      return;
    }
    const pos = layoutPath(path);
    const cols = Math.max(...pos.map((p) => p.col)) + 1, rows = Math.max(...pos.map((p) => p.row)) + 1;
    relCanvas.style.gridTemplateColumns = `repeat(${cols}, auto)`;
    relCanvas.style.gridTemplateRows = `repeat(${rows}, auto)`;
    path.nodes.forEach((id, i) => {
      const end = i === 0 ? "A" : i === path.nodes.length - 1 ? "B" : null;
      const el = node(P[id], end ? "endpoint" : "");
      el.style.gridColumn = pos[i].col + 1; el.style.gridRow = pos[i].row + 1;
      if (end) el.prepend(h("span", { class: "end-tag", "aria-hidden": "true", text: end }));
      el.dataset.step = String(i);
      relCanvas.append(el);
    });
    renderRelSheet(aId, bId, path);
    requestAnimationFrame(() => { drawRelWires(path); centerRel(); });
  }

  function drawRelWires(path) {
    if (!path) return;
    const c = relCanvas.getBoundingClientRect();
    relWires.setAttribute("width", relCanvas.scrollWidth);
    relWires.setAttribute("height", relCanvas.scrollHeight);
    const box = (i) => {
      const r = relCanvas.querySelector(`[data-step="${i}"]`).getBoundingClientRect();
      return { l: r.left - c.left, r: r.right - c.left, t: r.top - c.top, b: r.bottom - c.top, cx: r.left - c.left + r.width / 2, cy: r.top - c.top + r.height / 2 };
    };
    let d = "", dots = "", minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < path.edges.length; i++) {
      const p = box(i), q = box(i + 1);
      minX = Math.min(minX, p.l, q.l); maxX = Math.max(maxX, p.r, q.r);
      if (path.edges[i] === "spouse") {
        const [l, r] = p.cx < q.cx ? [p, q] : [q, p];
        dots += `M${l.r + 4},${l.cy}H${r.l - 4}`;
        continue;
      }
      const [hi, lo] = p.cy < q.cy ? [p, q] : [q, p];   // upper and lower card
      const my = (hi.b + lo.t) / 2;
      d += `M${hi.cx},${hi.b}C${hi.cx},${my} ${lo.cx},${my} ${lo.cx},${lo.t}`;
    }
    relWires.innerHTML =
      `<defs><linearGradient id="relGrad" gradientUnits="userSpaceOnUse" x1="${minX}" y1="0" x2="${maxX}" y2="0">` +
      `<stop offset="0" stop-color="#3d6bf5"/><stop offset=".5" stop-color="#9a5cf0"/><stop offset="1" stop-color="#ef4f7a"/></linearGradient></defs>` +
      `<path class="rel-path" d="${d}"/><path class="rel-dots" d="${dots}"/>`;
    const line = relWires.querySelector(".rel-path");
    if (!reduceMotion.matches && line.getTotalLength) {
      const len = line.getTotalLength();
      line.style.strokeDasharray = `${len}`; line.style.strokeDashoffset = `${len}`;
      line.getBoundingClientRect();
      line.style.transition = "stroke-dashoffset .9s cubic-bezier(.3,.7,.2,1)";
      line.style.strokeDashoffset = "0";
    }
  }

  function centerRel() {
    const s = stage.getBoundingClientRect(), r = relCanvas.getBoundingClientRect();
    stage.scrollLeft += (r.left + r.width / 2) - (s.left + s.width / 2);
    stage.scrollTop = 0;
  }

  function renderRelSheet(aId, bId, path) {
    const A = P[aId], B = P[bId];
    const body = [];
    body.push(h("div", { class: "who rel-who", id: "who" },
      h("div", { class: "pair", "aria-hidden": "true" }, avatarFor(A), avatarFor(B)),
      h("div", {},
        h("p", { class: "eyebrow", text: "How they’re related" }),
        h("h1", { class: "rel-title", text: path ? capital(describe(path)) : "Not connected" }),
      ),
    ));
    if (path) {
      const back = findPath(bId, aId);
      body.push(h("p", { class: "rel-sentence" }, h("strong", { text: fullName(B) }), ` is ${fullName(A)}’s ${describe(path)}.`));
      if (back) body.push(h("p", { class: "rel-sentence muted" }, h("strong", { text: fullName(A) }), ` is ${fullName(B)}’s ${describe(back)}.`));
      if (path.blood && path.a > 0 && path.b > 0) {
        const names = path.apexes.map((x) => fullName(P[x]));
        body.push(h("p", { class: "rel-common", text: `${names.length > 1 ? "Closest common ancestors" : "Closest common ancestor"}: ${names.join(" and ")}` }));
      }
      body.push(h("h2", {}, "Step by step", h("span", { class: "count", text: `${path.edges.length} step${path.edges.length > 1 ? "s" : ""}` })));
      body.push(h("ol", { class: "steps" }, path.edges.map((e, i) => {
        const x = path.nodes[i], y = path.nodes[i + 1];
        return h("li", {}, h("span", {},
          h("button", { type: "button", class: "chip plain", "data-id": y, text: fullName(P[y]) }),
          ` is ${fullName(P[x])}’s ${stepRole(x, y, e)}`));
      })));
    } else {
      body.push(h("p", { class: "private-note", text: "These two people aren’t linked through parents, children or marriages recorded in Gramps." }));
    }
    body.push(h("div", { class: "rel-actions" },
      h("button", { type: "button", class: "chip", "data-id": aId }, avatarDot(A), `Open ${fullName(A)}`),
      h("button", { type: "button", class: "chip", "data-id": bId }, avatarDot(B), `Open ${fullName(B)}`),
    ));
    sheetBody.replaceChildren(...body);
    sheetBody.scrollTop = 0;
  }
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const avatarDot = (p) => marker(p);
  function avatarFor(p) {
    const v = `var(--${{ m: "male", f: "female", u: "unknown" }[p.gender]})`;
    const el = avatar(p, p.living ? "living" : "");
    el.style.setProperty("--c", v);
    if (!p.living) el.style.background = v;
    return el;
  }

  function redraw() {
    if (wholeMode) return;
    if (relMode) drawRelWires(findPath(relMode.a, relMode.b));
    else if (focusId && P[focusId]) { const p = P[focusId]; drawWires(p, parentsOf(p), unions(p)); }
  }

  function hideRelation() {
    if (!relMode) return;
    relMode = null;
    document.body.classList.remove("rel-mode");
  }

  function startPick(fromId) {
    pickFrom = fromId;
    pickBanner.replaceChildren(
      h("span", {}, "Choose someone to compare with ", h("strong", { text: fullName(P[fromId]) }), ". Tap a person or search."),
      h("button", { type: "button", class: "rel-btn", id: "pickCancel" }, "Cancel"),
    );
    pickBanner.hidden = false;
    if (!wide.matches) setSheet(false);
  }
  function cancelPick() { pickFrom = null; pickBanner.hidden = true; }

  relView.addEventListener("click", (e) => {
    if (e.target.closest("#relExit")) { location.hash = relMode.a; return; }
    if (e.target.closest("#relSwap")) { location.hash = `rel/${relMode.b}/${relMode.a}`; return; }
    const n = e.target.closest(".node");
    if (n) location.hash = n.dataset.id;
  });
  pickBanner.addEventListener("click", (e) => { if (e.target.closest("#pickCancel")) cancelPick(); });

  /* ---------- whole tree view ---------- */
  const wholeView = $("wholeView"), wSvg = $("wSvg"), wLayer = $("wLayer"), wHint = $("wHint");
  let wholeMode = false, wSel = null, wRel = null, wLayout = null, wLayoutKey = null;
  const layoutCache = new Map();
  let wOnly = true;
  try { wOnly = localStorage.getItem("ft-only") !== "0"; } catch {}
  const view = { x: 0, y: 0, k: 1 };
  const NW = 172, NH = 58, FW = 8;
  const SVGNS = "http://www.w3.org/2000/svg";

  function loadElk() {
    if (window.ELK) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/elk.bundled.js"; s.onload = res; s.onerror = rej;
      document.head.append(s);
    });
  }

  // lay out everyone, or only the given people (cached per set)
  function buildLayout(ids) {
    const key = ids ? [...ids].sort().join(",") : "*";
    if (wLayoutKey === key) return Promise.resolve(wLayout);
    if (!layoutCache.has(key)) layoutCache.set(key, loadElk().then(() => {
      const keep = ids ? new Set(ids) : null, inSet = (x) => x && P[x] && (!keep || keep.has(x));
      const children = [], edges = [];
      for (const p of Object.values(P)) if (inSet(p.id)) children.push({ id: p.id, width: NW, height: NH });
      for (const f of Object.values(F)) {
        const parents = [f.father, f.mother].filter(inSet);
        const kids = f.children.filter(inSet);
        if (!parents.length) continue;
        if (!kids.length && parents.length < 2) continue;
        const fid = "fam:" + f.id;
        children.push({ id: fid, width: FW, height: FW });
        parents.forEach((x) => edges.push({ id: `pe:${x}:${f.id}`, sources: [x], targets: [fid] }));
        kids.forEach((c) => edges.push({ id: `ce:${f.id}:${c}`, sources: [fid], targets: [c] }));
      }
      return new window.ELK().layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.edgeRouting": "ORTHOGONAL",
          "elk.layered.spacing.nodeNodeBetweenLayers": "34",
          "elk.layered.spacing.edgeNodeBetweenLayers": "14",
          "elk.spacing.nodeNode": "16",
          "elk.spacing.edgeNode": "10",
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
          "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
          "elk.separateConnectedComponents": "true",
          "elk.spacing.componentComponent": "70",
        },
        children, edges,
      });
    }));
    return layoutCache.get(key).then((g) => {
      if (wLayoutKey !== key) { wLayout = g; wLayoutKey = key; drawWhole(g); }
      return g;
    });
  }

  const S = (tag, attrs) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  };
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  function drawWhole(g) {
    wLayer.replaceChildren();
    const gEdges = S("g", { class: "w-edges" }), gFams = S("g"), gNodes = S("g");
    for (const e of g.edges) {
      for (const sec of e.sections || []) {
        const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint];
        gEdges.append(S("path", { d: roundedPath(pts), "data-e": e.id }));
      }
    }
    for (const n of g.children) {
      if (n.id.startsWith("fam:")) {
        gFams.append(S("circle", { class: "w-fam", cx: n.x + n.width / 2, cy: n.y + n.height / 2, r: 3.5, "data-n": n.id }));
        continue;
      }
      const p = P[n.id];
      const grp = S("g", { class: `w-node ${p.gender} ${p.living ? "living" : ""}`, transform: `translate(${n.x},${n.y})`, "data-n": p.id, tabindex: "0", role: "button", "aria-label": fullName(p) });
      grp.append(S("rect", { class: "w-card", width: NW, height: NH, rx: 12 }));
      grp.append(S("circle", { class: "w-av", cx: 24, cy: NH / 2, r: 14 }));
      const ini = S("text", { class: "w-ini", x: 24, y: NH / 2 + 4, "text-anchor": "middle" }); ini.textContent = initials(p);
      const nm = S("text", { class: "w-name", x: 46, y: 24 }); nm.textContent = clip(p.given || "Unknown", 17);
      const sub = S("text", { class: "w-sub", x: 46, y: 41 });
      sub.textContent = clip([p.surname, p.living ? "" : lifespan(p)].filter(Boolean).join("  "), 21);
      grp.append(ini, nm, sub);
      gNodes.append(grp);
    }
    wLayer.append(gEdges, gFams, gNodes);
  }

  function roundedPath(pts, r = 8) {
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const d1 = Math.hypot(b.x - a.x, b.y - a.y), d2 = Math.hypot(c.x - b.x, c.y - b.y);
      const rr = Math.min(r, d1 / 2, d2 / 2);
      const p1 = { x: b.x - ((b.x - a.x) / d1) * rr, y: b.y - ((b.y - a.y) / d1) * rr };
      const p2 = { x: b.x + ((c.x - b.x) / d2) * rr, y: b.y + ((c.y - b.y) / d2) * rr };
      d += `L${p1.x},${p1.y}Q${b.x},${b.y} ${p2.x},${p2.y}`;
    }
    const z = pts[pts.length - 1];
    return d + `L${z.x},${z.y}`;
  }

  /* highlight a set of people (+ the family joints between them) */
  function highlight(people, famIds, mode) {
    const hiN = new Set(people), hiF = new Set(famIds.map((f) => "fam:" + f));
    wSvg.classList.toggle("has-sel", people.length > 0);
    wSvg.classList.toggle("path-mode", mode === "path");
    for (const el of wLayer.querySelectorAll(".w-node")) {
      el.classList.toggle("hi", hiN.has(el.dataset.n));
      el.classList.toggle("sel", el.dataset.n === wSel || (wRel && (el.dataset.n === wRel.a || el.dataset.n === wRel.b)));
    }
    for (const el of wLayer.querySelectorAll(".w-fam")) el.classList.toggle("hi", hiF.has(el.dataset.n));
    for (const el of wLayer.querySelectorAll(".w-edges path")) {
      const [kind, a, b] = el.dataset.e.split(":");
      const on = kind === "pe" ? hiN.has(a) && hiF.has("fam:" + b) : hiF.has("fam:" + a) && hiN.has(b);
      el.classList.toggle("hi", on);
      if (on) el.parentNode.append(el); // draw highlighted lines on top
    }
  }

  function lineage(id) {
    const anc = new Set(), desc = new Set();
    const up = [id]; while (up.length) { const x = up.pop(); for (const p of parentIds(x)) if (!anc.has(p)) { anc.add(p); up.push(p); } }
    const dn = [id]; while (dn.length) { const x = dn.pop(); for (const c of childIds(x)) if (!desc.has(c)) { desc.add(c); dn.push(c); } }
    const people = new Set([id, ...anc, ...desc, ...spouseIds(id)]);
    // family joints that connect a highlighted parent to a highlighted child
    const fams = Object.values(F).filter((f) =>
      [f.father, f.mother].some((x) => people.has(x)) && f.children.some((c) => people.has(c)) &&
      // the child must be on the line: either the focus's descendant or the focus/ancestor itself
      f.children.some((c) => (desc.has(c) && [f.father, f.mother].some((x) => x === id || desc.has(x))) || ((c === id || anc.has(c)) && [f.father, f.mother].some((x) => anc.has(x))))
    ).map((f) => f.id);
    return { people: [...people], fams, anc, desc };
  }

  function pathFams(path) {
    const out = [];
    path.edges.forEach((e, i) => {
      const x = path.nodes[i], y = path.nodes[i + 1];
      const f = Object.values(F).find((f) => e === "spouse"
        ? [f.father, f.mother].includes(x) && [f.father, f.mother].includes(y)
        : (e === "up" ? f.children.includes(x) && [f.father, f.mother].includes(y) : f.children.includes(y) && [f.father, f.mother].includes(x)));
      if (f) out.push(f.id);
    });
    return out;
  }

  /* pan & zoom */
  function applyView() { wLayer.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`); }
  function animateTo(t, ms = 420) {
    if (reduceMotion.matches) { Object.assign(view, t); applyView(); return; }
    const from = { ...view }, t0 = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - u, 3);
      view.x = from.x + (t.x - from.x) * e; view.y = from.y + (t.y - from.y) * e; view.k = from.k + (t.k - from.k) * e;
      applyView();
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function visibleBox() {
    const r = wSvg.getBoundingClientRect();
    let h = r.height;
    if (!wide.matches) h = Math.min(h, sheet.getBoundingClientRect().top - r.top);
    return { w: r.width, h };
  }
  function fitBox(minX, minY, maxX, maxY, maxK = 1.1, animate = true) {
    const { w, h } = visibleBox(), pad = 40;
    const k = Math.min(maxK, (w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    const t = { k, x: (w - (maxX + minX) * k) / 2, y: (h - (maxY + minY) * k) / 2 };
    animate ? animateTo(t) : (Object.assign(view, t), applyView());
  }
  function boxOf(ids) {
    const ns = wLayout.children.filter((n) => ids.includes(n.id));
    return [Math.min(...ns.map((n) => n.x)), Math.min(...ns.map((n) => n.y)), Math.max(...ns.map((n) => n.x + n.width)), Math.max(...ns.map((n) => n.y + n.height))];
  }
  function fitAll(animate = true) { fitBox(0, 0, wLayout.width, wLayout.height, 1, animate); }
  function zoomBy(f, cx, cy) {
    const { w, h } = visibleBox();
    cx ??= w / 2; cy ??= h / 2;
    const k = Math.max(0.12, Math.min(2.5, view.k * f));
    view.x = cx - ((cx - view.x) * k) / view.k; view.y = cy - ((cy - view.y) * k) / view.k; view.k = k;
    applyView();
  }

  const ptrs = new Map();
  let dragMoved = 0, pinch0 = null, downNode = null;
  wSvg.addEventListener("pointerdown", (e) => {
    downNode = e.target.closest(".w-node");
    wSvg.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = 0;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  });
  wSvg.addEventListener("pointermove", (e) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) {
      view.x += cur.x - prev.x; view.y += cur.y - prev.y;
      dragMoved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      applyView();
    } else if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()];
      const r = wSvg.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomBy((pinch0.k * d) / pinch0.d / view.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      dragMoved = 99;
    }
  });
  const endPtr = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
  wSvg.addEventListener("pointerup", endPtr);
  wSvg.addEventListener("pointercancel", endPtr);
  wSvg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = wSvg.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0 && e.deltaMode === 1) {
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
    } else {
      view.x -= e.deltaX; view.y -= e.deltaY; applyView();
    }
  }, { passive: false });
  wSvg.addEventListener("click", (e) => {
    if (dragMoved > 6) return;
    const n = downNode || e.target.closest(".w-node");
    downNode = null;
    if (n) go(n.dataset.n, null);
    else if (wSel && !pickFrom && !wRel) location.hash = "all";
  });
  wSvg.addEventListener("keydown", (e) => {
    const n = e.target.closest && e.target.closest(".w-node");
    if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(n.dataset.n, null); }
  });
  wholeView.addEventListener("click", (e) => {
    const b = e.target.closest("[data-zoom]");
    if (!b || !wLayout) return;
    const z = b.dataset.zoom;
    if (z === "in") zoomBy(1.3); else if (z === "out") zoomBy(1 / 1.3); else fitAll();
  });

  /* entering / leaving */
  function setViewToggle() {
    for (const b of document.querySelectorAll(".views button")) b.setAttribute("aria-pressed", String((b.dataset.view === "all") === wholeMode));
  }
  async function showWhole(selId, rel) {
    const entering = !wholeMode;
    wholeMode = true;
    closeViewer();
    hideRelation();
    document.body.classList.add("whole-mode");
    setViewToggle();
    wSel = rel ? null : selId; wRel = rel || null;
    const path = rel ? findPath(rel.a, rel.b) : null;
    const L = selId && !rel ? lineage(selId) : null;
    const subset = !wOnly ? null : rel ? (path ? path.nodes : null) : L ? L.people : null;
    const before = wLayoutKey;
    if (!layoutCache.size) { wHint.textContent = "Laying out the whole tree…"; wHint.hidden = false; }
    await buildLayout(subset);
    wHint.hidden = true;
    const relaid = before !== wLayoutKey;
    const anim = !entering && !relaid;
    renderOnlyToggle(!!(rel || selId));
    if (rel) {
      highlight(path ? path.nodes : [rel.a, rel.b], path ? pathFams(path) : [], "path");
      renderRelSheet(rel.a, rel.b, path);
      sheetBody.prepend(h("button", { type: "button", class: "rel-btn whole-back", "data-goto": `all/${rel.a}` }, "Clear comparison"));
      const ids = path ? path.nodes : [rel.a, rel.b];
      const [x0, y0, x1, y1] = boxOf(ids);
      fitBox(x0, y0, x1, y1, 1, anim);
      document.title = `${fullName(P[rel.a])} and ${fullName(P[rel.b])} | ${DATA.title}`;
      return;
    }
    if (selId) {
      highlight(L.people, L.fams, "lineage");
      renderSheet(P[selId]);
      const extra = h("p", { class: "whole-note" },
        `Highlighted: ${L.anc.size} ancestor${L.anc.size === 1 ? "" : "s"} and ${L.desc.size} descendant${L.desc.size === 1 ? "" : "s"} of ${fullName(P[selId])}.`);
      const who = sheetBody.querySelector(".who");
      who.after(extra, h("button", { type: "button", class: "rel-btn whole-back", "data-goto": selId }, "Open in focus view"));
      const [x0, y0, x1, y1] = boxOf(L.people);
      const { w, h: vh } = visibleBox(), pad = 40;
      const kFit = Math.min(1, (w - pad * 2) / (x1 - x0), (vh - pad * 2) / (y1 - y0));
      if (kFit >= 0.45) fitBox(x0, y0, x1, y1, 1, anim);
      else {
        // too big to read when fitted: stay readable and center on the person instead
        const n = wLayout.children.find((c) => c.id === selId), k = 0.6;
        const t = { k, x: w / 2 - (n.x + NW / 2) * k, y: Math.max(pad, vh / 2 - (n.y + NH / 2) * k) };
        anim ? animateTo(t) : (Object.assign(view, t), applyView());
      }
      document.title = `${fullName(P[selId])} | ${DATA.title}`;
    } else {
      highlight([], [], null);
      sheetBody.replaceChildren(
        h("div", { class: "who" }, h("div", {},
          h("h1", { text: "Whole tree" }),
          h("p", { class: "lifespan", text: `${Object.keys(P).length} people. Tap anyone to light up their ancestors and descendants.` }))),
      );
      if (entering || relaid) fitAll(false);
      document.title = `Whole tree | ${DATA.title}`;
    }
  }
  const onlyBtn = $("wOnly");
  function renderOnlyToggle(show) {
    onlyBtn.hidden = !show;
    onlyBtn.setAttribute("aria-pressed", String(wOnly));
    onlyBtn.textContent = wOnly ? "Show everyone" : "Just this line";
  }
  onlyBtn.addEventListener("click", () => {
    wOnly = !wOnly;
    try { localStorage.setItem("ft-only", wOnly ? "1" : "0"); } catch {}
    route();
  });
  function hideWhole() {
    if (!wholeMode) return false;
    wholeMode = false; wSel = null; wRel = null;
    document.body.classList.remove("whole-mode");
    setViewToggle();
    return true;
  }
  sheetBody.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b) { e.stopPropagation(); location.hash = b.dataset.goto; }
  }, true);
  document.querySelector(".views").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    if (b.dataset.view === "all") location.hash = `all/${wSel || (relMode ? relMode.a : focusId) || DATA.home}`;
    else location.hash = wRel ? `rel/${wRel.a}/${wRel.b}` : (wSel || focusId || DATA.home);
  });

  /* descendant counts for the focus view */
  const descMemo = new Map();
  function descendantCount(id) {
    if (descMemo.has(id)) return descMemo.get(id);
    const seen = new Set(), st = [id];
    while (st.length) { const x = st.pop(); for (const c of childIds(x)) if (!seen.has(c)) { seen.add(c); st.push(c); } }
    descMemo.set(id, seen.size);
    return seen.size;
  }

  function route() {
    const hash = decodeURIComponent(location.hash.slice(1));
    const w = hash.match(/^all(?:\/rel\/([^/]+)\/([^/]+)|\/([^/]+))?$/);
    if (w) {
      if (w[1] && P[w[1]] && P[w[2]]) showWhole(null, { a: w[1], b: w[2] });
      else showWhole(P[w[3]] ? w[3] : null);
      return;
    }
    const wasWhole = hideWhole();
    if (wasWhole) { focusId = null; pendingRect = null; }
    const m = hash.match(/^rel\/([^/]+)\/([^/]+)$/);
    if (m && P[m[1]] && P[m[2]]) { showRelation(m[1], m[2]); return; }
    const id = P[hash] ? hash : DATA.home;
    const wasRel = !!relMode;
    hideRelation();
    if (wasRel || id !== focusId) { if (wasRel) pendingRect = null; render(id); }
  }

  /* ---------- navigation ---------- */
  function go(id, fromEl) {
    if (!P[id]) return;
    if (pickFrom) {
      const a = pickFrom;
      if (id === a) return;
      cancelPick();
      location.hash = `${wholeMode ? "all/" : ""}rel/${a}/${id}`;
      return;
    }
    if (wholeMode) { location.hash = `all/${id}`; return; }
    if (id === focusId && !relMode) { if (!wide.matches) setSheet(!sheet.classList.contains("open")); return; }
    pendingRect = fromEl ? fromEl.getBoundingClientRect() : null;
    if (location.hash.slice(1) !== id) location.hash = id;
    else render(id);
  }

  canvas.addEventListener("click", (e) => {
    const n = e.target.closest(".node");
    if (n) go(n.dataset.id, n);
  });
  sheetBody.addEventListener("click", (e) => {
    const rs = e.target.closest(".rel-start");
    if (rs) { e.stopPropagation(); startPick(rs.dataset.rel); return; }
    const r = e.target.closest(".rec-open");
    if (r) { openViewer(P[sheetPid], +r.dataset.rec); return; }
    const c = e.target.closest(".chip");
    if (c) {
      const target = rowGP.querySelector(`[data-id="${CSS.escape(c.dataset.id)}"]`) ||
        rowP.querySelector(`[data-id="${CSS.escape(c.dataset.id)}"]`) ||
        rowF.querySelector(`[data-id="${CSS.escape(c.dataset.id)}"]`) ||
        rowC.querySelector(`[data-id="${CSS.escape(c.dataset.id)}"]`);
      if (!wide.matches) setSheet(false);
      go(c.dataset.id, target);
      return;
    }
    if (!wide.matches && e.target.closest("#who")) setSheet(!sheet.classList.contains("open"));
  });
  grip.addEventListener("click", () => setSheet(!sheet.classList.contains("open")));
  window.addEventListener("hashchange", route);
  $("homeBtn").addEventListener("click", () => go(DATA.home, rowF.querySelector(".focus")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (closeViewer()) return; if (!results.hidden) closeResults(); else if (pickFrom) cancelPick(); else setSheet(false); }
  });

  // simple swipe on the sheet's top area (mobile)
  let touchY = null;
  sheet.addEventListener("touchstart", (e) => { if (sheetBody.scrollTop <= 0) touchY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener("touchend", (e) => {
    if (touchY == null) return;
    const dy = e.changedTouches[0].clientY - touchY; touchY = null;
    if (dy < -40) setSheet(true); else if (dy > 50) setSheet(false);
  }, { passive: true });

  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(redraw, 120);
  });

  /* ---------- search ---------- */
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let index = [], sel = -1;
  function search(text) {
    const terms = norm(text).split(/\s+/).filter(Boolean);
    if (!terms.length) return closeResults();
    const hits = index.filter((x) => terms.every((t) => x.key.includes(t))).slice(0, 40);
    sel = hits.length ? 0 : -1;
    results.replaceChildren(...(hits.length ? hits.map((x, i) =>
      h("li", { role: "option", "data-id": x.p.id, "aria-selected": String(i === 0) },
        marker(x.p), h("span", { text: fullName(x.p) }), h("span", { class: "yrs", text: x.p.living ? "Living" : lifespan(x.p) })))
      : [h("li", { class: "empty", text: "No one by that name." })]));
    results.hidden = false;
  }
  function closeResults() { results.hidden = true; sel = -1; }
  function pick(id) { closeResults(); q.value = ""; q.blur(); go(id, null); }
  q.addEventListener("input", () => search(q.value));
  q.addEventListener("keydown", (e) => {
    const items = [...results.querySelectorAll("li[data-id]")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
      items[sel].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && items[sel]) {
      pick(items[sel].dataset.id);
    }
  });
  results.addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) pick(li.dataset.id); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) closeResults(); });

  /* ---------- boot ---------- */
  fetch("data/tree.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      DATA = data; P = data.people; F = data.families;
      buildShared();
      $("siteTitle").textContent = data.title;
      index = Object.values(P)
        .map((p) => ({ p, key: norm(`${fullName(p)} ${p.nick || ""} ${lifespan(p)}`) }))
        .sort((a, b) => fullName(a.p).localeCompare(fullName(b.p)));
      route();
      if (document.fonts) document.fonts.ready.then(redraw);
    })
    .catch(() => {
      sheetBody.replaceChildren(h("p", { class: "private-note", text: "The family data could not be loaded. Check that data/tree.json was uploaded next to index.html." }));
    });
})();
