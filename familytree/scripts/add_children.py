#!/usr/bin/env python3
"""Add children to a person in a Gramps 6 (SQLite) family tree.

Usage:
  add_children.py --tree TREE_DIR --parent I0069 [--other-parent I0123] \
      [--backup-dir DIR] [--ignore-lock] "Gabriel|Engel|m" "Daniela|Engel|f"

Each child is "Given|Surname|m/f/u". The children go into the family the parent
already has with --other-parent (or their only family with no partner); if there
is none, a new family is created. Close Gramps before running.
"""
import argparse, json, os, random, shutil, sqlite3, sys, time

GENDER = {"f": 0, "m": 1, "u": 2}          # Gramps: 0 female, 1 male, 2 unknown


def new_handle():
    return "%08x%08x" % (int(time.time() * 10000), random.getrandbits(32))


def next_id(c, table, prefix):
    nums = [int(r[0][1:]) for r in c.execute(f"select gramps_id from {table}") if r[0][1:].isdigit()]
    return f"{prefix}{(max(nums) + 1 if nums else 0):04d}"


def empty_date():
    return {"_class": "Date", "calendar": 0, "modifier": 0, "quality": 0, "dateval": [0, 0, 0, False],
            "text": "", "sortval": 0, "newyear": 0, "format": None}


def person_json(handle, gid, given, surname, gender, now):
    return {
        "_class": "Person", "handle": handle, "gramps_id": gid, "gender": gender,
        "primary_name": {
            "_class": "Name", "private": False, "citation_list": [], "note_list": [], "date": empty_date(),
            "first_name": given,
            "surname_list": [{"_class": "Surname", "surname": surname, "prefix": "", "primary": True,
                              "origintype": {"_class": "NameOriginType", "value": 1, "string": ""}, "connector": ""}],
            "suffix": "", "title": "", "type": {"_class": "NameType", "value": 2, "string": ""},
            "group_as": "", "sort_as": 0, "display_as": 0, "call": "", "nick": "", "famnick": ""},
        "alternate_names": [], "death_ref_index": -1, "birth_ref_index": -1, "event_ref_list": [],
        "family_list": [], "parent_family_list": [], "media_list": [], "address_list": [], "attribute_list": [],
        "urls": [], "lds_ord_list": [], "citation_list": [], "note_list": [], "change": now, "tag_list": [],
        "private": False, "person_ref_list": []}


def child_ref(handle):
    rel = {"_class": "ChildRefType", "value": 1, "string": ""}   # 1 = birth
    return {"_class": "ChildRef", "private": False, "citation_list": [], "note_list": [], "ref": handle,
            "frel": dict(rel), "mrel": dict(rel)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tree", required=True)
    ap.add_argument("--parent", required=True)
    ap.add_argument("--other-parent")
    ap.add_argument("--backup-dir")
    ap.add_argument("--ignore-lock", action="store_true")
    ap.add_argument("children", nargs="+")
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

    def load(table, gid):
        r = c.execute(f"select json_data from {table} where gramps_id=?", (gid,)).fetchone()
        if not r:
            sys.exit(f"{gid} not found")
        return json.loads(r[0])

    def save_person(p):
        c.execute("update person set json_data=?, change=? where handle=?", (json.dumps(p), p["change"], p["handle"]))

    par = load("person", a.parent)
    other = load("person", a.other_parent) if a.other_parent else None

    # find the family to add to
    fam = None
    for fh in par["family_list"]:
        f = json.loads(c.execute("select json_data from family where handle=?", (fh,)).fetchone()[0])
        partner = f["mother_handle"] if f["father_handle"] == par["handle"] else f["father_handle"]
        if (other and partner == other["handle"]) or (not other and partner is None):
            fam = f
            break
    if fam is None:
        fam = {"_class": "Family", "handle": new_handle(), "gramps_id": next_id(c, "family", "F"),
               "father_handle": None, "mother_handle": None, "child_ref_list": [],
               "type": {"_class": "FamilyRelType", "value": 3, "string": ""}, "event_ref_list": [],
               "media_list": [], "attribute_list": [], "lds_ord_list": [], "citation_list": [], "note_list": [],
               "change": now, "tag_list": [], "private": False, "complete": 0}
        for p in [par] + ([other] if other else []):
            fam["father_handle" if p["gender"] == 1 and not fam["father_handle"] else "mother_handle"] = p["handle"]
            p["family_list"].append(fam["handle"]); p["change"] = now
            save_person(p)
            c.execute("insert into reference values (?,?,?,?)", (p["handle"], "Person", fam["handle"], "Family"))
            c.execute("insert into reference values (?,?,?,?)", (fam["handle"], "Family", p["handle"], "Person"))
        c.execute("insert into family (handle, gramps_id, father_handle, mother_handle, change, private, json_data) values (?,?,?,?,?,?,?)",
                  (fam["handle"], fam["gramps_id"], fam["father_handle"], fam["mother_handle"], now, 0, json.dumps(fam)))
        print(f"new family {fam['gramps_id']}")

    for spec in a.children:
        given, surname, g = (spec.split("|") + ["u"])[:3]
        gender = GENDER[g.strip().lower()[:1]]
        h, gid = new_handle(), next_id(c, "person", "I")
        p = person_json(h, gid, given.strip(), surname.strip(), gender, now)
        p["parent_family_list"].append(fam["handle"])
        c.execute("insert into person (handle, given_name, surname, gramps_id, gender, death_ref_index, birth_ref_index, change, private, json_data) values (?,?,?,?,?,?,?,?,?,?)",
                  (h, given.strip(), surname.strip(), gid, gender, -1, -1, now, 0, json.dumps(p)))
        c.execute("insert into reference values (?,?,?,?)", (h, "Person", fam["handle"], "Family"))
        c.execute("insert into reference values (?,?,?,?)", (fam["handle"], "Family", h, "Person"))
        fam["child_ref_list"].append(child_ref(h))
        # first-name gender statistics (same column layout as existing rows)
        col = {1: "female", 0: "male", 2: "unknown"}[gender]
        if c.execute("select 1 from gender_stats where given_name=?", (given.strip(),)).fetchone():
            c.execute(f"update gender_stats set {col}={col}+1 where given_name=?", (given.strip(),))
        else:
            vals = {"female": 0, "male": 0, "unknown": 0}; vals[col] = 1
            c.execute("insert into gender_stats (given_name, female, male, unknown) values (?,?,?,?)",
                      (given.strip(), vals["female"], vals["male"], vals["unknown"]))
        print(f"added {gid} {given.strip()} {surname.strip()} ({'female male unknown'.split()[gender]})")

    fam["change"] = now
    c.execute("update family set json_data=?, change=? where handle=?", (json.dumps(fam), now, fam["handle"]))
    c.commit()
    print(f"children now in family {fam['gramps_id']}: {len(fam['child_ref_list'])}")


if __name__ == "__main__":
    main()
