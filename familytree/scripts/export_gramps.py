#!/usr/bin/env python3
"""
Export a Gramps 6 family tree (SQLite backend) to data/tree.json for the website.

Usage (from the site folder, e.g. familytree/):
    python3 scripts/export_gramps.py                       # uses the default tree below
    python3 scripts/export_gramps.py /path/to/tree-folder  # a Gramps tree folder or its sqlite.db
    python3 scripts/export_gramps.py /path/to/tree data/tree.json

Privacy: for anyone who is probably alive, only their name, gender and family
links are exported - no dates, places, notes or links. Records marked private
in Gramps are never exported.

The database is opened read-only, so this is safe to run with Gramps open,
though closing Gramps first makes sure every edit has been saved.
"""
import io
import json
import os
import pickle
import re
import sqlite3
import sys
from datetime import date
from urllib.parse import urlparse

DEFAULT_TREE = os.path.expanduser("~/Documents/Gramps/624864cb")
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tree.json")

LIVING_CUTOFF_YEARS = 100   # born within this many years and no death record => living
GENERATION_GAP = 25         # used to estimate birth years from relatives
MAX_NOTE_TEXT = 500         # longer free-text notes (pasted web pages etc.) are skipped

EVT_BIRTH, EVT_DEATH, EVT_MARRIAGE = 12, 13, 1
EVT_LABELS = {1: "Marriage", 12: "Birth", 13: "Death", 4: "Baptism", 5: "Burial",
              6: "Christening", 7: "Confirmation", 8: "Cremation", 11: "Bar Mitzvah"}
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SITE_NAMES = {
    "vademecum.nacr.cz": "Czech National Archives",
    "www.familysearch.org": "FamilySearch",
    "www.genteam.at": "GenTeam",
    "photos.geni.com": "Geni photo",
    "www.facebook.com": "Facebook",
    "vhaonline.usc.edu": "USC Shoah Foundation",
    "drive.google.com": "Family documents",
    "www.digital.wienbibliothek.at": "Wienbibliothek",
    "digital.wienbibliothek.at": "Wienbibliothek",
    "www.geni.com": "Geni",
}
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


class _SafeUnpickler(pickle.Unpickler):
    """Only used for the home-person setting; refuses anything that would import code."""
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"refusing to load {module}.{name}")


def _table(conn, name):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({name})")]
    if "json_data" not in cols:
        sys.exit("This database uses the pre-Gramps-6 format. Open it once in Gramps 6 to upgrade it.")
    return {h: json.loads(j) for h, j in conn.execute(f"SELECT handle, json_data FROM {name}")}


def _home_handle(conn):
    row = conn.execute("SELECT value, json_data FROM metadata WHERE setting='default-person-handle'").fetchone()
    if not row:
        return None
    value, js = row
    if js:
        try:
            v = json.loads(js)
            if isinstance(v, str):
                return v
        except ValueError:
            pass
    try:
        return _SafeUnpickler(io.BytesIO(value)).load()
    except Exception:
        return None


# ---------- dates & places ----------

def fmt_date(d):
    """Gramps Date -> (display string, year or None)."""
    if not d:
        return None, None
    modifier, quality, dateval, text = d.get("modifier", 0), d.get("quality", 0), d.get("dateval") or [0, 0, 0, False], d.get("text") or ""
    day, month, year = dateval[0], dateval[1], dateval[2]
    if modifier == 6 or not year:  # text-only or invalid date
        m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", text)
        return (text or None), (int(m.group(1)) if m else None)
    parts = [str(day)] if day else []
    if month:
        parts.append(MONTHS[month])
    parts.append(str(year))
    s = " ".join(parts)
    prefix = {1: "before ", 2: "after ", 3: "about "}.get(modifier, "")
    if modifier in (4, 5) and len(dateval) >= 7 and dateval[6]:
        s = f"{s} – {dateval[6]}"
    if quality == 1 and not prefix:
        prefix = "est. "
    return prefix + s, year


def place_name(places, handle, depth=0):
    pl = places.get(handle) if handle else None
    if not pl or pl.get("private") or depth > 6:
        return None
    name = ((pl.get("name") or {}).get("value") or "") or pl.get("title") or ""
    refs = pl.get("placeref_list") or []
    if refs:
        parent = place_name(places, refs[0].get("ref"), depth + 1)
        if parent and parent not in name:
            name = f"{name}, {parent}"
    return name or None


