#!/usr/bin/env python3
"""
Export a Gramps (5.1, SQLite backend) family tree to data/tree.json for the website.

Usage:
    python3 scripts/export_gramps.py /path/to/gramps/tree/folder/sqlite.db data/tree.json

Privacy: for anyone who is probably alive, only their name, gender and family
links are exported - no dates, places, notes or links.
Records marked private in Gramps are never exported.
"""
import io
import json
import pickle
import re
import sqlite3
import sys
from datetime import date
from urllib.parse import urlparse

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
}
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


class _SafeUnpickler(pickle.Unpickler):
    """Gramps rows are plain tuples/lists; refuse anything that would import code."""
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"refusing to load {module}.{name}")


def _load(blob):
    return _SafeUnpickler(io.BytesIO(blob)).load()


def _table(conn, name):
    return {row[0]: _load(row[1]) for row in conn.execute(f"SELECT handle, blob_data FROM {name}")}


# ---------- dates & places ----------

def fmt_date(d):
    """Gramps Date tuple -> (display string, year or None)."""
    if not d:
        return None, None
    _cal, modifier, quality, dateval, text, _sortval, _ny = d
    day, month, year = dateval[0], dateval[1], dateval[2]
    if modifier == 6 or not year:  # text-only or invalid date
        m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", text or "")
        return (text or None), (int(m.group(1)) if m else None)
    parts = []
    if day:
        parts.append(str(day))
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
    if not handle or handle not in places or depth > 6:
        return None
    pl = places[handle]
    if pl[17]:  # private
        return None
    name = (pl[6][0] if pl[6] else "") or pl[2]
    parent_refs = pl[5]
    if parent_refs:
        parent = place_name(places, parent_refs[0][0], depth + 1)
        if parent and parent not in name:
            name = f"{name}, {parent}"
    return name or None


# ---------- notes -> links ----------

def note_content(notes, handle, context):
    """Return (links, text) from a note."""
    n = notes.get(handle)
    if not n or n[7]:  # missing or private
        return [], None
    text = n[2][0] or ""
    links = []
    for line in text.splitlines():
        for m in URL_RE.finditer(line):
            url = m.group(0).rstrip(".,;")
            label = (line[:m.start()] + " " + line[m.end():])
            label = URL_RE.sub("", label)
            label = re.sub(r"^[\s(:\-–v]+|[\s):\-–]+$", "", label.strip())
            host = urlparse(url).netloc
            links.append({
                "url": url,
                "site": SITE_NAMES.get(host, host.replace("www.", "")),
                "label": label[:120] if len(label) > 1 else None,
                "context": context,
            })
    rest = URL_RE.sub("", text)
    # drop lines that were only annotations already attached to a link
    lines = [l.strip() for l in rest.splitlines()]
    lines = [l for l in lines if l and not re.fullmatch(r"[\s()v:.,\-–]*", l)]
    used = {lk["label"] for lk in links if lk["label"]}
    lines = [l for l in lines if re.sub(r"^[\s(:\-–v]+|[\s):\-–]+$", "", l) not in used]
    body = "\n".join(lines).strip()
    if not body or len(body) > MAX_NOTE_TEXT:
        body = None
    return links, body


# ---------- main export ----------

