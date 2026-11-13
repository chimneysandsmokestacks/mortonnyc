#!/usr/bin/env python3
"""Turn research findings (findings.md) into Gramps Repository / Source / Citation records.
Each finding -> one Citation (page = folio/scan, attribute URL = scan link) with a Transcript note
(original German) and a Citation note (English summary). Citations are attached to the people the
finding names (mapping below = the plan James approved 2026-11-11). The old person link-notes that
pointed at the same scan with the same label are removed (their content now lives in the citation).
Usage: to_citations.py SQLITE_DB FINDINGS_MD BOOKS_JSON LINKS_TSV
"""
import sqlite3, json, sys, re, time, random

DB, FIND, BOOKS, LINKS = sys.argv[1:5]
PLAN_NOTES = set()   # exact "url (label)" texts created by the 2026-11-11 plan, per person
for ln in open(LINKS, encoding="utf-8"):
    g, u, lab = ln.rstrip("\n").split("\t")
    PLAN_NOTES.add((g, f"{u} ({lab})"))
P = {
'I0128':['F94','F93','F1','F77','F5','F7','F99'],
'I0131':['F99'], 'I0141':['F99'],
'I0028':['F79','F6','F19','F20','F55','F21','F86','F89','F90','F87','F88'],
'I0070':['F1','F4','F93','F9','F2','F98','F96','F100','F101','F102'],
'I0078':['F82','F92','F11','F15','F16','F12','F13','F17','F52','F38','F42','F65','F68','F97','F100','F102','F84','F103'],
'I0110':['F80','F81','F83','F85','F91','F84','F43','F44','F45','F46','F47','F48','F67','F50','F17','F52'],
'I0104':['F84','F97'],
'I0027':['F97','F100','F103','F29','F30','F31'],
'I0109':['F93'],
}
PROBABLY = {('I0028',f) for f in ['F86','F89','F90','F87','F88']} | {('I0027',f) for f in ['F29','F30','F31']} | {('I0109','F93')}

now = int(time.time())
def handle():
    time.sleep(0.0002); return "%08x%08x" % (int(time.time() * 10000), random.getrandbits(32))
def date0():
    return {"_class": "Date", "calendar": 0, "modifier": 0, "quality": 0, "dateval": [0, 0, 0, False],
            "text": "", "sortval": 0, "newyear": 0, "format": None}
def gtype(cls, value, string=""):
    return {"_class": cls, "value": value, "string": string}

c = sqlite3.connect(DB)
def next_id(table, prefix):
    nums = [int(r[0][len(prefix):]) for r in c.execute(f"select gramps_id from {table}") if r[0] and r[0][len(prefix):].isdigit()]
    return f"{prefix}{(max(nums) + 1 if nums else 0):04d}"
def add_ref(obj, ocls, ref, rcls):
    c.execute("insert into reference(obj_handle,obj_class,ref_handle,ref_class) values(?,?,?,?)", (obj, ocls, ref, rcls))
def new_note(text, ntype, fmt):
    h, gid = handle(), next_id("note", "N")
    n = {"_class": "Note", "handle": h, "gramps_id": gid, "text": {"_class": "StyledText", "string": text, "tags": []},
         "format": fmt, "type": gtype("NoteType", ntype), "change": now, "tag_list": [], "private": False}
    cols = [r[1] for r in c.execute("pragma table_info(note)")]
    row = {"handle": h, "gramps_id": gid, "format": fmt, "change": now, "private": 0, "json_data": json.dumps(n)}
    c.execute(f"insert into note({','.join(k for k in row if k in cols)}) values({','.join('?' for k in row if k in cols)})",
              [v for k, v in row.items() if k in cols])
    return h

# ---- parse findings
rows = {}
for line in open(FIND, encoding="utf-8"):
    m = re.match(r"\| (F\d+) \|(.*)", line)
    if not m: continue
    cells = [x.strip() for x in line.strip().strip("|").split(" | ")]
    if len(cells) < 6: continue
    fid, names, book, page, what, orig = cells[0], cells[1], cells[2], cells[3], cells[4], " | ".join(cells[5:])
    urls = re.findall(r"\]\((https://[^)]+)\)", page)
    if not urls: continue
    rows[fid] = dict(names=names, book=book, urls=urls, what=what, orig=orig.strip().strip('|').strip())
books = {b["id"][:8]: b for b in json.load(open(BOOKS, encoding="utf-8"))}

# ---- repository
cols_repo = [r[1] for r in c.execute("pragma table_info(repository)")]
rh, rgid = handle(), next_id("repository", "R")
repo = {"_class": "Repository", "handle": rh, "gramps_id": rgid, "type": gtype("RepositoryType", 4),
        "name": "Moravský zemský archiv v Brně (MZA)", "note_list": [], "address_list": [],
        "urls": [{"_class": "Url", "private": False, "path": "https://www.mza.cz/aron/", "desc": "ARchiv ONline",
                  "type": gtype("UrlType", 2)}],
        "change": now, "tag_list": [], "private": False}
c.execute("insert into repository(handle,gramps_id,name,change,private,json_data) values(?,?,?,?,?,?)",
          (rh, rgid, repo["name"], now, 0, json.dumps(repo)))

