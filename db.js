/* Local storage layer (IndexedDB). No server, no sync.
 *
 * Stores
 *   projects  { id, name, locations: [names], owners: [names], createdAt, updatedAt }
 *               locations/owners are the project's pick lists (added in 1.3; missing = empty).
 *   products  { id, projectId, partNumber, description, photo (Blob|null), stock,
 *               lowStockAt (number|null: flag when stock <= this), barcode, location
 *               (barcode/location unused, kept null), createdAt, updatedAt }
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
 *
 * Stock is counted per place (location + owner): the sum of entries at that place.
 * Invariants: product.stock === sum(movement.delta) for that product, and no place
 * goes below 0. Every stock change goes through change() so they always hold.
 */
const DB = (() => {
  const NAME = 'simple-inventory';
  const VERSION = 3;
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
        // Future versions: add `if (e.oldVersion < 4) { ... }` blocks here.
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

  async function saveProject({ id, name }) {
    const db = await open();
    const tx = db.transaction('projects', 'readwrite');
    const s = tx.objectStore('projects');
    let rec;
    if (id) {
      rec = await reqP(s.get(id));
      rec.name = name; rec.updatedAt = now();
    } else {
      rec = { id: uid(), name, locations: [], owners: [], createdAt: now(), updatedAt: now() };
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
    const people = (await reqP(tx.objectStore('meta').get('people'))) || [];
    tx.objectStore('meta').put({ savedAt: now(), reason: 'delete', data: { projects, products, movements, people } }, 'beforeRestore');
    for (const p of projects) if (dropProj.has(p.id)) tx.objectStore('projects').delete(p.id);
    for (const p of products) if (dropProj.has(p.projectId) || dropProd.has(p.id)) tx.objectStore('products').delete(p.id);
    for (const m of movements) if (dropProj.has(m.projectId) || dropProd.has(m.productId)) tx.objectStore('movements').delete(m.id);
    await done(tx);
  }
  const deleteProjects = (ids) => deleteData({ projectIds: ids });
  const deleteProducts = (ids) => deleteData({ productIds: ids });
  const deleteProject = (id) => deleteProjects([id]);

  // ---------- locations & owners ----------
  // Each project keeps two name lists: project.locations and project.owners. A name is
  // added the first time it is used on an entry. Old entries have no location/owner
  // ('' = "Not set"). Stock is counted per location + owner pair ("place").

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
    const tx = db.transaction(['projects', 'products', 'movements'], 'readwrite');
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
    await done(tx);
    await addPeople(put.map(m => m.person));
    return typeof r.value === 'function' ? r.value(p) : r.value;
  }

  /** Renames a location or owner (kind 'locations' | 'owners') in the project's list
   *  and on every entry that uses it. Renaming onto an existing name merges the two. */
  async function renameName(projectId, kind, from, to) {
    to = (to || '').trim();
    if (!to || to === from) return;
    const db = await open();
    const tx = db.transaction(['projects', 'movements'], 'readwrite');
    const prs = tx.objectStore('projects'), ms = tx.objectStore('movements');
    const project = await reqP(prs.get(projectId));
    const list = (project[kind] || []).map(n => n === from ? to : n);
    project[kind] = list.filter((n, i) => list.indexOf(n) === i);
    project.updatedAt = now();
    prs.put(project);
    const [a, b] = kind === 'locations' ? ['location', 'toLocation'] : ['owner', 'toOwner'];
    const moves = await reqP(ms.index('projectId').getAll(projectId));
    for (const m of moves) {
      let hit = false;
      if (m[a] === from) { m[a] = to; hit = true; }
      if (m[b] === from) { m[b] = to; hit = true; }
      if (hit) ms.put(m);
    }
    await done(tx);
  }

  /** Takes a name off the project's list. Entries that use it keep it. */
  async function removeName(projectId, kind, name) {
    const db = await open();
    const tx = db.transaction('projects', 'readwrite');
    const s = tx.objectStore('projects');
    const project = await reqP(s.get(projectId));
    project[kind] = (project[kind] || []).filter(n => n !== name);
    s.put(project);
    await done(tx);
  }

  async function addName(projectId, kind, name) {
    name = (name || '').trim();
    if (!name) return;
    const db = await open();
    const tx = db.transaction('projects', 'readwrite');
    const s = tx.objectStore('projects');
    const project = await reqP(s.get(projectId));
    const list = project[kind] || [];
    if (!list.includes(name)) list.push(name);
    project[kind] = list;
    s.put(project);
    await done(tx);
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
    const tx = db.transaction(['projects', 'products', 'movements'], 'readwrite');
    const s = tx.objectStore('products');
    let rec;
    if (data.id) {
      rec = await reqP(s.get(data.id));
      rec.partNumber = data.partNumber;
      rec.description = data.description;
      if (data.photo !== undefined) rec.photo = data.photo;
      if (data.lowStockAt !== undefined) rec.lowStockAt = cleanLow(data.lowStockAt);
      rec.updatedAt = now();
      s.put(rec);
    } else {
      const t = now();
      const initial = Math.max(0, Math.floor(data.initialStock || 0));
      rec = {
        id: uid(), projectId: data.projectId,
        partNumber: data.partNumber, description: data.description,
        photo: data.photo || null, stock: initial,
        barcode: null, location: null, lowStockAt: cleanLow(data.lowStockAt),
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
    const people = (await reqP(tx.objectStore('meta').get('people'))) || [];
    return { projects, products, movements, people };
  }

  /** Replaces everything with `data` in one transaction (all or nothing). What was there
   *  before is kept in meta 'beforeRestore', so the restore can be undone.
   *  Each product's stock is set from its entries, so the stock invariant holds.
   *  undo: true puts the safety copy back instead and then removes it.
   *  reason is saved with the safety copy ('restore', or 'deleteAll' for Delete all data).
   *  data.people (1.6) replaces the People list when given; older backups have none, so
   *  the list is kept and any names on the restored entries are added to it. */
  async function replaceAll(data, { undo = false, reason = 'restore' } = {}) {
    const sums = {};
    for (const m of data.movements) sums[m.productId] = (sums[m.productId] || 0) + (m.delta || 0);
    const db = await open();
    const tx = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
    const [projects, products, movements] = await Promise.all(DATA_STORES.map(n => reqP(tx.objectStore(n).getAll())));
    const people = (await reqP(tx.objectStore('meta').get('people'))) || [];
    if (undo) tx.objectStore('meta').delete('beforeRestore');
    else tx.objectStore('meta').put({ savedAt: now(), reason, data: { projects, products, movements, people } }, 'beforeRestore');
    const nextPeople = (Array.isArray(data.people) ? data.people : people).slice();
    for (const m of data.movements) { const n = tidy(m.person); if (n && !nextPeople.includes(n)) nextPeople.push(n); }
    tx.objectStore('meta').put(nextPeople.sort(nameSort), 'people');
    for (const n of DATA_STORES) tx.objectStore(n).clear();
    for (const p of data.projects) tx.objectStore('projects').put(p);
    for (const p of data.products) tx.objectStore('products').put({ ...p, stock: sums[p.id] || 0 });
    for (const m of data.movements) tx.objectStore('movements').put(m);
    await done(tx);
  }

  /** Erases every project, product, photo and entry (settings in localStorage stay).
   *  A safety copy is kept first, like a restore, so it can be undone. */
  const deleteAll = () => replaceAll({ projects: [], products: [], movements: [] }, { reason: 'deleteAll' }); // People list stays

  /** The safety copy from before the last restore or delete, or undefined. */
  const beforeRestore = () => get('meta', 'beforeRestore');

  async function persist() {
    try {
      if (navigator.storage?.persisted && await navigator.storage.persisted()) return true;
      return navigator.storage?.persist ? await navigator.storage.persist() : false;
    } catch { return false; }
  }

  return {
    open, listProjects, getProject, saveProject, deleteProject, deleteProjects, deleteProducts, deleteAll,
    listProducts, getProduct, saveProduct, deleteProduct,
    listMovements, addMovement, setCount, updateMovement, updateMovementNote, deleteMovement, recentNotes, persist,
    bucketsOf, isLow, setLowStock, addName, renameName, removeName,
    listPeople, addPerson, renamePerson, removePerson,
    exportAll, replaceAll, beforeRestore,
  };
})();
