# Simple Inventory

A phone-first inventory tracker that works offline and installs to your home screen.

- **Projects** keep inventory separate per job.
- **Products** have a photo, model/part number, description and stock count.
- **One-tap +/−** on the list, with Undo and an optional note.
- **Add… / Remove…** for larger quantities, a note, and a back-dated time.
- **History** per product shows every change and the running balance.
  Tap an entry to edit its note or delete it (stock is reversed).
- **Correct stock count** (⋮ menu on a product) records the difference as a "count" entry.

All data is stored on the phone (IndexedDB). There is no server and no sync.

## Files
- `index.html`, `styles.css`, `app.js` — UI (no build step)
- `db.js` — storage layer and data model
- `sw.js` — offline cache. **Bump `VERSION` whenever any file changes** so installed phones update.

## Data model (for upcoming features)
Products already carry `barcode`, `location` and `lowStockAt` fields (unused for now) for
barcode scanning, bins and low-stock alerts. Movements record `delta`, `kind`, `note` and `at`,
which is what CSV export and backup/restore will read.
