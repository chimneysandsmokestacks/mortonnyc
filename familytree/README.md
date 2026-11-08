# Family Tree

An interactive family tree built from a Gramps database. One person is shown in
focus, with parents and grandparents above, partners beside and children below.
Tap anyone to move them into focus. Their linked records (from Gramps notes)
are listed in the details panel; tapping one opens a record viewer that slides in
from the right, with a tab for each of the person's records.

- Blue = male, pink = female, grey = unknown gender. A dashed outline means living.
- Czech National Archives scans show right inside the viewer. FamilySearch, GenTeam,
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

Close Gramps, then run from this folder:

```
python3 scripts/export_gramps.py ~/Downloads/624864cb/sqlite.db data/tree.json
```

Commit and push the new `data/tree.json`. The script needs only Python 3, no extra packages.

To change the title shown in the top bar, edit `"title"` near the top of `data/tree.json`
(or the `"title"` line in the script so it survives re-exports). The starting person is
the Home Person set in Gramps.

## Preview locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. (Opening `index.html` directly from disk won't load the data.)
