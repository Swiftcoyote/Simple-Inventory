/* Release notes, newest first. This is the single source of the app's version and
 * build: the first entry is the version the app reports and the "What's New" popup
 * shows. For every upload, add a new entry at the TOP and bump VERSION in sw.js
 * to match (e.g. '1.1-build2'). Builds count up and never reset. */
window.CHANGELOG = [
  {
    version: '1.3', build: 4, date: '2026-11-22',
    title: 'Locations, owners and low-stock warnings',
    changes: [
      'Stock is now counted separately for each location (for example Bin A, Truck) and each owner. The product page shows the total, and under it how many are at each location and owner.',
      'The Add form asks for a location and an owner. Pick one from the list, or choose "+ New location…" or "+ New owner…" to type a new one. The owners list starts empty, so you enter your own names.',
      'The Remove form asks where the stock comes from (for example "Bin A · GC (10)") and won\'t let you take more than that spot holds.',
      'New ⇄ Move button on the product page moves stock from one location or owner to another in one step. The total stays the same, and History shows a single "Moved" entry.',
      'Each project has its own lists. To rename or remove a location or owner, open the project and tap ⋮ › Locations and owners. Renaming updates every entry in the project.',
      'History shows the location and owner of every entry. Edit an entry to change its location or owner as well as its date, quantity and note.',
      'Correct stock count now sets the count for one location and owner.',
      'New low-stock warning: when you add a product (or later with ⋮ › Edit product), enter the number to warn at. When the total is at or below it, the product gets a red "Low" tag and a red count.',
      'Each project on the Inventory screen shows how many products are low, and a "Low stock only" button above the product list shows just those.',
      'Your existing products and history are kept. Stock recorded before this update shows as location "Not set" and owner "Not set". Use ⇄ Move or Edit to sort it out whenever you like.',
    ],
  },
  {
    version: '1.2', build: 3, date: '2026-11-22',
    title: 'Logged Add and Remove, better History',
    changes: [
      'The + and − buttons are gone from the product list. Each product now shows its stock count, and tapping anywhere on it opens the product.',
      'To change stock, open a product and tap + Add or − Remove. Each one asks for the date (today is filled in), the quantity, and an optional note such as "10 for sections 15A".',
      'The Add and Remove forms show what the stock will be after the change, and Remove won\'t let you take out more than you have.',
      'Notes you used recently in the project appear under the note box. Tap one to reuse it instead of retyping it.',
      'Right after adding or removing, tap Undo at the bottom of the screen if it was a mistake.',
      'History now shows, for every entry, the date, whether it was added or removed, the quantity, the stock before → after, and the note.',
      'Tap a History entry to see its details. Edit lets you fix the date, quantity or note: the stock adjusts to match, and the entry is marked "edited" with a record of what it was before. Delete removes it and puts the stock back.',
      'Entries made for a past date show only the date, since the time of day was not recorded.',
      'Your existing products and history are kept exactly as they were.',
    ],
  },
  {
    version: '1.1', build: 2, date: '2026-11-21',
    title: "Settings, Help and What's New",
    changes: [
      "New \"What's New\" popup appears once after every update, listing exactly what changed and the new version and build. If you skip a few updates, it shows every release you missed.",
      'New Settings page: tap the gear at the top right of the Inventory screen.',
      "Settings › What's New shows this update and every earlier release.",
      'Settings › Help has short how-tos for projects, products, photos, adding and removing stock, and updates.',
      'Settings › About shows the version and build, with a button to see every change on GitHub.',
      'The version line at the bottom of the Inventory screen now opens What\'s New when tapped.',
      'Updates arrive more reliably: the app checks for a new version every time you open it or come back to it, then refreshes itself once.',
      'The app never refreshes for an update while you are in the middle of adding a product or adding/removing stock. It waits until you are done.',
    ],
  },
  {
    version: '1.0', build: 1, date: '2026-11-21',
    title: 'First release',
    changes: [
      'Projects keep inventory separate for each job.',
      'Products with a photo, model/part number, description and stock count.',
      'One-tap + and − on the product list, with Undo and an optional note.',
      'Add… and Remove… for larger quantities, a note, and a back-dated time.',
      'History for each product shows every change and the running balance.',
      'Correct stock count (⋮ menu on a product) records the difference.',
      'Works offline and installs to your home screen. All data stays on your phone.',
    ],
  },
];
