/* Release notes, newest first. This is the single source of the app's version and
 * build: the first entry is the version the app reports and the "What's New" popup
 * shows. For every upload, add a new entry at the TOP and bump VERSION in sw.js
 * to match (e.g. '1.1-build2'). Builds count up and never reset. */
window.CHANGELOG = [
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
