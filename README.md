# Simple Inventory

A phone-first inventory tracker that works offline and installs to your home screen.

**Open the app:** https://swiftcoyote.github.io/Simple-Inventory/
(on your phone, use the browser's *Add to Home Screen* to install it).

- **Tabs** (1.9): a bottom tab bar switches between Projects, Inventory, Lists (1.10), Reports and Settings.
  Swipe left/right on those four screens to change tab (not inside projects, not from the
  screen edges). Tab switches replace the history entry, and Projects reopens the last
  project/product.
- **Inventory tab** (1.9, `#/inventory`): every product from every project in one list. Products
  that share a part number (case-insensitive) are one item with a combined total. Search, filter
  by project / storage location / product owner, sort, Low stock only. `#/inventory/<key>` (1.11)
  shows the photos, the total, Remove · Move · Add (the form starts with a Project dropdown; adding to a
  project without the product creates it there, Undo removes it again), **Where it is** (a card per
  project with a Storage Location / Product Owner / Qty table; tap through to the project's product
  page) and **Recent activity** (last 5 entries, *See all in Reports* filters Reports to that part number).
- **Add inventory** (1.12): the button inside a project (was "Add product") and a new one on the Inventory
  tab (`#/inventory/new`, form starts with a Project dropdown). Quantity starts at 1 so team member,
  storage location and product owner show. Same part number already in that project blocks the save
  (offers *Open it*); in another project it offers *Use its description and photos*.
- **Product photos** (1.11): any number per product. `photo` is the main one (lists, thumbnails),
  `morePhotos` holds the rest (in backups). Edit product › tap a photo to make it main or remove it.
  Product pages show a swipeable strip; tap for full size.
- **Names on screen** (1.9): Location is shown as "Storage Location", Owner as "Product Owner",
  Who/People as "Team Member(s)". Stored field names (`location`, `owner`, `person`) are unchanged.
- **Scan** (1.15): a Scan button in the Model / part number box (Add inventory and Edit product)
  opens the in-app scanner. *Barcode* mode reads barcodes and QR codes on its own (the browser's
  `BarcodeDetector`, or bundled ZXing where that's missing). *Read text* mode takes a picture of the
  label, reads it with the bundled Tesseract OCR and lists the words it found, part-number-looking
  ones first; nothing fills in until the user taps one. The search boxes on the Inventory tab and
  inside a project have a scan button too (*Scan to find*): one match opens the product, no match
  offers Add inventory with the number filled in. All offline; see `vendor/README.md`.
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
  Add asks for both, Remove asks where from, **Move** shifts stock between them. Since 1.10 there is
  one app-wide list of each (Lists tab, `meta` 'locations' / 'owners'); each project keeps the names it
  uses (`project.locations` / `owners`), shown first under "This project". Pre-1.3 stock shows as "Not set".
- **Lists tab** (1.10): swipeable Storage Locations / Product Owners / Team Members. A location or owner
  opens a page with what's stored/owned there in every project, ⋮ Rename/Remove (renames every project
  and History). Locations have any number of named photos (`meta` 'locPhotos', in backups).
  New project can pick its product owners; a project with one owner preselects it on new stock.
- **Low-stock warning**: optional number per product; at or below it the product is flagged
  "Low", the project shows a low count, and "Low stock only" filters the list.

- **Backup and export** (Settings): *Back up now* makes one JSON file with everything
  (photos as data URLs) to share or save; *Restore from backup* replaces all data with a
  backup file, after keeping a safety copy (*Undo last restore*). *Export to spreadsheet*
  makes Stock and History CSV files for one project or all, with location and owner columns.
  A reminder shows on the home screen after 7 days without a backup (can be turned off).

- **Who (people)**: Add, Remove, Move and Correct count ask who is doing it, from one app-wide
  list (Lists › Team Members, or "+ New person…" on the form). Saved on each entry as `person`.
- **Reports** (Reports tab, or project ⋮ for that project): pick a project or all and a date range
  (quick picks or custom), optionally one location, owner, person or product. Shows totals,
  then start/added/used/end per product, location and owner, added/used per person and per note,
  and every entry. *Preview report* shows the print layout on screen (`html.previewing`, same rules as print);
  *Print / save PDF* uses the browser's print (print styles hide the controls);
  *Share spreadsheet* makes a summary CSV and an entries CSV. **Stock on hand** (1.11) lists stock at the
  end date per part number › project › storage location + product owner (also in the summary CSV). With
  All projects, the Product filter is a part number across projects (`invKey`).

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
- `vendor/` — barcode and text-reading libraries (1.15), loaded only when first used; kept in a separate service-worker cache. See `vendor/README.md`.
- `sw.js` — offline cache. **Bump `VERSION` whenever any file changes** (it matches the build, e.g. `1.1-build2`) so installed phones update.

## Data model
See the comment at the top of `db.js`. Movements record `delta`, `kind` (`in`/`out`/`count`/`move`),
`location`, `owner` (and `toLocation`/`toOwner` for moves), `person` (1.6), `note`, `at` (plus `dateOnly`, `editedAt`
and `edits` when used). Stock per place is the sum of entries there; `product.stock` is the total.
This is what reports, CSV export and backup/restore read.

**Backup file** (`inventory-backup-YYYY-MM-DD.json`): `{ app: "simple-inventory", format: 1, version,
build, createdAt, counts, data: { projects, products, movements } }`, the stores as-is with each
`photo` as a data URL. Restore rejects other files, files from a newer build, and damaged files,
and recomputes each `product.stock` from its entries. The `meta` store (DB version 3) keeps
`beforeRestore`, the data as it was before the last restore. Products keep an unused `barcode`
field for barcode scanning.
