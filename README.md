# Simple Inventory

A phone-first inventory tracker that works offline and installs to your home screen.

**Open the app:** https://swiftcoyote.github.io/Simple-Inventory/
(on your phone, use the browser's *Add to Home Screen* to install it).

- **Projects** keep inventory separate per job.
- **Products** have a photo, model/part number, description and stock count.
- **Add / Remove** on the product page logs each change with a date (defaults to today),
  a quantity and an optional note. Recent notes are offered as one-tap suggestions,
  and Undo appears right after saving.
- **History** per product shows each entry's date, added/removed, quantity,
  stock before → after and note. Tap an entry to edit its date, quantity or note
  (stock adjusts; the old values are kept in the entry's `edits`) or to delete it (stock is reversed).
- **Correct stock count** (⋮ menu on a product) sets the count at one location + owner and records the difference as a "count" entry.
- **Locations and owners**: stock is counted per location + owner, with a product total.
  Add asks for both, Remove asks where from, **Move** shifts stock between them. Each project
  keeps its own lists (⋮ › Locations and owners to rename/remove). Pre-1.3 stock shows as "Not set".
- **Low-stock warning**: optional number per product; at or below it the product is flagged
  "Low", the project shows a low count, and "Low stock only" filters the list.

All data is stored on the phone (IndexedDB). There is no server and no sync.

## Versions
Releases are numbered **Version X.Y · Build N**. The version goes up for new features
(1.0, 1.1, ...); the build counts up from 1 with every upload and never resets. No git tags.

**`changelog.js` is the single source of the version.** Its first entry is what the app
shows on the home screen, in Settings, and in the What's New popup.

When releasing:
1. Add a new entry at the **top** of `changelog.js` (version, build, date, title, list of changes in plain words).
2. Set `VERSION` in `sw.js` to match (e.g. `1.1-build2`) so installed phones download the update.

## Updates and What's New
- On open, and every time the app comes back to the foreground, it checks for a new `sw.js`.
- A new service worker downloads fresh copies of every file and takes over immediately; the page
  then reloads itself once, unless a sheet is open or the add/edit product form is showing, in
  which case it waits until that closes or the app goes to the background.
- After the reload, the app compares the build with the last build seen on this phone
  (`localStorage.seenBuild`) and shows every newer release in the What's New popup.
  A brand-new install with no projects starts quietly.

## Files
- `index.html`, `styles.css`, `app.js` — UI (no build step), including Settings, Help and What's New
- `changelog.js` — release notes and the current version/build
- `db.js` — storage layer and data model
- `sw.js` — offline cache. **Bump `VERSION` whenever any file changes** (it matches the build, e.g. `1.1-build2`) so installed phones update.

## Data model
See the comment at the top of `db.js`. Movements record `delta`, `kind` (`in`/`out`/`count`/`move`),
`location`, `owner` (and `toLocation`/`toOwner` for moves), `note`, `at` (plus `dateOnly`, `editedAt`
and `edits` when used). Stock per place is the sum of entries there; `product.stock` is the total.
This is what reports, CSV export and backup/restore will read. Products keep an unused `barcode`
field for barcode scanning.