# ---------- notes -> links ----------

def note_content(notes, handle, context):
    """Return (links, text) from a note."""
    n = notes.get(handle)
    if not n or n.get("private"):
        return [], None
    text = (n.get("text") or {}).get("string") or ""
    links = []
    for line in text.splitlines():
        for m in URL_RE.finditer(line):
            url = m.group(0).rstrip(".,;")
            label = URL_RE.sub("", line[:m.start()] + " " + line[m.end():])
            label = re.sub(r"^[\s(:\-–v]+|[\s):\-–]+$", "", label.strip())
            host = urlparse(url).netloc
            links.append({
                "url": url,
                "site": SITE_NAMES.get(host, host.replace("www.", "")),
                "label": label[:120] if len(label) > 1 else None,
                "context": context,
            })
    lines = [l.strip() for l in URL_RE.sub("", text).splitlines()]
    lines = [l for l in lines if l and not re.fullmatch(r"[\s()v:.,\-–]*", l)]
    used = {lk["label"] for lk in links if lk["label"]}
    lines = [l for l in lines if re.sub(r"^[\s(:\-–v]+|[\s):\-–]+$", "", l) not in used]
    body = "\n".join(lines).strip()
    if not body or len(body) > MAX_NOTE_TEXT:
        body = None
    return links, body


# ---------- main export ----------