# ---- sources (one per archive book)
src_for = {}
def source(book_id, label):
    if book_id in src_for: return src_for[book_id]
    b = books.get(book_id[:8])
    title = f"{b['title']}, {b['years']}" if b else label
    author = "Archiv města Kyjov (SOkA Hodonín)" if b else "MZA Brno, Pozemkové knihy"
    sh, sgid = handle(), next_id("source", "S")
    s = {"_class": "Source", "handle": sh, "gramps_id": sgid, "title": title, "author": author,
         "pubinfo": "Digitised in ARON (ARchiv ONline), Moravský zemský archiv", "note_list": [], "media_list": [],
         "abbrev": "", "change": now,
         "attribute_list": [{"_class": "SrcAttribute", "private": False, "type": gtype("SrcAttributeType", 0, "URL"),
                             "value": f"https://www.mza.cz/aron/apu/{book_id}"}],
         "reporef_list": [{"_class": "RepoRef", "note_list": [], "ref": rh, "call_number": "",
                           "media_type": gtype("SourceMediaType", 2), "private": False}],
         "tag_list": [], "private": False}
    c.execute("insert into source(handle,gramps_id,title,author,pubinfo,abbrev,change,private,json_data) values(?,?,?,?,?,?,?,?,?)",
              (sh, sgid, title, author, s["pubinfo"], "", now, 0, json.dumps(s)))
    add_ref(sh, "Source", rh, "Repository")
    src_for[book_id] = sh
    return sh

ABBR = {"I", "II", "III", "No", "Nr", "N", "fol", "ca", "St", "Dr", "fl", "kr", "C.M", "W.W", "Jud", "p", "pp", "vol"}
def short(what):
    t = re.sub(r"\*\*", "", what).strip()
    for m in re.finditer(r"[.;:](?=\s)", t):
        prev = re.findall(r"[\w.]+$", t[:m.start()])
        if m.group() == "." and prev and prev[0] in ABBR:
            continue
        if m.start() >= 40:
            t = t[:m.start()]
            break
    return t if len(t) <= 110 else t[:107].rsplit(" ", 1)[0] + "…"

cit_for = {}
for fid, r in sorted(rows.items(), key=lambda kv: int(kv[0][1:])):
    url = r["urls"][0]
    m = re.search(r"/apu/([0-9a-f-]{36})/", url)
    book_id = m.group(1) if m else "unknown"
    sh = source(book_id, r["book"])
    pm = re.search(r"\)\s*,\s*(.+)$", r["book"])
    scan = re.search(r"scan (\d+)", " ".join([r["book"]] + [r["urls"][0]])) 
    page = (pm.group(1) if pm else r["book"]).strip()
    page = re.sub(r"\*\*", "", page)[:200]
    summary = re.sub(r"\*\*", "", r["what"])
    orig = r["orig"].strip()
    notes = []
    if orig and orig not in ("—", "-"):
        notes.append(new_note(orig, 3, 1))          # Transcript (original German), preformatted
    notes.append(new_note(f"Summary (English): {summary}\n\nResearch finding {fid}.", 22, 0))   # Citation note
    ch, cgid = handle(), next_id("citation", "C")
    attrs = [{"_class": "SrcAttribute", "private": False, "type": gtype("SrcAttributeType", 0, "URL"), "value": u} for u in r["urls"]]
    attrs.append({"_class": "SrcAttribute", "private": False, "type": gtype("SrcAttributeType", 0, "Label"), "value": short(r["what"])})
    attrs.append({"_class": "SrcAttribute", "private": False, "type": gtype("SrcAttributeType", 0, "Finding"), "value": fid})
    cit = {"_class": "Citation", "handle": ch, "gramps_id": cgid, "date": date0(), "page": page, "confidence": 2,
           "source_handle": sh, "note_list": notes, "media_list": [], "attribute_list": attrs,
           "change": now, "tag_list": [], "private": False}
    c.execute("insert into citation(handle,gramps_id,page,confidence,source_handle,change,private,json_data) values(?,?,?,?,?,?,?,?)",
              (ch, cgid, page, 2, sh, now, 0, json.dumps(cit)))
    add_ref(ch, "Citation", sh, "Source")
    for nh in notes: add_ref(ch, "Citation", nh, "Note")
    cit_for[fid] = (ch, url)

# ---- attach to people, drop the matching old link notes
removed = attached = 0
for gid, fids in P.items():
    h, j = c.execute("select handle,json_data from person where gramps_id=?", (gid,)).fetchone()
    p = json.loads(j)
    for fid in fids:
        if fid not in cit_for: print("no citation for", fid); continue
        ch, url = cit_for[fid]
        if (gid, fid) in PROBABLY:
            p["attribute_list"].append({"_class": "Attribute", "private": False, "citation_list": [], "note_list": [],
                "type": gtype("AttributeType", 0, "Uncertain identification"),
                "value": f"{fid}: probably this person (citation {json.loads(c.execute('select json_data from citation where handle=?', (ch,)).fetchone()[0])['gramps_id']})"})
        if ch not in p["citation_list"]:
            p["citation_list"].append(ch); add_ref(h, "Person", ch, "Citation"); attached += 1
        # old note = exactly "<url> (<label>)" that this plan created; delete one per finding
        for nh in list(p["note_list"]):
            n = json.loads(c.execute("select json_data from note where handle=?", (nh,)).fetchone()[0])
            s = n["text"]["string"]
            if (gid, s) in PLAN_NOTES and s.startswith(url + " ("):
                p["note_list"].remove(nh)
                c.execute("delete from reference where obj_handle=? and ref_handle=?", (h, nh))
                if not c.execute("select 1 from reference where ref_handle=?", (nh,)).fetchone():
                    c.execute("delete from note where handle=?", (nh,))
                removed += 1
                break
    p["change"] = now
    c.execute("update person set json_data=?,change=? where handle=?", (json.dumps(p), now, h))
c.commit()
assert c.execute("pragma integrity_check").fetchone()[0] == "ok"
print(f"repository 1, sources {len(src_for)}, citations {len(cit_for)}, person-citation links {attached}, old link notes removed {removed}")