def export(db_path, out_path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    persons = _table(conn, "person")
    families = _table(conn, "family")
    events = _table(conn, "event")
    places = _table(conn, "place")
    notes = _table(conn, "note")
    home_handle = None
    for k, v in conn.execute("SELECT setting, value FROM metadata"):
        if k == "default-person-handle":
            home_handle = _load(v)

    def evt(ref):
        e = events.get(ref[-2])  # EventRef: (..., ref_handle, role)
        return None if (e is None or e[12]) else e

    def person_event(p, idx):
        if idx is None or idx < 0 or idx >= len(p[7]):
            return None
        return evt(p[7][idx])

    # --- birth years, with estimates from relatives, to decide who is living
    birth_year, has_death = {}, {}
    for h, p in persons.items():
        b = person_event(p, p[6])
        birth_year[h] = fmt_date(b[3])[1] if b else None
        d = person_event(p, p[5])
        has_death[h] = bool(d) or any(
            (e := evt(r)) and e[2][0] in (EVT_DEATH, 5, 8) for r in p[7])  # death/burial/cremation

    est = dict(birth_year)
    for _ in range(8):  # propagate through the tree a few times
        changed = False
        for fh, f in families.items():
            parents = [x for x in (f[2], f[3]) if x in persons]
            kids = [c[3] for c in f[4] if c[3] in persons]
            for par in parents:
                if est.get(par) is None:
                    cands = [est[k] - GENERATION_GAP for k in kids if est.get(k)]
                    cands += [est[o] for o in parents if o != par and est.get(o)]
                    if cands:
                        est[par] = min(cands); changed = True
            for k in kids:
                if est.get(k) is None:
                    cands = [est[p] + GENERATION_GAP for p in parents if est.get(p)]
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

    pid = {h: p[1] for h, p in persons.items()}
    fid = {h: f[1] for h, f in families.items()}

    out_people = {}
    for h, p in persons.items():
        if p[19]:
            continue  # private in Gramps
        name = p[3]
        given = (name[4] or "").strip()
        surname = " ".join(s[0] for s in name[5] if s[0]).strip()
        call, nick = name[12], name[13]
        gender = {0: "f", 1: "m"}.get(p[2], "u")
        rec = {
            "id": p[1],
            "gender": gender,
            "surname": surname,
            "parents": [fid[f] for f in p[9] if f in fid],
            "families": [fid[f] for f in p[8] if f in fid],
        }
        if is_living(h):
            # living: name only - no dates, places, notes or links
            rec.update(living=True, given=given or "Unknown")
            if nick:
                rec["nick"] = nick
            out_people[p[1]] = rec
            continue

        rec.update(given=given or "Unknown", living=False)
        if nick:
            rec["nick"] = nick
        for key, ev in (("birth", person_event(p, p[6])), ("death", person_event(p, p[5]))):
            if ev:
                ds, _ = fmt_date(ev[3])
                pl = place_name(places, ev[5])
                if ds or pl:
                    rec[key] = {k: v for k, v in (("date", ds), ("place", pl)) if v}

        links, texts = [], []
        for nh in p[16]:
            lk, tx = note_content(notes, nh, "Person")
            links += lk
            texts += [tx] if tx else []
        for r in p[7]:
            e = evt(r)
            if not e:
                continue
            label = EVT_LABELS.get(e[2][0], e[2][1] or "Event")
            for nh in e[7] + (r[2] if isinstance(r[2], list) else []):
                lk, tx = note_content(notes, nh, f"{label} record")
                links += lk
                texts += [f"{label}: {tx}"] if tx else []
            if e[2][0] not in (EVT_BIRTH, EVT_DEATH):
                ds, _ = fmt_date(e[3])
                pl = place_name(places, e[5])
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
        out_people[p[1]] = rec

    out_fams = {}
    for h, f in families.items():
        if f[14]:
            continue
        father = pid.get(f[2]) if f[2] in persons else None
        mother = pid.get(f[3]) if f[3] in persons else None
        rec = {
            "id": f[1],
            "father": father if father in out_people else None,
            "mother": mother if mother in out_people else None,
            "children": [pid[c[3]] for c in f[4] if c[3] in pid and pid[c[3]] in out_people],
        }
        couple_living = any(out_people.get(x, {}).get("living") for x in (father, mother) if x)
        if not couple_living:
            links = []
            for nh in f[11]:
                lk, _ = note_content(notes, nh, "Marriage record")
                links += lk
            for r in f[6]:
                e = evt(r)
                if e and e[2][0] == EVT_MARRIAGE:
                    ds, _ = fmt_date(e[3]); pl = place_name(places, e[5])
                    if ds or pl:
                        rec["marriage"] = {k: v for k, v in (("date", ds), ("place", pl)) if v}
                    for nh in e[7]:
                        lk, _ = note_content(notes, nh, "Marriage record")
                        links += lk
            if links:
                rec["links"] = links
        out_fams[f[1]] = rec

    # default focus: Gramps home person, else first person
    home = pid.get(home_handle) if home_handle else None
    if home not in out_people:
        home = sorted(out_people)[0]

    data = {
        "title": "Family Tree",
        "home": home,
        "generated": date.today().isoformat(),
        "people": out_people,
        "families": out_fams,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    living = sum(1 for p in out_people.values() if p["living"])
    nlinks = sum(len(p.get("links", [])) for p in out_people.values())
    print(f"Exported {len(out_people)} people ({living} living, details hidden), "
          f"{len(out_fams)} families, {nlinks} person links -> {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    export(sys.argv[1], sys.argv[2])
