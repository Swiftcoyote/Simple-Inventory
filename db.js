/* Local storage layer (IndexedDB). No server, no sync.
 *
 * Stores
 *   projects  { id, name, locations: [names], owners: [names], createdAt, updatedAt }
 *               locations/owners are the names this project uses (added in 1.3; missing =
 *               empty). Since 1.10 they are shown first ("This project") in the pickers;
 *               the full lists are app-wide (meta 'locations' / 'owners').
 *   products  { id, projectId, partNumber, description, photo (Blob|null), stock,
 *               morePhotos (1.11: [Blob], the extra photos; `photo` is the main one, shown
 *               in lists; missing = none),
 *               lowStockAt (number|null: flag when stock <= this), barcode (1.16: the
 *               scanned UPC/EAN linked to this product, or null), location (unused, kept
 *               null), createdAt, updatedAt }
 *   movements { id, productId, projectId, delta (+in / -out), kind ('in'|'out'|'count'|'move'),
 *               location, owner (names; '' or missing = "Not set", e.g. entries before 1.3),
 *               note, at (ISO time of the event), dateOnly (true when the user picked a
 *               past date, so only the date is meaningful), createdAt,
 *               editedAt + edits[] (earlier versions, oldest first; only once edited) }
 *               kind 'move': delta 0, qty moved from (location, owner) to (toLocation, toOwner).
 *               person (1.6): who made the change, a name from the People list
 *               ('' or missing = "Not set", e.g. entries before 1.6).
 *   meta      out-of-line keys. 'beforeRestore' = { savedAt, reason, data: { projects,
 *               products, movements } }: the safety copy, everything as it was just before
 *               the last restore (1.4) or delete (1.5). reason: 'restore' (or missing, from
 *               1.4), 'delete' (some projects) or 'deleteAll'. Only one copy is kept.
 *               'people' (1.6) = [names]: the app-wide People list (Settings › People),
 *               offered on Add, Remove, Move and Correct count. Backed up with the data.
 *               'locations', 'owners' (1.10) = [names]: the app-wide Storage Location and
 *               Product Owner lists (Lists tab), shared by every project.
 *               'locPhotos' (1.10) = { [location name]: [{ id, label, photo (Blob), at }] }:
 *               any number of named photos per storage location.
 *
 * Stock is counted per place (location + owner): the sum of entries at that place.
 * Invariants: product.stock === sum(movement.delta) for that product, and no place
 * goes below 0. Every stock change goes through change() so they always hold.
 */
