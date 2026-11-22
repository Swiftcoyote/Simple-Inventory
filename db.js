/* Local storage layer (IndexedDB). No server, no sync.
 *
 * Stores
 *   projects  { id, name, createdAt, updatedAt }
 *   products  { id, projectId, partNumber, description, photo (Blob|null), stock,
 *               barcode, location, lowStockAt, createdAt, updatedAt }
 *               barcode / location / lowStockAt are reserved for step 2 (null for now).
 *   movements { id, productId, projectId, delta (+in / -out), kind ('in'|'out'|'count'),
 *               note, at (ISO time of the event), dateOnly (true when the user picked a
 *               past date, so only the date is meaningful), createdAt,
 *               editedAt + edits[] (earlier versions {delta, at, dateOnly, note, editedAt},
 *               oldest first; only present once an entry has been edited) }
 *               New fields are optional, so entries saved by older builds need no migration.
 *
 * Invariant: product.stock === sum(movement.delta) for that product.
 * Every stock change goes through addMovement / deleteMovement so the two never drift.
 */
const DB = (() => {
  const NAME = 'simple-inventory';
  const VERSION = 1;
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
        // Future versions: add `if (e.oldVersion < 2) { ... }` blocks here.
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
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
      const s = stats[p.projectId] || (stats[p.projectId] = { items: 0, units: 0 });
      s.items++; s.units += p.stock;
    }
    return projects
      .map(p => ({ ...p, items: stats[p.id]?.items || 0, units: stats[p.id]?.units || 0 }))
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
      rec = { id: uid(), name, createdAt: now(), updatedAt: now() };
    }
    s.put(rec);
    await done(tx);
    return rec;
  }

  async function deleteProject(id) {
    const db = await open();
    const tx = db.transaction(['projects', 'products', 'movements'], 'readwrite');
    tx.objectStore('projects').delete(id);
    for (const store of ['products', 'movements']) {
      const idx = tx.objectStore(store).index('projectId');
      idx.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const c = e.target.result;
        if (c) { tx.objectStore(store).delete(c.primaryKey); c.continue(); }
      };
    }
    await done(tx);
  }

  // ---------- products ----------
  async function listProducts(projectId) {
    const items = await getAll('products', 'projectId', projectId);
    return items.sort((a, b) =>
      (a.partNumber || a.description).localeCompare(b.partNumber || b.description, undefined, { numeric: true, sensitivity: 'base' }));
  }
  const getProduct = (id) => get('products', id);

  async function saveProduct(data) {
    const db = await open();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const s = tx.objectStore('products');
    let rec;
    if (data.id) {
      rec = await reqP(s.get(data.id));
      rec.partNumber = data.partNumber;
      rec.description = data.description;
      if (data.photo !== undefined) rec.photo = data.photo;
      rec.updatedAt = now();
      s.put(rec);
    } else {
      const t = now();
      const initial = Math.max(0, Math.floor(data.initialStock || 0));
      rec = {
        id: uid(), projectId: data.projectId,
        partNumber: data.partNumber, description: data.description,
        photo: data.photo || null, stock: initial,
        barcode: null, location: null, lowStockAt: null,
        createdAt: t, updatedAt: t,
      };
      s.put(rec);
      if (initial > 0) {
        tx.objectStore('movements').put({
          id: uid(), productId: rec.id, projectId: rec.projectId,
          delta: initial, kind: 'in', note: 'Initial stock', at: t, createdAt: t,
        });
      }
    }
    await done(tx);
    return rec;
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

  /** delta > 0 adds stock, delta < 0 removes. Stock never goes below 0. */
  async function addMovement({ productId, delta, note = '', at, dateOnly = false, kind }) {
    const db = await open();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const ps = tx.objectStore('products');
    const p = await reqP(ps.get(productId));
    if (!p) throw new Error('Product not found');
    delta = Math.trunc(delta);
    if (p.stock + delta < 0) delta = -p.stock;
    if (delta === 0) { tx.abort(); return { product: p, movement: null }; }
    p.stock += delta;
    p.updatedAt = now();
    ps.put(p);
    const m = {
      id: uid(), productId, projectId: p.projectId, delta,
      kind: kind || (delta > 0 ? 'in' : 'out'),
      note: (note || '').trim(), at: at || now(), createdAt: now(),
    };
    if (dateOnly) m.dateOnly = true;
    tx.objectStore('movements').put(m);
    await done(tx);
    return { product: p, movement: m };
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

  /** Changes an entry's quantity, date and/or note. Stock moves by the difference.
   *  The previous version is kept in `edits` so the change is on record.
   *  Rejects (stock unchanged) if the edit would leave stock below 0. */
  async function updateMovement(id, { delta, at, dateOnly, note }) {
    const db = await open();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const ms = tx.objectStore('movements');
    const m = await reqP(ms.get(id));
    if (!m) { tx.abort(); throw new Error('Entry not found'); }
    const ps = tx.objectStore('products');
    const p = await reqP(ps.get(m.productId));
    delta = Math.trunc(delta);
    note = (note || '').trim();
    dateOnly = !!dateOnly;
    if (delta === m.delta && at === m.at && dateOnly === !!m.dateOnly && note === m.note) {
      tx.abort(); return { movement: m, product: p, changed: false };
    }
    if (p) {
      const stock = p.stock - m.delta + delta;
      if (stock < 0) { tx.abort(); const e = new Error(`That would leave ${stock} in stock`); e.code = 'NEGATIVE'; throw e; }
      p.stock = stock; p.updatedAt = now(); ps.put(p);
    }
    const t = now();
    m.edits = [...(m.edits || []), { delta: m.delta, at: m.at, dateOnly: !!m.dateOnly, note: m.note, editedAt: t }];
    m.delta = delta; m.at = at; m.note = note; m.editedAt = t;
    if (dateOnly) m.dateOnly = true; else delete m.dateOnly;
    if (m.kind !== 'count') m.kind = delta > 0 ? 'in' : 'out';
    ms.put(m);
    await done(tx);
    return { movement: m, product: p, changed: true };
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

  /** Removes an entry and reverses its effect on stock. */
  async function deleteMovement(id) {
    const db = await open();
    const tx = db.transaction(['products', 'movements'], 'readwrite');
    const ms = tx.objectStore('movements');
    const m = await reqP(ms.get(id));
    if (!m) { tx.abort(); return; }
    const ps = tx.objectStore('products');
    const p = await reqP(ps.get(m.productId));
    if (p) { p.stock = Math.max(0, p.stock - m.delta); p.updatedAt = now(); ps.put(p); }
    ms.delete(id);
    await done(tx);
  }

  async function persist() {
    try {
      if (navigator.storage?.persisted && await navigator.storage.persisted()) return true;
      return navigator.storage?.persist ? await navigator.storage.persist() : false;
    } catch { return false; }
  }

  return {
    open, listProjects, getProject, saveProject, deleteProject,
    listProducts, getProduct, saveProduct, deleteProduct,
    listMovements, addMovement, updateMovement, updateMovementNote, deleteMovement, recentNotes, persist,
  };
})();
