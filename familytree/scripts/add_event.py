#!/usr/bin/env python3
"""Add a dated event (occupation, residence, census, ...) to a person in a Gramps 6
(SQLite) family tree.

Usage:
  add_event.py --tree TREE_DIR --person I0019 --type occupation --year 1931 \
      --place "Wien" --desc "Fabrikant" [--backup-dir DIR] [--ignore-lock]

--type is one of the names in TYPES below. --place is matched against existing
place names (exact match) and created if missing. Close Gramps before running.
"""
import argparse, json, os, random, shutil, sqlite3, sys, time

# Gramps EventType values
TYPES = {"occupation": 37, "residence": 42, "census": 21, "emigration": 28, "immigration": 30,
         "education": 26, "military": 33, "religion": 41, "property": 40}


def new_handle():
    return "%08x%08x" % (int(time.time() * 10000), random.getrandbits(32))


def next_id(c, table, prefix):
    nums = [int(r[0][1:]) for r in c.execute(f"select gramps_id from {table}") if r[0] and r[0][1:].isdigit()]
    return f"{prefix}{(max(nums) + 1 if nums else 0):04d}"


def sdn(y, m, d):
    """Gregorian date -> serial day number (what Gramps stores as sortval)."""
    a = (14 - m) // 12
    yy, mm = y + 4800 - a, m + 12 * a - 3
    return d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045


def date_json(year, month=0, day=0):
    if not year:
        return {"_class": "Date", "calendar": 0, "modifier": 0, "quality": 0, "dateval": [0, 0, 0, False],
                "text": "", "sortval": 0, "newyear": 0, "format": None}
    return {"_class": "Date", "calendar": 0, "modifier": 0, "quality": 0, "dateval": [day, month, year, False],
            "text": "", "sortval": sdn(year, month or 1, day or 1), "newyear": 0, "format": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tree", required=True)
    ap.add_argument("--person", required=True)
    ap.add_argument("--type", required=True, choices=sorted(TYPES))
    ap.add_argument("--year", type=int)
    ap.add_argument("--month", type=int, default=0)
    ap.add_argument("--day", type=int, default=0)
    ap.add_argument("--place")
    ap.add_argument("--desc", default="")
    ap.add_argument("--backup-dir")
    ap.add_argument("--ignore-lock", action="store_true")
    a = ap.parse_args()

    db = os.path.join(a.tree, "sqlite.db")
    if os.path.exists(os.path.join(a.tree, "lock")) and not a.ignore_lock:
        sys.exit("Gramps seems to be open (lock file present). Close it first, or pass --ignore-lock.")
    if a.backup_dir:
        os.makedirs(a.backup_dir, exist_ok=True)
        shutil.copy2(db, os.path.join(a.backup_dir, time.strftime("tree-%Y%m%d-%H%M%S.db")))

    c = sqlite3.connect(db)
    c.execute("begin")
    now = int(time.time())
    r = c.execute("select json_data from person where gramps_id=?", (a.person,)).fetchone()
    if not r:
        sys.exit(f"{a.person} not found")
    p = json.loads(r[0])

    place_handle = ""
    if a.place:
        for h, js in c.execute("select handle, json_data from place"):
            if json.loads(js)["name"]["value"] == a.place:
                place_handle = h
                break
        if not place_handle:
            place_handle, pid = new_handle(), next_id(c, "place", "P")
            pl = {"_class": "Place", "handle": place_handle, "gramps_id": pid, "title": "", "long": "", "lat": "",
                  "placeref_list": [], "name": {"_class": "PlaceName", "value": a.place, "date": date_json(0), "lang": ""},
                  "alt_names": [], "place_type": {"_class": "PlaceType", "value": -1, "string": ""}, "code": "",
                  "alt_loc": [], "urls": [], "media_list": [], "citation_list": [], "note_list": [], "change": now,
                  "tag_list": [], "private": False}
            c.execute("insert into place (handle, enclosed_by, gramps_id, title, long, lat, code, change, private, json_data) values (?,?,?,?,?,?,?,?,?,?)",
                      (place_handle, None, pid, "", "", "", "", now, 0, json.dumps(pl)))
            print(f"new place {pid}: {a.place}")

    eh, eid = new_handle(), next_id(c, "event", "E")
    ev = {"_class": "Event", "handle": eh, "gramps_id": eid,
          "type": {"_class": "EventType", "value": TYPES[a.type], "string": ""},
          "date": date_json(a.year, a.month, a.day), "description": a.desc, "place": place_handle,
          "citation_list": [], "note_list": [], "media_list": [], "attribute_list": [], "change": now,
          "tag_list": [], "private": False}
    c.execute("insert into event (handle, gramps_id, description, place, change, private, json_data) values (?,?,?,?,?,?,?)",
              (eh, eid, a.desc, place_handle, now, 0, json.dumps(ev)))
    if place_handle:
        c.execute("insert into reference values (?,?,?,?)", (eh, "Event", place_handle, "Place"))

    p["event_ref_list"].append({"_class": "EventRef", "private": False, "citation_list": [], "note_list": [],
                                "attribute_list": [], "ref": eh,
                                "role": {"_class": "EventRoleType", "value": 1, "string": ""}})   # 1 = primary
    p["change"] = now
    c.execute("update person set json_data=?, change=? where handle=?", (json.dumps(p), now, p["handle"]))
    c.execute("insert into reference values (?,?,?,?)", (p["handle"], "Person", eh, "Event"))
    c.commit()
    print(f"added {eid} {a.type} to {a.person}: {a.desc or ''} {a.year or ''} {a.place or ''}".strip())


if __name__ == "__main__":
    main()
