#!/usr/bin/env python3
"""
Add a link to a person in a Gramps 6 tree, as a person note - the same way it
looks when you add a note in Gramps yourself.

Usage:
    python3 scripts/add_link.py I0005 "https://example.org/record" "birth record"
    python3 scripts/add_link.py --tree /path/to/tree I0005 URL [label]

The label is optional and is stored after the link in brackets, which the website
shows under the record. Gramps must be closed: the script refuses to write while
the tree is open, and saves a backup copy of the database before every change.
"""
import argparse
import json
import os
import random
import re
import shutil
import sqlite3
import sys
import time

DEFAULT_TREE = os.path.expanduser("~/Documents/Gramps/624864cb")
NOTE_TYPE_PERSON = 4  # Gramps "Person Note"


def create_id():
    # same shape as Gramps' own handles
    return "%08x%08x" % (int(time.time() * 10000), random.getrandbits(32))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tree", default=DEFAULT_TREE, help="Gramps tree folder (contains sqlite.db)")
    ap.add_argument("person", help="Gramps ID of the person, e.g. I0005")
    ap.add_argument("url")
    ap.add_argument("label", nargs="?", default="")
    ap.add_argument("--backup-dir", default=None, help="where to keep backups (default: next to the tree folder)")
    a = ap.parse_args()

    if not re.match(r"^https?://\S+$", a.url):
        sys.exit("The link must start with http:// or https:// and contain no spaces.")
    db = os.path.join(a.tree, "sqlite.db")
    if not os.path.exists(db):
        sys.exit(f"No Gramps database at {db}")
    if os.path.exists(os.path.join(a.tree, "lock")):
        sys.exit("Gramps has this tree open (lock file present). Close Gramps and try again.")

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT handle, json_data FROM person WHERE gramps_id = ?", (a.person,)).fetchone()
    if not row:
        sys.exit(f"No person with Gramps ID {a.person}")
    person = json.loads(row["json_data"])
    name = (person["primary_name"].get("first_name", "") + " " +
            " ".join(s["surname"] for s in person["primary_name"].get("surname_list", []))).strip()

    # already linked?
    for nh in person.get("note_list", []):
        n = conn.execute("SELECT json_data FROM note WHERE handle = ?", (nh,)).fetchone()
        if n and a.url in json.loads(n[0])["text"]["string"]:
            print(f"{name} ({a.person}) already has this link. Nothing changed.")
            return

    backup_dir = a.backup_dir or os.path.join(os.path.dirname(os.path.abspath(a.tree)), "backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, f"{os.path.basename(os.path.abspath(a.tree))}-{time.strftime('%Y%m%d-%H%M%S')}.db")
    src = sqlite3.connect(db); dst = sqlite3.connect(backup)
    src.backup(dst); dst.close(); src.close()

    ids = [r[0] for r in conn.execute("SELECT gramps_id FROM note")]
    nums = [int(m.group(1)) for i in ids if (m := re.match(r"N(\d+)$", i or ""))]
    gid = "N%04d" % ((max(nums) + 1) if nums else 0)
    handle = create_id()
    now = int(time.time())
    text = a.url + (f" ({a.label})" if a.label else "")
    note = {
        "_class": "Note", "handle": handle, "gramps_id": gid,
        "text": {"_class": "StyledText", "string": text, "tags": []},
        "format": 0, "type": {"_class": "NoteType", "value": NOTE_TYPE_PERSON, "string": ""},
        "change": now, "tag_list": [], "private": False,
    }
    person.setdefault("note_list", []).append(handle)
    person["change"] = now

    with conn:  # one transaction: all or nothing
        conn.execute("INSERT INTO note (handle, gramps_id, format, change, private, json_data) VALUES (?,?,?,?,?,?)",
                     (handle, gid, 0, now, 0, json.dumps(note)))
        conn.execute("UPDATE person SET json_data = ?, change = ? WHERE handle = ?",
                     (json.dumps(person), now, row["handle"]))
        conn.execute("INSERT INTO reference (obj_handle, obj_class, ref_handle, ref_class) VALUES (?,?,?,?)",
                     (row["handle"], "Person", handle, "Note"))
    conn.close()
    print(f"Added note {gid} to {name} ({a.person}): {text}\nBackup saved to {backup}")


if __name__ == "__main__":
    main()
