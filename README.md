# Simple Inventory

A phone-first inventory tracker that works offline and installs to your home screen.

**Open the app:** https://swiftcoyote.github.io/Simple-Inventory/
(on your phone, use the browser's *Add to Home Screen* to install it).

- **Projects** keep inventory separate per job.
- **Products** have a photo, model/part number, description and stock count.
- **One-tap +/−** on the list, with Undo and an optional note.
- **Add… / Remove…** for larger quantities, a note, and a back-dated time.
- **History** per product shows every change and the running balance.
  Tap an entry to edit its note or delete it (stock is reversed).
- **Correct stock count** (⋮ menu on a product) records the difference as a "count" entry.

All data is stored on the phone (IndexedDB). There is no server and no sync.

## Versions
Releases are numbered **Version X.Y · Build N**. The version counts up from 1.0 for
each release; the build counts up from 1 with every upload and never resets.
The current number is shown at the bottom of the home (Projects) screen and each
upload is tagged in git as `vX.Y-buildN` (first release: `v1.0-build1`).

When releasing, update all three together:
`APP_VERSION` / `APP_BUILD` at the top of `app.js`, and `VERSION` in `sw.js`.

## Files
- `index.html`, `styles.css`, `app.js` — UI (no build step)
- `db.js` — storage layer and data model
- `sw.js` — offline cache. **Bump `VERSION` whenever any file changes** (it matches the build, e.g. `1.0-build1`) so installed phones update.

## Data model (for upcoming features)
Products already carry `barcode`, `location` and `lowStockAt` fields (unused for now) for
barcode scanning, bins and low-stock alerts. Movements record `delta`, `kind`, `note` and `at`,
which is what CSV export and backup/restore will read.
