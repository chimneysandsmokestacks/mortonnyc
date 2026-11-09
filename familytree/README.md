# Family Tree

An interactive family tree built from a Gramps database. One person is shown in
focus, with parents and grandparents above, partners beside and children below.
Tap anyone to move them into focus. Their linked records (from Gramps notes)
are listed in the details panel; tapping one opens a record viewer that slides in
from the right, with a tab for each of the person's records.

- Blue = male, pink = female, grey = unknown gender. A dashed outline means living.
- Czech National Archives scans and Google Drive files show right inside the viewer. FamilySearch, GenTeam,
  USC and most other sites don't allow being shown inside another site, so the viewer
  offers an "Open record" button for those instead. If you find another site that does
  allow it, add its domain to `EMBEDDABLE` near the top of `app.js`.
- Living relatives (no death record and born within the last 100 years, or with no
  dates at all) are shown by name only, with no dates, places, notes or links.
  This happens in the export script, so those details are never published.
- **Compare** (in the details panel) shows how two people are related: pick a second
  person by tapping them or searching, and the tree switches to just the path between
  them, with the relationship in words (e.g. "second cousin once removed", "wife's
  grandmother") and a step-by-step list. These views have their own links too, e.g.
  `.../#rel/I0003/I0068`.
- Two views, switched at the top:
  - **Person**: one person with their grandparents, parents, partner and children.
  - **Everyone**: the whole tree, with the selected person's line (all ancestors and
    descendants) or a comparison in purple. Links: `.../#all/I0013`. Old `#line/...`
    links open here.
  Drag to move, pinch / double-click / + and - to zoom.
- Each person has their own URL, e.g. `.../#I0005`, so you can share a direct link.

## Publish on GitHub Pages

1. Create a new repository on GitHub (e.g. `family-tree`).
2. Upload everything in this folder (`index.html`, `style.css`, `app.js`, `.nojekyll`,
   the `data` folder and the `scripts` folder) to the repository.
3. In the repository go to **Settings → Pages**, set **Source** to "Deploy from a branch",
   choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/family-tree/`.

GitHub Pages sites are public, even from a private repository on a free plan. The page
asks search engines not to index it, but anyone with the link can view it.

## Update the tree after editing in Gramps

The export reads your tree straight from `~/Documents/Gramps/624864cb` (Gramps 6).
Close Gramps, then from this folder run:

```
python3 scripts/export_gramps.py
```

Commit and push the new `data/tree.json`. The script needs only Python 3, no extra packages.
To use a different tree: `python3 scripts/export_gramps.py /path/to/tree-folder`.

## Add a link to someone without opening Gramps

```
python3 scripts/add_link.py I0005 "https://example.org/record" "birth record"
```

This adds the link as a note on that person, exactly as if you'd added it in Gramps.
Gramps must be closed; a backup of the database is saved to `~/Documents/Gramps/backups/`
before every change. Then run the export above.

To change the title shown in the top bar, edit `"title"` in the export script.
The starting person is the Home Person set in Gramps.

## Preview locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. (Opening `index.html` directly from disk won't load the data.)

### Adding children

`scripts/add_children.py --tree ~/Documents/Gramps/624864cb --parent I0069 "Gabriel|Engel|m" "Daniela|Engel|f"`
adds people as children of a parent (optionally `--other-parent ID`). It uses the family the
parent already has with that partner, or creates one. Close Gramps first; pass `--backup-dir`
to keep a copy of the database from before the change.

### Adding events (occupation, residence, census, ...)

`scripts/add_event.py --tree ~/Documents/Gramps/624864cb --person I0019 --type occupation --year 1931 --place "Wien" --desc "Fabrikant"`
adds a dated event to a person. Places are matched by exact name and created if missing.
The site shows these under the person's facts (type, description, date and place).