const DB = (() => {
  const NAME = 'simple-inventory';
  const VERSION = 4;
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' });
          const p = db.createObjectStore('products', { keyPath: 'id' });
          p.createIndex('projectId', 'projectId');
          p.createIndex('barcode', 'barcode');
          const m = db.createObjectStore('movements', { keyPath: 'id' });
          m.createIndex('productId', 'productId');
          m.createIndex('projectId', 'projectId');
          m.createIndex('at', 'at');
        }
        if (e.oldVersion > 0 && e.oldVersion < 2) reconcile(req.transaction);
        // Version 3 (app 1.4): 'meta' holds the safety copy saved before a restore.
        if (e.oldVersion < 3) db.createObjectStore('meta');
        // Version 4 (app 1.10): one app-wide list of storage locations and product owners,
        // seeded from every project's own lists.
        if (e.oldVersion > 0 && e.oldVersion < 4) seedShared(req.transaction);
        // Future versions: add `if (e.oldVersion < 5) { ... }` blocks here.
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  /** Version 2 (app 1.3) counts stock per place from the entries, so every product's
   *  entries must add up to its stock. Older builds could let the two drift apart
   *  (deleting an entry whose stock was already used). Where they differ, add one
   *  'count' entry for the difference, at "Not set". Nothing is changed or deleted. */
  function reconcile(tx) {
    const sums = {};
    tx.objectStore('movements').openCursor().onsuccess = (ev) => {
      const c = ev.target.result;
      if (c) { sums[c.value.productId] = (sums[c.value.productId] || 0) + c.value.delta; c.continue(); return; }
      tx.objectStore('products').openCursor().onsuccess = (ev2) => {
        const c2 = ev2.target.result;
        if (!c2) return;
        const p = c2.value;
        const diff = p.stock - (sums[p.id] || 0);
        if (diff) {
          const t = new Date().toISOString();
          tx.objectStore('movements').put({
            id: uid(), productId: p.id, projectId: p.projectId, delta: diff, kind: 'count',
            note: 'Automatic count correction (update 1.3)', at: t, createdAt: t, location: '', owner: '',
          });
        }
        c2.continue();
      };
    };
  }

  /** Version 4: the app-wide lists start as every name any project already had. */
  function seedShared(tx) {
    tx.objectStore('projects').getAll().onsuccess = (ev) => {
      const lists = sharedFrom(ev.target.result);
      tx.objectStore('meta').put(lists.locations, 'locations');
      tx.objectStore('meta').put(lists.owners, 'owners');
    };
  }
  function sharedFrom(projects) {
    const L = new Set(), O = new Set();
    for (const p of projects || []) {
      (p.locations || []).forEach(n => { n = tidy(n); if (n) L.add(n); });
      (p.owners || []).forEach(n => { n = tidy(n); if (n) O.add(n); });
    }
    return { locations: [...L].sort(nameSort), owners: [...O].sort(nameSort) };
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2));
  const now = () => new Date().toISOString();

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function getAll(store, index, key) {
    const db = await open();
    const s = db.transaction(store).objectStore(store);
    return reqP(index ? s.index(index).getAll(key) : s.getAll());
  }
  async function get(store, id) {
    const db = await open();
    return reqP(db.transaction(store).objectStore(store).get(id));
  }

  // ---------- projects ----------
  async function listProjects() {
    const [projects, products] = await Promise.all([getAll('projects'), getAll('products')]);
    const stats = {};
    for (const p of products) {
      const s = stats[p.projectId] || (stats[p.projectId] = { items: 0, units: 0, low: 0 });
      s.items++; s.units += p.stock;
      if (isLow(p)) s.low++;
    }
    return projects
      .map(p => ({ ...p, items: stats[p.id]?.items || 0, units: stats[p.id]?.units || 0, low: stats[p.id]?.low || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  const getProject = (id) => get('projects', id);

  /** Creates or renames a project. owners (1.10, optional): the project's product owners,
   *  picked on the New project form; new names also go on the app-wide list. */
  async function saveProject({ id, name, owners }) {
    const db = await open();
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    const s = tx.objectStore('projects');
    let rec;
    if (id) {
      rec = await reqP(s.get(id));
      rec.name = name; rec.updatedAt = now();
    } else {
      rec = { id: uid(), name, locations: [], owners: [], createdAt: now(), updatedAt: now() };
    }
    if (owners) {
      rec.owners = uniq(owners.map(tidy).filter(Boolean));
      await pushShared(tx.objectStore('meta'), 'owners', rec.owners);
    }
    s.put(rec);
    await done(tx);
    return rec;
  }

  /** Deletes whole projects (with all their products, photos and entries) and/or single
   *  products (with their entries; the project stays), in one transaction. Everything as
   *  it was before is kept as the safety copy (meta 'beforeRestore', reason 'delete'),
   *  so Settings can undo it. */
  async function deleteData({ projectIds = [], productIds = [] }) {
    const dropProj = new Set(projectIds), dropProd = new Set(productIds);
    const db = await open();
    const tx = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
    const [projects, products, movements] = await Promise.all(DATA_STORES.map(n => reqP(tx.objectStore(n).getAll())));
    const extra = await metaLists(tx.objectStore('meta'));
    tx.objectStore('meta').put({ savedAt: now(), reason: 'delete', data: { projects, products, movements, ...extra } }, 'beforeRestore');
    for (const p of projects) if (dropProj.has(p.id)) tx.objectStore('projects').delete(p.id);
    for (const p of products) if (dropProj.has(p.projectId) || dropProd.has(p.id)) tx.objectStore('products').delete(p.id);
    for (const m of movements) if (dropProj.has(m.projectId) || dropProd.has(m.productId)) tx.objectStore('movements').delete(m.id);
    await done(tx);
  }
  const deleteProjects = (ids) => deleteData({ projectIds: ids });
  const deleteProducts = (ids) => deleteData({ productIds: ids });
  const deleteProject = (id) => deleteProjects([id]);

  // ---------- locations & owners ----------
  // Since 1.10 there is one app-wide list of each (meta 'locations' / 'owners', the Lists
  // tab). Each project still keeps the names it uses (project.locations / owners), shown
  // first in its pickers. A name is added to both the first time it is used on an entry.
  // Old entries have no location/owner ('' = "Not set"). Stock is counted per
  // location + owner pair ("place").
  const KINDS = ['locations', 'owners'];
  const uniq = (list) => list.filter((n, i) => list.indexOf(n) === i);
  /** Adds names to an app-wide list (inside a transaction on 'meta'). */
  async function pushShared(meta, kind, names) {
    names = names.map(tidy).filter(Boolean);
    if (!names.length) return;
    const list = (await reqP(meta.get(kind))) || [];
    let changed = false;
    for (const n of names) if (!list.includes(n)) { list.push(n); changed = true; }
    if (changed) meta.put(list.sort(nameSort), kind);
  }
  /** The app-wide lists kept in 'meta', for backups and safety copies. */
  async function metaLists(meta) {
    const [people, locations, owners, locPhotos] = await Promise.all(['people', 'locations', 'owners', 'locPhotos'].map(k => reqP(meta.get(k))));
    return { people: people || [], locations: locations || [], owners: owners || [], locPhotos: locPhotos || {} };
  }
  async function listNames() {
    const db = await open();
    const s = db.transaction('meta').objectStore('meta');
    const [locations, owners] = await Promise.all(KINDS.map(k => reqP(s.get(k))));
    return { locations: (locations || []).slice(), owners: (owners || []).slice() };
  }

  /** Stock per place, from a product's entries. Returns [{ location, owner, qty }],
   *  including places that have dropped to 0. A 'move' entry takes qty from
   *  (location, owner) and puts it at (toLocation, toOwner); its delta is 0. */
  function bucketsOf(moves) {
    const map = new Map();
    const add = (l, o, n) => {
      l = l || ''; o = o || '';
      const k = `${l}\u0001${o}`;
      const b = map.get(k) || { location: l, owner: o, qty: 0 };
      b.qty += n; map.set(k, b);
    };
    for (const m of moves) {
      if (m.kind === 'move') { add(m.location, m.owner, -m.qty); add(m.toLocation, m.toOwner, m.qty); }
      else add(m.location, m.owner, m.delta);
    }
    const cmp = (a, b) => (a === '') - (b === '') || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...map.values()].sort((a, b) => cmp(a.location, b.location) || cmp(a.owner, b.owner));
  }

  function addNames(project, moves) {
    if (!project) return false;
    let changed = false;
    const lists = { locations: project.locations || [], owners: project.owners || [] };
    const push = (list, n) => { n = (n || '').trim(); if (n && !list.includes(n)) { list.push(n); changed = true; } };
    for (const m of moves) {
      push(lists.locations, m.location); push(lists.owners, m.owner);
      if (m.kind === 'move') { push(lists.locations, m.toLocation); push(lists.owners, m.toOwner); }
    }
    project.locations = lists.locations; project.owners = lists.owners;
    return changed;
  }

  const placeName = (l, o) => `${l || 'Not set'} · ${o || 'Not set'}`;
  function negativeError(b) {
    const e = new Error(`${placeName(b.location, b.owner)} would go below 0 (${b.qty})`);
    e.code = 'NEGATIVE'; return e;
  }

  /** Every stock change runs through here, in one transaction:
   *  fn({ p, moves, m0 }) returns { put: [entries], del: [ids], value }.
   *  The new entries are checked so no place goes below 0, then product.stock is set to
   *  the sum of all entries and new names are added to the project's lists. */
  async function change({ productId, movementId }, fn) {
    const db = await open();
    const tx = db.transaction(['projects', 'products', 'movements', 'meta'], 'readwrite');
    const ms = tx.objectStore('movements'), ps = tx.objectStore('products'), prs = tx.objectStore('projects');
    let m0 = null;
    if (movementId) {
      m0 = await reqP(ms.get(movementId));
      if (!m0) { tx.abort(); throw new Error('Entry not found'); }
      productId = m0.productId;
    }
    const p = await reqP(ps.get(productId));
    if (!p) { tx.abort(); throw new Error('Product not found'); }
    const moves = await reqP(ms.index('productId').getAll(productId));
    let r;
    try { r = fn({ p, moves, m0 }) || {}; } catch (e) { tx.abort(); throw e; }
    const put = r.put || [], del = new Set(r.del || []);
    if (r.abort) { tx.abort(); return r.value; }
    const putIds = new Set(put.map(m => m.id));
    const next = moves.filter(m => !del.has(m.id) && !putIds.has(m.id)).concat(put);
    const neg = bucketsOf(next).find(b => b.qty < 0);
    if (neg) { tx.abort(); throw negativeError(neg); }
    p.stock = next.reduce((a, m) => a + m.delta, 0);
    p.updatedAt = now();
    ps.put(p);
    for (const m of put) ms.put(m);
    for (const id of del) ms.delete(id);
    const project = await reqP(prs.get(p.projectId));
    if (addNames(project, put)) prs.put(project);
    const meta = tx.objectStore('meta');
    await pushShared(meta, 'locations', put.flatMap(m => [m.location, m.kind === 'move' ? m.toLocation : '']));
    await pushShared(meta, 'owners', put.flatMap(m => [m.owner, m.kind === 'move' ? m.toOwner : '']));
    await done(tx);
    await addPeople(put.map(m => m.person));
    return typeof r.value === 'function' ? r.value(p) : r.value;
  }

  /** Renames a storage location or product owner (kind 'locations' | 'owners') on the
   *  app-wide list, in every project and on every entry (and its earlier versions).
   *  A location's photos go with it. Renaming onto an existing name merges the two. */
  async function renameName(kind, from, to) {
    to = tidy(to);
    if (!to || to === from) return;
    const db = await open();
    const tx = db.transaction(['projects', 'movements', 'meta'], 'readwrite');
    const prs = tx.objectStore('projects'), ms = tx.objectStore('movements'), meta = tx.objectStore('meta');
    const swap = (list) => uniq((list || []).map(n => n === from ? to : n));
    meta.put(swap(await reqP(meta.get(kind))).sort(nameSort), kind);
    for (const p of await reqP(prs.getAll())) {
      if ((p[kind] || []).includes(from)) { p[kind] = swap(p[kind]); p.updatedAt = now(); prs.put(p); }
    }
    const [a, b] = kind === 'locations' ? ['location', 'toLocation'] : ['owner', 'toOwner'];
    for (const m of await reqP(ms.getAll())) {
      let hit = false;
      for (const r of [m, ...(m.edits || [])]) {
        if (r[a] === from) { r[a] = to; hit = true; }
        if (r[b] === from) { r[b] = to; hit = true; }
      }
      if (hit) ms.put(m);
    }
    if (kind === 'locations') {
      const photos = (await reqP(meta.get('locPhotos'))) || {};
      if (photos[from]) {
        photos[to] = [...(photos[to] || []), ...photos[from]];
        delete photos[from];
        meta.put(photos, 'locPhotos');
      }
    }
    await done(tx);
  }

  /** Takes a name off the app-wide list and every project's list (and deletes a
   *  location's photos). Entries that use it keep it. */
  async function removeName(kind, name) {
    const db = await open();
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    const prs = tx.objectStore('projects'), meta = tx.objectStore('meta');
    meta.put(((await reqP(meta.get(kind))) || []).filter(n => n !== name), kind);
    for (const p of await reqP(prs.getAll())) {
      if ((p[kind] || []).includes(name)) { p[kind] = p[kind].filter(n => n !== name); prs.put(p); }
    }
    if (kind === 'locations') {
      const photos = (await reqP(meta.get('locPhotos'))) || {};
      if (photos[name]) { delete photos[name]; meta.put(photos, 'locPhotos'); }
    }
    await done(tx);
  }

  /** Adds a name to the app-wide list (and to one project's list when projectId is given). */
  async function addName(kind, name, projectId = null) {
    name = tidy(name);
    if (!name) return;
    const db = await open();
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    await pushShared(tx.objectStore('meta'), kind, [name]);
    if (projectId) {
      const s = tx.objectStore('projects');
      const project = await reqP(s.get(projectId));
      if (project && !(project[kind] || []).includes(name)) { project[kind] = [...(project[kind] || []), name]; s.put(project); }
    }
    await done(tx);
  }

  /** Sets which names a project uses (its "This project" group), e.g. its product owners.
   *  New names also go on the app-wide list. */
  async function setProjectNames(projectId, kind, names) {
    const db = await open();
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    const s = tx.objectStore('projects');
    const project = await reqP(s.get(projectId));
    project[kind] = uniq(names.map(tidy).filter(Boolean));
    project.updatedAt = now();
    s.put(project);
    await pushShared(tx.objectStore('meta'), kind, project[kind]);
    await done(tx);
  }

  // ---------- storage location photos (1.10) ----------
  // Any number of photos per location, each with a name the user types (Door, Shelves…).
  async function locPhotosTx(fn) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    const meta = tx.objectStore('meta');
    const all = (await reqP(meta.get('locPhotos'))) || {};
    const r = fn(all);
    meta.put(all, 'locPhotos');
    await done(tx);
    return r;
  }
  async function listLocPhotos() { return (await get('meta', 'locPhotos')) || {}; }
  const addLocPhoto = (location, label, photo) => locPhotosTx(all => {
    const rec = { id: uid(), label: tidy(label), photo, at: now() };
    (all[location] = all[location] || []).push(rec);
    return rec.id;
  });
  const renameLocPhoto = (location, id, label) => locPhotosTx(all => {
    const r = (all[location] || []).find(x => x.id === id);
    if (r) r.label = tidy(label);
  });
  const removeLocPhoto = (location, id) => locPhotosTx(all => {
    all[location] = (all[location] || []).filter(x => x.id !== id);
    if (!all[location].length) delete all[location];
  });

  /** Everything in stock right now, one row per product and place with qty > 0. */
  async function stockRows() {
    const db = await open();
    const tx = db.transaction(DATA_STORES);
    const [projects, products, movements] = await Promise.all(DATA_STORES.map(n => reqP(tx.objectStore(n).getAll())));
    const byProd = {};
    for (const m of movements) (byProd[m.productId] = byProd[m.productId] || []).push(m);
    const proj = Object.fromEntries(projects.map(p => [p.id, p]));
    const rows = [];
    for (const p of products) {
      if (!proj[p.projectId]) continue;
      for (const b of bucketsOf(byProd[p.id] || [])) if (b.qty > 0) rows.push({ product: p, project: proj[p.projectId], ...b });
    }
    return { rows, projects };
  }

  // ---------- people (1.6) ----------
  // One app-wide list of names (meta 'people'), picked on Add, Remove, Move and Correct
  // count so Reports can show who added and used stock. A name is added the first time
  // it is used. Renaming changes it on every entry in every project.
  const nameSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  async function listPeople() { return ((await get('meta', 'people')) || []).slice(); }
  async function addPeople(names) {
    names = names.map(tidy).filter(Boolean);
    if (!names.length) return;
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    const s = tx.objectStore('meta');
    const list = (await reqP(s.get('people'))) || [];
    let changed = false;
    for (const n of names) if (!list.includes(n)) { list.push(n); changed = true; }
    if (changed) s.put(list.sort(nameSort), 'people');
    await done(tx);
  }
  const addPerson = (name) => addPeople([name]);
  async function renamePerson(from, to) {
    to = tidy(to);
    if (!to || to === from) return;
    const db = await open();
    const tx = db.transaction(['meta', 'movements'], 'readwrite');
    const s = tx.objectStore('meta'), ms = tx.objectStore('movements');
    const list = ((await reqP(s.get('people'))) || []).map(n => n === from ? to : n);
    s.put(list.filter((n, i) => list.indexOf(n) === i).sort(nameSort), 'people');
    for (const m of await reqP(ms.getAll())) {
      let hit = false;
      if (m.person === from) { m.person = to; hit = true; }
      for (const e of m.edits || []) if (e.person === from) { e.person = to; hit = true; }
      if (hit) ms.put(m);
    }
    await done(tx);
  }
  /** Takes a name off the list. Entries that use it keep it. */
  async function removePerson(name) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    const s = tx.objectStore('meta');
    s.put(((await reqP(s.get('people'))) || []).filter(n => n !== name), 'people');
    await done(tx);
  }

  // ---------- products ----------
  async function listProducts(projectId) {
    const items = await getAll('products', 'projectId', projectId);
    return items.sort((a, b) =>
      (a.partNumber || a.description).localeCompare(b.partNumber || b.description, undefined, { numeric: true, sensitivity: 'base' }));
  }
  const getProduct = (id) => get('products', id);
  const isLow = (p) => p.lowStockAt != null && p.stock <= p.lowStockAt;
  const cleanLow = (v) => (v === '' || v == null || isNaN(v)) ? null : Math.max(0, Math.floor(v));

  async function saveProduct(data) {
    const db = await open();
    const tx = db.transaction(['projects', 'products', 'movements', 'meta'], 'readwrite');
    const s = tx.objectStore('products');
    let rec;
    if (data.id) {
      rec = await reqP(s.get(data.id));
      rec.partNumber = data.partNumber;
      rec.description = data.description;
      if (data.photo !== undefined) rec.photo = data.photo;
      if (data.morePhotos !== undefined) rec.morePhotos = data.morePhotos || [];
      if (data.lowStockAt !== undefined) rec.lowStockAt = cleanLow(data.lowStockAt);
      if (data.barcode !== undefined) rec.barcode = tidy(data.barcode) || null;
      rec.updatedAt = now();
      s.put(rec);
    } else {
      const t = now();
      const initial = Math.max(0, Math.floor(data.initialStock || 0));
      rec = {
        id: uid(), projectId: data.projectId,
        partNumber: data.partNumber, description: data.description,
        photo: data.photo || null, morePhotos: data.morePhotos || [], stock: initial,
        barcode: tidy(data.barcode) || null, location: null, lowStockAt: cleanLow(data.lowStockAt),
        createdAt: t, updatedAt: t,
      };
      s.put(rec);
      if (initial > 0) {
        const m = {
          id: uid(), productId: rec.id, projectId: rec.projectId,
          delta: initial, kind: 'in', note: 'Initial stock', at: t, createdAt: t,
          location: (data.location || '').trim(), owner: (data.owner || '').trim(),
          person: (data.person || '').trim(),
        };
        tx.objectStore('movements').put(m);
        const prs = tx.objectStore('projects');
        const project = await reqP(prs.get(rec.projectId));
        if (addNames(project, [m])) prs.put(project);
        await pushShared(tx.objectStore('meta'), 'locations', [m.location]);
        await pushShared(tx.objectStore('meta'), 'owners', [m.owner]);
      }
    }
    await done(tx);
    if (data.person) await addPeople([data.person]);
    return rec;
  }

  /** Sets or clears (null) a product's low-stock warning level. */
  async function setLowStock(id, value) {
    const db = await open();
    const tx = db.transaction('products', 'readwrite');
    const ps = tx.objectStore('products');
    const p = await reqP(ps.get(id));
    if (!p) { tx.abort(); throw new Error('Product not found'); }
    p.lowStockAt = cleanLow(value); p.updatedAt = now();
    ps.put(p);
    await done(tx);
    return p;
  }

  async function deleteProduct(id) {
    const db = await open();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    tx.objectStore('products').delete(id);
    tx.objectStore('movements').index('productId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
      const c = e.target.result;
      if (c) { tx.objectStore('movements').delete(c.primaryKey); c.continue(); }
    };
    await done(tx);
  }

  // ---------- movements ----------
  async function listMovements(productId) {
    const items = await getAll('movements', 'productId', productId);
    return items.sort((a, b) => (b.at.localeCompare(a.at)) || b.createdAt.localeCompare(a.createdAt));
  }

  const PLACE_FIELDS = ['location', 'owner', 'toLocation', 'toOwner', 'person'];
  const tidy = (v) => (v || '').trim();

  /** Builds the stored fields of an entry from what a form returned. */
  function entryFields({ kind, delta, qty, note, at, dateOnly, location, owner, toLocation, toOwner, person }) {
    const f = { note: tidy(note), at: at || now(), location: tidy(location), owner: tidy(owner), person: tidy(person) };
    if (kind === 'move') {
      Object.assign(f, { kind: 'move', delta: 0, qty: Math.trunc(qty), toLocation: tidy(toLocation), toOwner: tidy(toOwner) });
    } else {
      f.delta = Math.trunc(delta);
      f.kind = kind === 'count' ? 'count' : f.delta > 0 ? 'in' : 'out';
    }
    if (dateOnly) f.dateOnly = true;
    return f;
  }

  /** Adds an entry. delta > 0 adds stock, delta < 0 removes; kind 'move' moves qty from
   *  (location, owner) to (toLocation, toOwner). Rejects if a place would go below 0. */
  async function addMovement(data) {
    const f = entryFields(data);
    if (f.kind === 'move' ? f.qty <= 0 : f.delta === 0) {
      return { product: await getProduct(data.productId), movement: null };
    }
    let movement;
    const product = await change({ productId: data.productId }, ({ p }) => {
      movement = { id: uid(), productId: p.id, projectId: p.projectId, ...f, createdAt: now() };
      return { put: [movement], value: (p2) => p2 };
    });
    return { product, movement };
  }

  /** Sets the count at one place: records the difference as a 'count' entry. */
  async function setCount({ productId, location, owner, person, count, note = 'Stock count correction' }) {
    location = tidy(location); owner = tidy(owner); person = tidy(person);
    let movement = null;
    const product = await change({ productId }, ({ p, moves }) => {
      const b = bucketsOf(moves).find(x => x.location === location && x.owner === owner);
      const delta = Math.trunc(count) - (b ? b.qty : 0);
      if (!delta) return { abort: true, value: p };
      movement = { id: uid(), productId: p.id, projectId: p.projectId, delta, kind: 'count', note, at: now(), createdAt: now(), location, owner, person };
      return { put: [movement], value: (p2) => p2 };
    });
    return { product, movement };
  }

  /** Changes an entry's quantity, date, note, location or owner. Stock follows.
   *  The previous version is kept in `edits` so the change is on record.
   *  Rejects (nothing changed) if a place would go below 0. */
  async function updateMovement(id, data) {
    let changed = false, movement;
    const product = await change({ movementId: id }, ({ p, m0 }) => {
      const f = entryFields({ ...data, kind: m0.kind === 'count' ? 'count' : m0.kind === 'move' ? 'move' : data.kind });
      const same = ['delta', 'qty', 'at', 'note', ...PLACE_FIELDS].every(k => (f[k] ?? '') === (m0[k] ?? '')) && !!f.dateOnly === !!m0.dateOnly;
      if (same) { movement = m0; return { abort: true, value: p }; }
      const t = now();
      const prev = { delta: m0.delta, at: m0.at, dateOnly: !!m0.dateOnly, note: m0.note, editedAt: t };
      for (const k of ['qty', ...PLACE_FIELDS]) if (m0[k] !== undefined) prev[k] = m0[k];
      movement = { ...m0, ...f, edits: [...(m0.edits || []), prev], editedAt: t };
      if (!f.dateOnly) delete movement.dateOnly;
      changed = true;
      return { put: [movement], value: (p2) => p2 };
    });
    return { movement, product, changed };
  }

  async function updateMovementNote(id, note) {
    const db = await open();
    const tx = db.transaction('movements', 'readwrite');
    const s = tx.objectStore('movements');
    const m = await reqP(s.get(id));
    m.note = (note || '').trim();
    s.put(m);
    await done(tx);
    return m;
  }

  /** Notes used recently in a project, newest first, without duplicates. */
  async function recentNotes(projectId, limit = 8) {
    const items = await getAll('movements', 'projectId', projectId);
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set(), out = [];
    for (const m of items) {
      const n = (m.note || '').trim();
      if (!n || m.kind === 'count' || n === 'Initial stock') continue;
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(n);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Removes an entry and reverses its effect on stock.
   *  Rejects if that would leave a place below 0 (a later removal used that stock). */
  async function deleteMovement(id) {
    await change({ movementId: id }, ({ m0 }) => ({ del: [m0.id] }));
  }

  // ---------- backup & restore ----------
  const DATA_STORES = ['projects', 'products', 'movements'];

  /** Every project, product (photo as a Blob) and entry. */
  async function exportAll() {
    const db = await open();
    const tx = db.transaction([...DATA_STORES, 'meta']);
    const [projects, products, movements] = await Promise.all(DATA_STORES.map(n => reqP(tx.objectStore(n).getAll())));
    return { projects, products, movements, ...await metaLists(tx.objectStore('meta')) };
  }

  /** Replaces everything with `data` in one transaction (all or nothing). What was there
   *  before is kept in meta 'beforeRestore', so the restore can be undone.
   *  Each product's stock is set from its entries, so the stock invariant holds.
   *  undo: true puts the safety copy back instead and then removes it.
   *  reason is saved with the safety copy ('restore', or 'deleteAll' for Delete all data).
   *  data.people (1.6) replaces the People list when given; older backups have none, so
   *  the list is kept and any names on the restored entries are added to it.
   *  data.locations / owners (1.10) replace the app-wide lists; older backups have none,
   *  so they are made from the restored projects' lists. data.locPhotos (1.10) replaces
   *  the location photos; older backups have none, so the photos on the phone are kept. */
  async function replaceAll(data, { undo = false, reason = 'restore' } = {}) {
    const sums = {};
    for (const m of data.movements) sums[m.productId] = (sums[m.productId] || 0) + (m.delta || 0);
    const db = await open();
    const tx = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
    const [projects, products, movements] = await Promise.all(DATA_STORES.map(n => reqP(tx.objectStore(n).getAll())));
    const meta = tx.objectStore('meta');
    const cur = await metaLists(meta);
    const people = cur.people;
    if (undo) meta.delete('beforeRestore');
    else meta.put({ savedAt: now(), reason, data: { projects, products, movements, ...cur } }, 'beforeRestore');
    const nextPeople = (Array.isArray(data.people) ? data.people : people).slice();
    for (const m of data.movements) { const n = tidy(m.person); if (n && !nextPeople.includes(n)) nextPeople.push(n); }
    meta.put(nextPeople.sort(nameSort), 'people');
    const derived = sharedFrom(data.projects);
    for (const k of KINDS) {
      const list = (Array.isArray(data[k]) ? data[k] : derived[k]).map(tidy).filter(Boolean);
      for (const n of derived[k]) if (!list.includes(n)) list.push(n);
      meta.put(uniq(list).sort(nameSort), k);
    }
    meta.put(data.locPhotos && typeof data.locPhotos === 'object' ? data.locPhotos : cur.locPhotos, 'locPhotos');
    meta.delete('formDraft');   // build 16: an unsaved form belongs to the data being replaced
    for (const n of DATA_STORES) tx.objectStore(n).clear();
    for (const p of data.projects) tx.objectStore('projects').put(p);
    for (const p of data.products) tx.objectStore('products').put({ ...p, stock: sums[p.id] || 0 });
    for (const m of data.movements) tx.objectStore('movements').put(m);
    await done(tx);
  }

  /** Erases every project, product, photo and entry (settings in localStorage stay).
   *  A safety copy is kept first, like a restore, so it can be undone. */
  // The Team Member list stays; storage locations, product owners and their photos go.
  const deleteAll = () => replaceAll({ projects: [], products: [], movements: [], locations: [], owners: [], locPhotos: {} }, { reason: 'deleteAll' });

  /** The safety copy from before the last restore or delete, or undefined. */
  const beforeRestore = () => get('meta', 'beforeRestore');

  /** The unsaved Add inventory form (build 16), kept as the user types so it survives the
   *  browser being closed by the phone (for example while the camera app is open).
   *  { key, route, at, fields, photos: [Blob] }, or undefined. */
  const getDraft = () => get('meta', 'formDraft');
  async function setDraft(d) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    if (d) tx.objectStore('meta').put(d, 'formDraft'); else tx.objectStore('meta').delete('formDraft');
    await done(tx);
  }
  const clearDraft = () => setDraft(null);

  /** How much room the app uses on this phone (build 16): { usage, quota, persisted } in bytes,
   *  or null where the browser can't tell. */
  async function storageInfo() {
    try {
      if (!navigator.storage?.estimate) return null;
      const [{ usage, quota }, persisted] = await Promise.all([navigator.storage.estimate(),
        navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false)]);
      return { usage: usage || 0, quota: quota || 0, persisted };
    } catch { return null; }
  }

  async function persist() {
    try {
      if (navigator.storage?.persisted && await navigator.storage.persisted()) return true;
      return navigator.storage?.persist ? await navigator.storage.persist() : false;
    } catch { return false; }
  }

  return {
    open, listProjects, getProject, saveProject, deleteProject, deleteProjects, deleteProducts, deleteAll,
    listProducts, getProduct, saveProduct, deleteProduct,
    listMovements, addMovement, setCount, updateMovement, updateMovementNote, deleteMovement, recentNotes, persist, getDraft, setDraft, clearDraft, storageInfo,
    bucketsOf, isLow, setLowStock, listNames, addName, renameName, removeName, setProjectNames, stockRows,
    listLocPhotos, addLocPhoto, renameLocPhoto, removeLocPhoto,
    listPeople, addPerson, renamePerson, removePerson,
    exportAll, replaceAll, beforeRestore,
  };
})();
