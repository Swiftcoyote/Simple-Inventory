/* Simple Inventory — UI. Vanilla JS, hash routing, no build step. */
(() => {
  // Release number shown on the home screen. Bump APP_VERSION for a new release
  // and APP_BUILD for every upload; keep sw.js VERSION in step so phones update.
  const APP_VERSION = '1.0';
  const APP_BUILD = 1;

  const $view = document.getElementById('view');
  const $title = document.getElementById('title');
  const $back = document.getElementById('backBtn');
  const $menu = document.getElementById('menuBtn');
  const $sheetRoot = document.getElementById('sheetRoot');
  const $toast = document.getElementById('toast');

  // ---------- helpers ----------
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };

  let urls = [];
  const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  const fmtWhen = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    const sameYear = d.getFullYear() === today.getFullYear();
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }) + `, ${time}`;
  };
  const toLocalInput = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const productName = (p) => p.partNumber || p.description || 'Untitled';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const ICON = {
    plus: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, actions = []) {
    clearTimeout(toastTimer);
    $toast.innerHTML = `<span class="msg">${esc(msg)}</span>` +
      actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('');
    $toast.hidden = false;
    $toast.querySelectorAll('button').forEach(b => b.onclick = () => { hideToast(); actions[+b.dataset.i].run(); });
    toastTimer = setTimeout(hideToast, actions.length ? 5000 : 2500);
  }
  function hideToast() { clearTimeout(toastTimer); $toast.hidden = true; }

  // ---------- bottom sheet ----------
  function sheet(innerHtml, onMount) {
    hideToast();
    const node = h(`<div class="backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${innerHtml}</div></div>`);
    const back = node.firstElementChild;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    $sheetRoot.replaceChildren(back);
    onMount?.(back.querySelector('.sheet'), close);
    return close;
  }

  function confirmSheet(title, body, okLabel = 'Delete') {
    return new Promise((resolve) => {
      sheet(`<h3>${esc(title)}</h3><p class="desc">${esc(body)}</p>
        <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn out" data-a="ok">${esc(okLabel)}</button></div>`,
        (el, close) => {
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(false); };
          el.querySelector('[data-a=ok]').onclick = () => { close(); resolve(true); };
        });
    });
  }

  function textSheet(title, { value = '', placeholder = '', label = 'Save', multiline = false } = {}) {
    return new Promise((resolve) => {
      const field = multiline
        ? `<textarea class="input" name="v" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done">`;
      sheet(`<h3>${esc(title)}</h3><form>${field}
        <div class="actions"><button type="button" class="btn" data-a="no">Cancel</button><button class="btn primary">${esc(label)}</button></div></form>`,
        (el, close) => {
          const f = el.querySelector('form');
          const inp = f.elements.v;
          setTimeout(() => inp.focus(), 50);
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => { e.preventDefault(); close(); resolve(inp.value.trim()); };
        });
    });
  }

  function menuSheet(title, items) {
    sheet(`<h3>${esc(title)}</h3><div class="menu">${items.map((it, i) =>
      `<button class="btn ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}
      <button class="btn ghost" data-close>Cancel</button></div>`,
      (el, close) => {
        el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { close(); items[+b.dataset.i].run(); });
        el.querySelector('[data-close]').onclick = close;
      });
  }

  /** Add / remove stock with quantity, date/time and optional note. */
  function movementSheet(product, dir) {
    const isOut = dir === 'out';
    return new Promise((resolve) => {
      sheet(`<h3>${isOut ? 'Remove from' : 'Add to'} stock</h3>
        <p class="desc" style="margin-top:-8px">${esc(productName(product))} · ${product.stock} in stock</p>
        <form>
          <label class="field"><span>Quantity</span>
            <div class="stepper">
              <button type="button" class="qbtn minus" data-s="-1">−</button>
              <input class="input" name="qty" type="number" inputmode="numeric" min="1" step="1" value="1">
              <button type="button" class="qbtn plus" data-s="1">+</button>
            </div>
          </label>
          <label class="field"><span>Note (optional)</span>
            <input class="input" name="note" placeholder="${isOut ? 'e.g. used on job #142' : 'e.g. PO 5521 from supplier'}" autocomplete="off" enterkeyhint="done">
          </label>
          <label class="field"><span>Date &amp; time</span>
            <input class="input" name="at" type="datetime-local" value="${toLocalInput()}">
          </label>
          <div class="actions">
            <button type="button" class="btn" data-a="no">Cancel</button>
            <button class="btn ${isOut ? 'out' : 'in'}">${isOut ? 'Remove' : 'Add'}</button>
          </div>
        </form>`,
        (el, close) => {
          const f = el.querySelector('form');
          const q = f.elements.qty;
          el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
            q.value = Math.max(1, (parseInt(q.value, 10) || 0) + (+b.dataset.s));
          });
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => {
            e.preventDefault();
            const n = parseInt(q.value, 10);
            if (!n || n < 1) { q.focus(); return; }
            if (isOut && n > product.stock) {
              toast(`Only ${product.stock} in stock`); q.value = product.stock || 1; return;
            }
            const atEl = f.elements.at;
            // untouched → exact current time; edited → the chosen date/time
            const at = atEl.value && atEl.value !== atEl.defaultValue ? new Date(atEl.value).toISOString() : undefined;
            close();
            resolve({ delta: isOut ? -n : n, note: f.elements.note.value, at });
          };
        });
    });
  }

  /** Quick ±1 with Undo and "Add note" in the toast. */
  async function quickMove(productId, delta, after) {
    const { product, movement } = await DB.addMovement({ productId, delta });
    if (!movement) { toast('Already at 0'); return; }
    after?.(product);
    toast(`${delta > 0 ? 'Added' : 'Removed'} 1 · ${product.stock} left`, [
      { label: 'Note', run: async () => {
        const note = await textSheet('Add a note', { placeholder: delta > 0 ? 'e.g. PO 5521' : 'e.g. used on job #142', label: 'Save note' });
        if (note) { await DB.updateMovementNote(movement.id, note); toast('Note saved'); render(); }
      } },
      { label: 'Undo', run: async () => { await DB.deleteMovement(movement.id); toast('Undone'); render(); } },
    ]);
  }

  // ---------- photo ----------
  async function shrinkPhoto(file, max = 1280) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- chrome ----------
  function setChrome({ title, back, menu }) {
    $title.textContent = title;
    document.title = title === 'Inventory' ? 'Simple Inventory' : `${title} · Inventory`;
    $back.hidden = !back;
    $back.onclick = back ? () => goBack(back) : null;
    $menu.hidden = !menu;
    $menu.onclick = menu || null;
  }

  // ---------- views ----------
  async function viewHome() {
    setChrome({ title: 'Inventory' });
    const projects = await DB.listProjects();
    const frag = h(`<div>
      ${projects.length ? `<div class="list">${projects.map(p => `
        <a class="card row" href="#/p/${p.id}">
          <div class="proj-icon">${esc((p.name.trim()[0] || '?').toUpperCase())}</div>
          <div class="grow"><div class="t">${esc(p.name)}</div>
            <div class="s">${plural(p.items, 'product')} · ${plural(p.units, 'unit')} in stock</div></div>
          ${ICON.chev}
        </a>`).join('')}</div>`
      : `<div class="empty">${ICON.box}<b>No projects yet</b>Create a project to start tracking its inventory.</div>`}
      <p class="app-version">Simple Inventory · Version ${APP_VERSION} · Build ${APP_BUILD}</p>
      <button class="fab" id="newProj">${ICON.plus}New project</button>
    </div>`);
    frag.getElementById('newProj').onclick = async () => {
      const name = await textSheet('New project', { placeholder: 'Project name', label: 'Create' });
      if (name) { const p = await DB.saveProject({ name }); go(`#/p/${p.id}`); }
    };
    return frag;
  }

  let searchTerm = '';
  async function viewProject(id) {
    const project = await DB.getProject(id);
    if (!project) return notFound();
    setChrome({
      title: project.name, back: '#/',
      menu: () => menuSheet(project.name, [
        { label: 'Rename project', run: async () => {
          const name = await textSheet('Rename project', { value: project.name });
          if (name) { await DB.saveProject({ id, name }); render(); }
        } },
        { label: 'Delete project', danger: true, run: async () => {
          if (await confirmSheet('Delete project?', `"${project.name}" and all its products and history will be permanently deleted from this phone.`)) {
            await DB.deleteProject(id); goBack('#/');
          }
        } },
      ]),
    });
    const products = await DB.listProducts(id);
    const units = products.reduce((a, p) => a + p.stock, 0);

    const frag = h(`<div>
      ${products.length ? `
        <input class="search" type="search" placeholder="Search part # or description" value="${esc(searchTerm)}" autocomplete="off" enterkeyhint="search">
        <div class="summary">${plural(products.length, 'product')} · ${plural(units, 'unit')} in stock</div>
        <div class="list" id="plist"></div>`
      : `<div class="empty">${ICON.camera}<b>No products yet</b>Tap <i>Add product</i> to snap a photo and record a part.</div>`}
      <button class="fab" id="newProd">${ICON.plus}Add product</button>
    </div>`);

    const list = frag.getElementById('plist');
    const drawList = () => {
      if (!list) return;
      const q = searchTerm.trim().toLowerCase();
      const shown = q ? products.filter(p => `${p.partNumber} ${p.description}`.toLowerCase().includes(q)) : products;
      list.replaceChildren(h(shown.length ? shown.map(p => `
        <div class="card row" data-id="${p.id}">
          <a class="row" style="padding:0;flex:1;min-width:0" href="#/i/${p.id}">
            ${p.photo ? `<img class="thumb" alt="" src="${blobUrl(p.photo)}">` : `<div class="thumb">${ICON.box}</div>`}
            <div class="grow"><div class="t">${esc(p.partNumber || '—')}</div><div class="s">${esc(p.description)}</div></div>
          </a>
          <div class="qty">
            <button class="qbtn minus" data-d="-1" aria-label="Remove one" ${p.stock ? '' : 'disabled'}>−</button>
            <span class="n ${p.stock ? '' : 'zero'}">${p.stock}</span>
            <button class="qbtn plus" data-d="1" aria-label="Add one">+</button>
          </div>
        </div>`).join('') : `<div class="empty">No matches for “${esc(searchTerm)}”.</div>`));
    };
    drawList();

    list?.addEventListener('click', async (e) => {
      const b = e.target.closest('.qbtn');
      if (!b) return;
      const row = b.closest('[data-id]');
      const pid = row.dataset.id;
      await quickMove(pid, +b.dataset.d, (prod) => {
        const i = products.findIndex(x => x.id === pid);
        products[i] = { ...products[i], stock: prod.stock };
        row.querySelector('.n').textContent = prod.stock;
        row.querySelector('.n').classList.toggle('zero', !prod.stock);
        row.querySelector('.minus').disabled = !prod.stock;
        const u = products.reduce((a, p) => a + p.stock, 0);
        $view.querySelector('.summary').textContent = `${plural(products.length, 'product')} · ${plural(u, 'unit')} in stock`;
      });
    });
    const s = frag.querySelector('.search');
    if (s) s.oninput = () => { searchTerm = s.value; drawList(); };
    frag.getElementById('newProd').onclick = () => go(`#/p/${id}/new`);
    return frag;
  }

  async function viewProductForm(projectId, productId) {
    const existing = productId ? await DB.getProduct(productId) : null;
    if (productId && !existing) return notFound();
    projectId = projectId || existing.projectId;
    const project = await DB.getProject(projectId);
    if (!project) return notFound();
    setChrome({ title: existing ? 'Edit product' : 'New product', back: existing ? `#/i/${productId}` : `#/p/${projectId}` });

    let photo = existing?.photo;        // Blob | null | undefined
    const frag = h(`<form autocomplete="off">
      <label class="photo-pick" id="pick">
        <div>${ICON.camera}<div>Tap to take a photo</div></div>
        <input type="file" accept="image/*" capture="environment" aria-label="Take photo">
      </label>
      <div class="photo-actions" id="photoActions" hidden>
        <button type="button" class="link-btn" id="fromLib">Choose from library</button>
        <button type="button" class="link-btn" id="rmPhoto" style="color:var(--out)">Remove photo</button>
      </div>
      <input type="file" accept="image/*" id="libInput" hidden>
      <label class="field"><span>Model / part number</span>
        <input class="input" name="partNumber" value="${esc(existing?.partNumber)}" placeholder="e.g. 3M-2097" autocapitalize="characters" spellcheck="false" enterkeyhint="next">
      </label>
      <label class="field"><span>Description</span>
        <textarea class="input" name="description" placeholder="What is it? Size, color, where it's used…">${esc(existing?.description)}</textarea>
      </label>
      ${existing ? '' : `<label class="field"><span>Starting quantity</span>
        <div class="stepper">
          <button type="button" class="qbtn minus" data-s="-1">−</button>
          <input class="input" name="initialStock" type="number" inputmode="numeric" min="0" step="1" value="0">
          <button type="button" class="qbtn plus" data-s="1">+</button>
        </div></label>`}
      <div class="actions" style="margin-top:20px">
        <button type="button" class="btn" id="cancel">Cancel</button>
        <button class="btn primary">${existing ? 'Save' : 'Add product'}</button>
      </div>
    </form>`);

    const form = frag.querySelector('form');
    const pick = frag.getElementById('pick');
    const actions = frag.getElementById('photoActions');
    const rmBtn = frag.getElementById('rmPhoto');
    const showPhoto = () => {
      pick.querySelector('img')?.remove();
      if (photo) { const img = document.createElement('img'); img.alt = ''; img.src = blobUrl(photo); pick.prepend(img); }
      actions.hidden = false;
      rmBtn.hidden = !photo;
    };
    const onFile = async (input) => {
      const f = input.files?.[0];
      if (!f) return;
      try { photo = await shrinkPhoto(f); showPhoto(); } catch { toast('Could not read that photo'); }
      input.value = '';
    };
    pick.querySelector('input').onchange = (e) => onFile(e.target);
    const lib = frag.getElementById('libInput');
    lib.onchange = () => onFile(lib);
    frag.getElementById('fromLib').onclick = () => lib.click();
    rmBtn.onclick = () => { photo = null; showPhoto(); };
    showPhoto();

    frag.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const q = form.elements.initialStock;
      q.value = Math.max(0, (parseInt(q.value, 10) || 0) + (+b.dataset.s));
    });
    frag.getElementById('cancel').onclick = () => $back.click();

    form.onsubmit = async (e) => {
      e.preventDefault();
      const partNumber = form.elements.partNumber.value.trim();
      const description = form.elements.description.value.trim();
      if (!partNumber && !description) { toast('Add a part number or description'); form.elements.partNumber.focus(); return; }
      const rec = await DB.saveProduct({
        id: existing?.id, projectId, partNumber, description, photo: photo ?? null,
        initialStock: existing ? undefined : parseInt(form.elements.initialStock.value, 10) || 0,
      });
      toast(existing ? 'Saved' : 'Product added');
      goBack(existing ? `#/i/${rec.id}` : `#/p/${projectId}`);
    };
    return frag;
  }

  async function viewProduct(id) {
    const p = await DB.getProduct(id);
    if (!p) return notFound();
    const [project, moves] = await Promise.all([DB.getProject(p.projectId), DB.listMovements(id)]);
    setChrome({
      title: project?.name || 'Product', back: `#/p/${p.projectId}`,
      menu: () => menuSheet(productName(p), [
        { label: 'Edit product', run: () => go(`#/i/${id}/edit`) },
        { label: 'Correct stock count', run: async () => {
          const v = await textSheet('Actual count on hand', { value: String(p.stock), label: 'Set count' });
          if (v === null) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 0) { toast('Enter a whole number'); return; }
          if (n !== p.stock) { await DB.addMovement({ productId: id, delta: n - p.stock, kind: 'count', note: 'Stock count correction' }); }
          render();
        } },
        { label: 'Delete product', danger: true, run: async () => {
          if (await confirmSheet('Delete product?', `${productName(p)} and its history will be permanently deleted.`)) {
            await DB.deleteProduct(id); goBack(`#/p/${p.projectId}`);
          }
        } },
      ]),
    });

    // running balance after each entry, newest first
    let bal = p.stock;
    const rows = moves.map(m => { const after = bal; bal -= m.delta; return { m, after }; });

    const frag = h(`<div>
      ${p.photo ? `<img class="hero" alt="" src="${blobUrl(p.photo)}">` : `<div class="hero">${ICON.camera}</div>`}
      <div class="pn">${esc(p.partNumber || '—')}</div>
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      <div class="card stockbox">
        <div style="flex:1"><div class="lbl">In stock</div><div class="big">${p.stock}</div></div>
        <div class="qty">
          <button class="qbtn minus" data-d="-1" aria-label="Remove one" ${p.stock ? '' : 'disabled'}>−</button>
          <button class="qbtn plus" data-d="1" aria-label="Add one">+</button>
        </div>
      </div>
      <div class="actions">
        <button class="btn out" id="rm" ${p.stock ? '' : 'disabled'}>− Remove…</button>
        <button class="btn in" id="add">+ Add…</button>
      </div>
      <h2 class="section">History</h2>
      ${rows.length ? `<ul class="card hist">${rows.map(({ m, after }) => `
        <li data-id="${m.id}">
          <div class="d ${m.delta > 0 ? 'in' : 'out'}">${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta)}</div>
          <div class="grow" style="flex:1;min-width:0">
            <div class="when">${fmtWhen(m.at)}${m.kind === 'count' ? ' · count' : ''}</div>
            ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
          </div>
          <div class="bal">→ ${after}</div>
        </li>`).join('')}</ul>`
      : `<div class="card empty" style="padding:24px">No stock changes yet.</div>`}
    </div>`);

    frag.querySelectorAll('.stockbox .qbtn').forEach(b => b.onclick = () => quickMove(id, +b.dataset.d, () => render()));
    const doMove = async (dir) => {
      const r = await movementSheet(p, dir);
      if (!r) return;
      await DB.addMovement({ productId: id, ...r });
      toast(`${r.delta > 0 ? 'Added' : 'Removed'} ${Math.abs(r.delta)}`);
      render();
    };
    frag.getElementById('rm').onclick = () => doMove('out');
    frag.getElementById('add').onclick = () => doMove('in');
    frag.querySelectorAll('.hist li').forEach(li => li.onclick = () => {
      const m = moves.find(x => x.id === li.dataset.id);
      menuSheet(`${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta)} · ${fmtWhen(m.at)}`, [
        { label: m.note ? 'Edit note' : 'Add note', run: async () => {
          const note = await textSheet(m.note ? 'Edit note' : 'Add note', { value: m.note, label: 'Save note' });
          if (note !== null) { await DB.updateMovementNote(m.id, note); render(); }
        } },
        { label: 'Delete entry (reverses stock)', danger: true, run: async () => {
          if (await confirmSheet('Delete this entry?', `Stock will change by ${m.delta > 0 ? '−' : '+'}${Math.abs(m.delta)} to undo it.`)) {
            await DB.deleteMovement(m.id); render();
          }
        } },
      ]);
    });
    return frag;
  }

  function notFound() {
    setChrome({ title: 'Not found', back: '#/' });
    return h(`<div class="empty"><b>Nothing here</b>This item may have been deleted.</div>`);
  }

  // ---------- router ----------
  /** Return to the parent screen: pop history when we came from it, else replace. */
  function goBack(hash) {
    if (history.length > 1 && ss.get('nav')) history.back();
    else go(hash, true);
  }

  function go(hash, replace = false) {
    ss.set('nav', '1');
    if (replace) { history.replaceState(null, '', hash); render(); } else location.hash = hash;
  }

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
    let node;
    try {
      if (parts[0] === 'p' && parts[2] === 'new') node = await viewProductForm(parts[1]);
      else if (parts[0] === 'p' && parts[1]) node = await viewProject(parts[1]);
      else if (parts[0] === 'i' && parts[2] === 'edit') node = await viewProductForm(null, parts[1]);
      else if (parts[0] === 'i' && parts[1]) node = await viewProduct(parts[1]);
      else node = await viewHome();
    } catch (err) {
      console.error(err);
      node = h(`<div class="empty"><b>Something went wrong</b>${esc(err.message || err)}</div>`);
    }
    if (seq !== renderSeq) return;
    const keepScroll = render.lastHash === location.hash;
    const y = window.scrollY;
    $view.replaceChildren(node);
    render.lastHash = location.hash;
    window.scrollTo(0, keepScroll ? y : 0);
    // free photo URLs no longer on screen
    const live = new Set([...$view.querySelectorAll('img[src^="blob:"]')].map(i => i.getAttribute('src')));
    urls = urls.filter(u => live.has(u) || (URL.revokeObjectURL(u), false));
  }

  window.addEventListener('hashchange', () => { ss.set('nav', '1'); $sheetRoot.replaceChildren(); render(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });

  // ---------- boot ----------
  DB.open().then(render).catch(err => {
    $view.replaceChildren(h(`<div class="empty"><b>Storage unavailable</b>${esc(err.message || err)}<br>Private browsing can block on-device storage.</div>`));
  });
  DB.persist();

  let canSW = false;
  try { canSW = 'serviceWorker' in navigator && window.isSecureContext && window.top === window; } catch {}
  if (canSW) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('App updated', [{ label: 'Reload', run: () => location.reload() }]);
          }
        });
      });
    }).catch(() => {});
  }
})();