def export(db_path, out_path):
    if os.path.isdir(db_path):
        db_path = os.path.join(db_path, "sqlite.db")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    persons = _table(conn, "person")
    families = _table(conn, "family")
    events = _table(conn, "event")
    places = _table(conn, "place")
    notes = _table(conn, "note")
    home_handle = _home_handle(conn)

    def evt(ref):
        e = events.get(ref.get("ref"))
        return None if (e is None or e.get("private") or ref.get("private")) else e

    def person_event(p, idx):
        refs = p.get("event_ref_list") or []
        if idx is None or idx < 0 or idx >= len(refs):
            return None
        return evt(refs[idx])

    etype = lambda e: (e.get("type") or {}).get("value")

    # --- birth years, with estimates from relatives, to decide who is living
    birth_year, has_death = {}, {}
    for h, p in persons.items():
        b = person_event(p, p.get("birth_ref_index", -1))
        birth_year[h] = fmt_date(b.get("date"))[1] if b else None
        has_death[h] = bool(person_event(p, p.get("death_ref_index", -1))) or any(
            (e := evt(r)) and etype(e) in (EVT_DEATH, 5, 8) for r in p.get("event_ref_list") or [])

    est = dict(birth_year)
    for _ in range(8):  # propagate through the tree a few times
        changed = False
        for f in families.values():
            parents = [x for x in (f.get("father_handle"), f.get("mother_handle")) if x in persons]
            kids = [c["ref"] for c in f.get("child_ref_list") or [] if c.get("ref") in persons]
            for par in parents:
                if est.get(par) is None:
                    cands = [est[k] - GENERATION_GAP for k in kids if est.get(k)]
                    cands += [est[o] for o in parents if o != par and est.get(o)]
                    if cands:
                        est[par] = min(cands); changed = True
            for k in kids:
                if est.get(k) is None:
                    cands = [est[x] + GENERATION_GAP for x in parents if est.get(x)]
                    cands += [est[s] for s in kids if s != k and est.get(s)]
                    if cands:
                        est[k] = max(cands); changed = True
        if not changed:
            break

    cutoff = date.today().year - LIVING_CUTOFF_YEARS

    def is_living(h):
        if has_death[h]:
            return False
        y = est.get(h)
        return True if y is None else y > cutoff  # unknown => treat as living (safe)

    pid = {h: p["gramps_id"] for h, p in persons.items()}
    fid = {h: f["gramps_id"] for h, f in families.items()}

    out_people = {}
    for h, p in persons.items():
        if p.get("private"):
            continue
        name = p.get("primary_name") or {}
        given = (name.get("first_name") or "").strip()
        surname = " ".join(s.get("surname", "") for s in name.get("surname_list") or [] if s.get("surname")).strip()
        nick = name.get("nick") or ""
        rec = {
            "id": p["gramps_id"],
            "gender": {0: "f", 1: "m"}.get(p.get("gender"), "u"),
            "surname": surname,
            "parents": [fid[f] for f in p.get("parent_family_list") or [] if f in fid],
            "families": [fid[f] for f in p.get("family_list") or [] if f in fid],
        }
        if is_living(h):
            # living: name only - no dates, places, notes or links
            rec.update(living=True, given=given or "Unknown")
            if nick:
                rec["nick"] = nick
            out_people[rec["id"]] = rec
            continue

        rec.update(given=given or "Unknown", living=False)
        if nick:
            rec["nick"] = nick
        for key, ev in (("birth", person_event(p, p.get("birth_ref_index", -1))),
                        ("death", person_event(p, p.get("death_ref_index", -1)))):
            if ev:
                ds, _ = fmt_date(ev.get("date"))
                pl = place_name(places, ev.get("place"))
                if ds or pl:
                    rec[key] = {k: v for k, v in (("date", ds), ("place", pl)) if v}

        links, texts = [], []
        for nh in p.get("note_list") or []:
            lk, tx = note_content(notes, nh, "Person")
            links += lk
            texts += [tx] if tx else []
        for r in p.get("event_ref_list") or []:
            e = evt(r)
            if not e:
                continue
            label = EVT_LABELS.get(etype(e), (e.get("type") or {}).get("string") or "Event")
            for nh in (e.get("note_list") or []) + (r.get("note_list") or []):
                lk, tx = note_content(notes, nh, f"{label} record")
                links += lk
                texts += [f"{label}: {tx}"] if tx else []
            if etype(e) not in (EVT_BIRTH, EVT_DEATH):
                ds, _ = fmt_date(e.get("date"))
                pl = place_name(places, e.get("place"))
                if ds or pl:
                    rec.setdefault("events", []).append(
                        {k: v for k, v in (("type", label), ("date", ds), ("place", pl)) if v})
        seen, uniq = set(), []
        for lk in links:
            if lk["url"] not in seen:
                seen.add(lk["url"]); uniq.append(lk)
        if uniq:
            rec["links"] = uniq
        if texts:
            rec["notes"] = texts
        out_people[rec["id"]] = rec

    out_fams = {}
    for h, f in families.items():
        if f.get("private"):
            continue
        fa, mo = f.get("father_handle"), f.get("mother_handle")
        father = pid.get(fa) if fa in persons else None
        mother = pid.get(mo) if mo in persons else None
        rec = {
            "id": f["gramps_id"],
            "father": father if father in out_people else None,
            "mother": mother if mother in out_people else None,
            "children": [pid[c["ref"]] for c in f.get("child_ref_list") or []
                         if c.get("ref") in pid and pid[c["ref"]] in out_people],
        }
        couple_living = any(out_people.get(x, {}).get("living") for x in (father, mother) if x)
        if not couple_living:
            links = []
            for nh in f.get("note_list") or []:
                lk, _ = note_content(notes, nh, "Marriage record")
                links += lk
            for r in f.get("event_ref_list") or []:
                e = evt(r)
                if e and etype(e) == EVT_MARRIAGE:
                    ds, _ = fmt_date(e.get("date")); pl = place_name(places, e.get("place"))
                    if ds or pl:
                        rec["marriage"] = {k: v for k, v in (("date", ds), ("place", pl)) if v}
                    for nh in e.get("note_list") or []:
                        lk, _ = note_content(notes, nh, "Marriage record")
                        links += lk
            if links:
                rec["links"] = links
        out_fams[rec["id"]] = rec

    home = pid.get(home_handle) if home_handle else None
    if home not in out_people:
        home = sorted(out_people)[0]

    data = {"title": "Family Tree", "home": home, "generated": date.today().isoformat(),
            "people": out_people, "families": out_fams}
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    living = sum(1 for p in out_people.values() if p["living"])
    nlinks = sum(len(p.get("links", [])) for p in out_people.values())
    print(f"Exported {len(out_people)} people ({living} living, details hidden), "
          f"{len(out_fams)} families, {nlinks} person links -> {out_path}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) > 2 or (args and args[0] in ("-h", "--help")):
        sys.exit(__doc__)
    export(args[0] if args else DEFAULT_TREE, args[1] if len(args) > 1 else DEFAULT_OUT)
