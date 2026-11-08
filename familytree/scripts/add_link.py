#!/usr/bin/env python3
"""
Add (or replace) links on people in a Gramps 6 tree, stored as person notes -
the same way it looks when you add a note in Gramps yourself.

Usage:
    python3 scripts/add_link.py I0005 "https://example.org/record" "birth record"
    python3 scripts/add_link.py I0068 "https://new.example/x" "photo" --replace "https://old.example/y"
    python3 scripts/add_link.py --batch links.tsv      # lines: ID <tab> URL <tab> label

The label is optional and is stored after the link in brackets; the website shows
it under the record (avoid brackets inside the label). Gramps must be closed: the
script refuses to write while the tree's lock file exists (use --ignore-lock only
for a leftover lock when you're sure Gramps is closed). A backup copy of the
database is saved before every run.
"""
import argparse
import json
import os
import random
import re
import sqlite3
import sys
import time

DEFAULT_TREE = os.path.expanduser("~/Documents/Gramps/624864cb")
NOTE_TYPE_PERSON = 4  # Gramps "Person Note"


def create_id():
    # same shape as Gramps' own handles
    return "%08x%08x" % (int(time.time() * 10000), random.getrandbits(32))


def person_name(p):
    n = p["primary_name"]
    return (n.get("first_name", "") + " " + " ".join(s["surname"] for s in n.get("surname_list", []))).strip()


def apply(conn, gid, url, label, replace=None):
    if not re.match(r"^https?://\S+$", url):
        raise ValueError(f"not a valid link: {url}")
    row = conn.execute("SELECT handle, json_data FROM person WHERE gramps_id = ?", (gid,)).fetchone()
    if not row:
        raise ValueError(f"no person with Gramps ID {gid}")
    handle, person = row[0], json.loads(row[1])
    name = person_name(person)
    text = url + (f" ({label})" if label else "")
    now = int(time.time())

    notes = []
    for nh in person.get("note_list", []):
        r = conn.execute("SELECT json_data FROM note WHERE handle = ?", (nh,)).fetchone()
        if r:
            notes.append(json.loads(r[0]))
    if any(url in n["text"]["string"] for n in notes):
        return f"{name} ({gid}) already has {url} - nothing changed"

    if replace:
        hit = next((n for n in notes if replace in n["text"]["string"]), None)
        if not hit:
            raise ValueError(f"{name} ({gid}) has no note containing {replace}")
        old = hit["text"]["string"]
        # replace the old link (and a label right after it, if any) with the new link + label
        hit["text"]["string"] = re.sub(re.escape(replace) + r"(\s*\([^)]*\))?", lambda m: text, old, count=1)
        hit["change"] = now
        conn.execute("UPDATE note SET json_data = ?, change = ? WHERE handle = ?",
                     (json.dumps(hit), now, hit["handle"]))
        return f"{name} ({gid}): note {hit['gramps_id']} now reads {hit['text']['string']!r}"

    ids = [r[0] for r in conn.execute("SELECT gramps_id FROM note")]
    nums = [int(m.group(1)) for i in ids if (m := re.match(r"N(\d+)$", i or ""))]
    nid = "N%04d" % ((max(nums) + 1) if nums else 0)
    nh = create_id()
    note = {
        "_class": "Note", "handle": nh, "gramps_id": nid,
        "text": {"_class": "StyledText", "string": text, "tags": []},
        "format": 0, "type": {"_class": "NoteType", "value": NOTE_TYPE_PERSON, "string": ""},
        "change": now, "tag_list": [], "private": False,
    }
    person.setdefault("note_list", []).append(nh)
    person["change"] = now
    conn.execute("INSERT INTO note (handle, gramps_id, format, change, private, json_data) VALUES (?,?,?,?,?,?)",
                 (nh, nid, 0, now, 0, json.dumps(note)))
    conn.execute("UPDATE person SET json_data = ?, change = ? WHERE handle = ?", (json.dumps(person), now, handle))
    conn.execute("INSERT INTO reference (obj_handle, obj_class, ref_handle, ref_class) VALUES (?,?,?,?)",
                 (handle, "Person", nh, "Note"))
    return f"{name} ({gid}): added note {nid}: {text}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tree", default=DEFAULT_TREE, help="Gramps tree folder (contains sqlite.db)")
    ap.add_argument("--batch", help="file with lines: ID <tab> URL <tab> label [<tab> old URL to replace]")
    ap.add_argument("--replace", help="replace this existing link instead of adding a new note")
    ap.add_argument("--ignore-lock", action="store_true", help="write even if a (leftover) lock file exists")
    ap.add_argument("--backup-dir", default=None, help="where to keep backups (default: <tree>/../backups)")
    ap.add_argument("person", nargs="?")
    ap.add_argument("url", nargs="?")
    ap.add_argument("label", nargs="?", default="")
    a = ap.parse_args()

    jobs = []
    if a.batch:
        for line in open(a.batch, encoding="utf-8"):
            if line.strip() and not line.startswith("#"):
                parts = line.rstrip("\n").split("\t") + ["", ""]
                jobs.append((parts[0].strip(), parts[1].strip(), parts[2].strip(), parts[3].strip() or None))
    elif a.person and a.url:
        jobs.append((a.person, a.url, a.label, a.replace))
    else:
        ap.error("give a person ID and URL, or --batch FILE")

    db = os.path.join(a.tree, "sqlite.db")
    if not os.path.exists(db):
        sys.exit(f"No Gramps database at {db}")
    if os.path.exists(os.path.join(a.tree, "lock")) and not a.ignore_lock:
        sys.exit("Gramps has this tree open (lock file present). Close Gramps and try again.")

    backup_dir = a.backup_dir or os.path.join(os.path.dirname(os.path.abspath(a.tree)), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, f"{os.path.basename(os.path.abspath(a.tree))}-{time.strftime('%Y%m%d-%H%M%S')}.db")
    src = sqlite3.connect(db); dst = sqlite3.connect(backup)
    src.backup(dst); dst.close(); src.close()

    conn = sqlite3.connect(db)
    try:
        with conn:  # one transaction for the whole run: all or nothing
            for job in jobs:
                print(apply(conn, *job))
    except ValueError as e:
        sys.exit(f"Nothing was changed: {e}")
    finally:
        conn.close()
    print(f"Backup of the database before these changes: {backup}")


if __name__ == "__main__":
    main()
