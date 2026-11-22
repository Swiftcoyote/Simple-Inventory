/* Simple Inventory — UI. Vanilla JS, hash routing, no build step. */
(() => {
  // Version and build come from the newest entry in changelog.js. For a release,
  // add an entry there and bump VERSION in sw.js to match so phones update.
  const RELEASES = window.CHANGELOG || [];
  const APP_VERSION = RELEASES[0]?.version || '?';
  const APP_BUILD = RELEASES[0]?.build || 0;
  const COMMITS_URL = 'https://github.com/Swiftcoyote/Simple-Inventory/commits/main';

  const $view = document.getElementById('view');
  const $title = document.getElementById('title');
  const $back = document.getElementById('backBtn');
  const $menu = document.getElementById('menuBtn');
  const $settings = document.getElementById('settingsBtn');
  const $sheetRoot = document.getElementById('sheetRoot');
  const $toast = document.getElementById('toast');

  // ---------- helpers ----------
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
  };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };

  let urls = [];
  const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  /** "Today, 9:41 PM" · "Yesterday" · "Fri, Nov 20, 3:05 PM". dateOnly leaves the time off. */
  const fmtWhen = (iso, dateOnly = false) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    const time = dateOnly ? '' : `, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    if (d.toDateString() === today.toDateString()) return `Today${time}`;
    if (d.toDateString() === y.toDateString()) return `Yesterday${time}`;
    const sameYear = d.getFullYear() === today.getFullYear();
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }) + time;
  };
  /** Local calendar date as YYYY-MM-DD (what <input type="date"> uses). */
  const toDateInput = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  /** A picked YYYY-MM-DD at the clock time of `timeFrom` (keeps entries on that day in order). */
  const dateAt = (ymd, timeFrom = new Date()) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = new Date(timeFrom);
    return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()).toISOString();
  };
  const signed = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
  const moveLabel = (m) => m.kind === 'count' ? 'Count correction' : m.kind === 'move' ? 'Moved' : m.delta > 0 ? 'Added' : 'Removed';
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

  // ---------- locations & owners ----------
  const NOT_SET = 'Not set';
  const placeLabel = (l, o) => `${l || NOT_SET} · ${o || NOT_SET}`;
  const nameHtml = (n) => n ? esc(n) : `<span class="unset">${NOT_SET}</span>`;
  const placeHtml = (l, o) => `${nameHtml(l)} · ${nameHtml(o)}`;
  const lastPlace = {
    get: (pid) => { try { return JSON.parse(ls.get(`lastPlace:${pid}`)) || {}; } catch { return {}; } },
    set: (pid, v) => ls.set(`lastPlace:${pid}`, JSON.stringify(v)),
  };

  /** A dropdown of a project's locations or owners, with "+ New …" that opens a text box.
   *  value: the name to preselect; '' preselects "Not set" (old entries); null = none. */
  function pickHtml(name, label, names, value, word) {
    const list = [...names];
    if (value && !list.includes(value)) list.unshift(value);
    const sel = value == null ? (list.length ? '__none' : '__new') : value === '' ? '__notset' : value;
    return `<div class="field pick"><label><span>${label}</span>
      <select class="input" name="${name}" data-pick>
        ${list.length ? `<option value="__none" disabled ${sel === '__none' ? 'selected' : ''}>Choose ${word}…</option>` : ''}
        ${value === '' ? `<option value="__notset" selected>${NOT_SET}</option>` : ''}
        ${list.map(n => `<option value="${esc(n)}" ${sel === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        <option value="__new" ${sel === '__new' ? 'selected' : ''}>+ New ${word}…</option>
      </select></label>
      <input class="input new-name" name="${name}New" placeholder="New ${word} name" autocomplete="off" enterkeyhint="done" ${sel === '__new' ? '' : 'hidden'}>
    </div>`;
  }
  function wirePicks(el, onChange) {
    el.querySelectorAll('select[data-pick]').forEach(s => {
      const inp = s.form.elements[`${s.name}New`];
      s.addEventListener('change', () => {
        inp.hidden = s.value !== '__new';
        if (!inp.hidden) setTimeout(() => inp.focus(), 30);
        onChange?.();
      });
      inp.addEventListener('input', () => onChange?.());
    });
  }
  /** The chosen name ('' = Not set), or null when nothing is chosen yet. */
  function readPick(f, name) {
    const v = f.elements[name].value;
    if (v === '__none') return null;
    if (v === '__notset') return '';
    if (v === '__new') return f.elements[`${name}New`].value.trim() || null;
    return v;
  }
  /** Dropdown of the places that hold stock: "Bin A · Us (10)". */
  function fromHtml(buckets, chosen) {
    const sel = chosen != null ? chosen : buckets.length === 1 ? 0 : -1;
    return `<label class="field"><span>Take from</span>
      <select class="input" name="from">
        ${sel < 0 ? `<option value="" disabled selected>Choose where from…</option>` : ''}
        ${buckets.map((b, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(placeLabel(b.location, b.owner))} (${b.qty})</option>`).join('')}
      </select></label>`;
  }
  const qtyAt = (buckets, l, o) => buckets.find(b => b.location === (l || '') && b.owner === (o || ''))?.qty || 0;

  /** Stock per place for a product, leaving out one entry (the one being edited). */
  const bucketsWithout = (moves, entry) => DB.bucketsOf(entry ? moves.filter(m => m.id !== entry.id) : moves);

  const dateHtml = (v, today) => `<label class="field"><span>Date</span>
    <input class="input" name="date" type="date" value="${v}" max="${today}" required></label>`;
  const qtyHtml = (label, v, min = 1) => `<label class="field"><span>${label}</span>
    <div class="stepper">
      <button type="button" class="qbtn minus" data-s="-1" aria-label="One less">−</button>
      <input class="input" name="qty" type="number" inputmode="numeric" min="${min}" step="1" value="${v}" required>
      <button type="button" class="qbtn plus" data-s="1" aria-label="One more">+</button>
    </div></label>`;
  const noteHtml = (v, ph) => `<label class="field"><span>Note (optional)</span>
    <input class="input" name="note" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="done"></label>
    <div class="chips" hidden></div>`;

  /** Recent-note chips, the quantity stepper and the date rules shared by every stock form. */
  function wireCommon(el, f, notes, onQty, min = 1) {
    const q = f.elements.qty, noteEl = f.elements.note;
    const chips = el.querySelector('.chips');
    if (noteEl && chips) {
      const drawChips = () => {
        const t = noteEl.value.trim().toLowerCase();
        const list = notes.filter(n => n.toLowerCase() !== t && (!t || n.toLowerCase().includes(t))).slice(0, 5);
        chips.hidden = !list.length;
        chips.innerHTML = list.length ? `<span class="chips-lbl">Recent notes</span>` +
          list.map(n => `<button type="button" class="chip">${esc(n)}</button>`).join('') : '';
      };
      chips.onclick = (e) => { const c = e.target.closest('.chip'); if (c) { noteEl.value = c.textContent; drawChips(); } };
      noteEl.oninput = drawChips;
      drawChips();
    }
    const qty = () => { const n = parseInt(q.value, 10); return isNaN(n) ? 0 : n; };
    q.oninput = onQty;
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { q.value = Math.max(min, qty() + (+b.dataset.s)); onQty(); });
    return qty;
  }
  /** { at, dateOnly } from the date box, or null (with a toast) if it's not valid. */
  function readDate(f, today, entry, startDate) {
    const date = f.elements.date.value;
    if (!date) { toast('Pick a date'); return null; }
    if (date > today) { toast("The date can't be in the future"); return null; }
    if (entry && date === startDate) return { at: entry.at, dateOnly: !!entry.dateOnly };
    if (!entry && date === today) return { at: new Date().toISOString(), dateOnly: false };
    return { at: dateAt(date, entry ? new Date(entry.at) : new Date()), dateOnly: true };
  }

  /** Add stock, remove stock, or edit an existing entry: date, place, quantity, optional note.
   *  dir is 'in' or 'out'. Pass `entry` to edit it. Resolves with
   *  { delta, at, dateOnly, note, location, owner } or null if cancelled. */
  async function movementSheet(product, dir, entry = null) {
    const isOut = dir === 'out';
    const isCount = entry?.kind === 'count';
    const [notes, project, moves] = await Promise.all([
      DB.recentNotes(product.projectId).catch(() => []), DB.getProject(product.projectId), DB.listMovements(product.id),
    ]);
    const today = toDateInput();
    const base = bucketsWithout(moves, entry);        // stock per place without this entry
    const baseTotal = entry ? product.stock - entry.delta : product.stock;
    const startQty = entry ? Math.abs(entry.delta) : 1;
    const startDate = entry ? toDateInput(new Date(entry.at)) : today;
    const verb = entry ? 'Save' : isOut ? 'Remove' : 'Add';
    const title = entry ? `Edit ${isCount ? 'count correction' : isOut ? 'removal' : 'addition'}` : isOut ? 'Remove stock' : 'Add stock';
    // Remove: pick one of the places that hold stock. Add: pick location and owner.
    const sources = isOut ? base.filter(b => b.qty > 0 || (entry && b.location === (entry.location || '') && b.owner === (entry.owner || ''))) : [];
    if (isOut && entry && !sources.some(b => b.location === (entry.location || '') && b.owner === (entry.owner || ''))) {
      sources.push({ location: entry.location || '', owner: entry.owner || '', qty: 0 });
    }
    const last = lastPlace.get(product.projectId);
    const startLoc = entry ? (entry.location || '') : (project.locations || []).includes(last.location) ? last.location : null;
    const startOwner = entry ? (entry.owner || '') : (project.owners || []).includes(last.owner) ? last.owner : null;
    const startFrom = entry && isOut ? sources.findIndex(b => b.location === (entry.location || '') && b.owner === (entry.owner || '')) : null;
    return new Promise((resolve) => {
      sheet(`<h3>${title}</h3>
        <p class="desc" style="margin-top:-8px">${esc(productName(product))}</p>
        <form class="move-form">
          ${dateHtml(startDate, today)}
          ${isOut ? fromHtml(sources, startFrom)
            : pickHtml('loc', 'Location', project.locations || [], startLoc, 'location') + pickHtml('own', 'Owner', project.owners || [], startOwner, 'owner')}
          ${qtyHtml(`Quantity ${isOut ? 'removed' : 'added'}`, startQty)}
          <div class="preview" aria-live="polite"></div>
          ${noteHtml(entry?.note, isOut ? 'e.g. 10 for sections 15A' : 'e.g. delivery from supplier, PO 5521')}
          <div class="actions">
            <button type="button" class="btn" data-a="no">Cancel</button>
            <button class="btn ${entry ? 'primary' : isOut ? 'out' : 'in'}">${verb}</button>
          </div>
        </form>`,
        (el, close) => {
          const f = el.querySelector('form');
          const preview = el.querySelector('.preview');
          const place = () => {
            if (isOut) { const b = sources[parseInt(f.elements.from.value, 10)]; return b ? { location: b.location, owner: b.owner } : null; }
            const l = readPick(f, 'loc'), o = readPick(f, 'own');
            return { location: l, owner: o };
          };
          const draw = () => {
            const n = qty(), pl = place();
            const totalAfter = baseTotal + (isOut ? -n : n);
            let html = '';
            if (pl && pl.location != null && pl.owner != null) {
              const here = qtyAt(base, pl.location, pl.owner);
              const hereAfter = here + (isOut ? -n : n);
              html += `${esc(placeLabel(pl.location, pl.owner))}: <b>${here}</b> → <b class="${hereAfter < 0 ? 'bad' : ''}">${hereAfter}</b><br>`;
            }
            html += `Total ${entry ? 'now' : 'in stock'} <b>${product.stock}</b> → <b class="${totalAfter < 0 ? 'bad' : ''}">${totalAfter}</b> after`;
            preview.innerHTML = html;
          };
          const qty = wireCommon(el, f, notes, draw);
          wirePicks(el, draw);
          if (f.elements.from) f.elements.from.onchange = draw;
          draw();
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => {
            e.preventDefault();
            const pl = place();
            if (isOut && !pl) { toast('Choose where it comes from'); return; }
            if (!isOut && pl.location == null) { toast('Choose or type a location'); return; }
            if (!isOut && pl.owner == null) { toast('Choose or type an owner'); return; }
            const n = qty();
            if (n < 1) { toast('Enter a quantity of 1 or more'); f.elements.qty.focus(); return; }
            if (isOut) {
              const here = qtyAt(base, pl.location, pl.owner);
              if (n > here) { toast(`Only ${here} at ${placeLabel(pl.location, pl.owner)}`); f.elements.qty.value = Math.max(1, here); draw(); return; }
            }
            const d = readDate(f, today, entry, startDate);
            if (!d) return;
            if (!isOut) lastPlace.set(product.projectId, pl);
            close();
            resolve({ delta: isOut ? -n : n, ...d, note: f.elements.note.value, ...pl });
          };
        });
    });
  }

  /** Move stock from one place to another (or edit a move). Total stock is unchanged. */
  async function moveSheet(product, entry = null) {
    const [notes, project, moves] = await Promise.all([
      DB.recentNotes(product.projectId).catch(() => []), DB.getProject(product.projectId), DB.listMovements(product.id),
    ]);
    const today = toDateInput();
    const base = bucketsWithout(moves, entry);
    const same = (b, l, o) => b.location === (l || '') && b.owner === (o || '');
    const sources = base.filter(b => b.qty > 0 || (entry && same(b, entry.location, entry.owner)));
    if (entry && !sources.some(b => same(b, entry.location, entry.owner))) sources.push({ location: entry.location || '', owner: entry.owner || '', qty: 0 });
    const startFrom = entry ? sources.findIndex(b => same(b, entry.location, entry.owner)) : null;
    const startDate = entry ? toDateInput(new Date(entry.at)) : today;
    return new Promise((resolve) => {
      sheet(`<h3>${entry ? 'Edit move' : 'Move stock'}</h3>
        <p class="desc" style="margin-top:-8px">${esc(productName(product))}</p>
        <form class="move-form">
          ${dateHtml(startDate, today)}
          ${fromHtml(sources, startFrom)}
          <div class="to-group">
            <div class="to-lbl">Move to</div>
            ${pickHtml('loc', 'Location', project.locations || [], entry ? (entry.toLocation || '') : null, 'location')}
            ${pickHtml('own', 'Owner', project.owners || [], entry ? (entry.toOwner || '') : null, 'owner')}
          </div>
          ${qtyHtml('Quantity moved', entry ? entry.qty : 1)}
          <div class="preview" aria-live="polite"></div>
          ${noteHtml(entry?.note, 'e.g. loaded on truck for site')}
          <div class="actions">
            <button type="button" class="btn" data-a="no">Cancel</button>
            <button class="btn primary">${entry ? 'Save' : 'Move'}</button>
          </div>
        </form>`,
        (el, close) => {
          const f = el.querySelector('form');
          const preview = el.querySelector('.preview');
          const from = () => sources[parseInt(f.elements.from.value, 10)] || null;
          // Owner usually stays the same when stock moves: follow the "from" owner until picked.
          let ownerTouched = !!entry;
          f.elements.own.addEventListener('change', () => { ownerTouched = true; });
          const draw = () => {
            const n = qty(), fr = from(), l = readPick(f, 'loc'), o = readPick(f, 'own');
            const lines = [];
            if (fr) lines.push(`${esc(placeLabel(fr.location, fr.owner))}: <b>${fr.qty}</b> → <b class="${fr.qty - n < 0 ? 'bad' : ''}">${fr.qty - n}</b>`);
            if (l != null && o != null) { const t = qtyAt(base, l, o); lines.push(`${esc(placeLabel(l, o))}: <b>${t}</b> → <b>${t + n}</b>`); }
            lines.push(`Total stays <b>${product.stock}</b>`);
            preview.innerHTML = lines.join('<br>');
          };
          f.elements.from.onchange = () => {
            const fr = from();
            const sel = f.elements.own;
            if (fr && !ownerTouched && fr.owner && [...sel.options].some(op => op.value === fr.owner)) {
              sel.value = fr.owner; f.elements.ownNew.hidden = true;
            }
            draw();
          };
          const qty = wireCommon(el, f, notes, draw);
          wirePicks(el, draw);
          if (startFrom == null && sources.length === 1) f.elements.from.onchange();
          draw();
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => {
            e.preventDefault();
            const fr = from(), l = readPick(f, 'loc'), o = readPick(f, 'own'), n = qty();
            if (!fr) { toast('Choose where it comes from'); return; }
            if (l == null) { toast('Choose or type where it goes'); return; }
            if (o == null) { toast('Choose or type an owner'); return; }
            if (fr.location === l && fr.owner === o) { toast('Pick a different location or owner to move to'); return; }
            if (n < 1) { toast('Enter a quantity of 1 or more'); return; }
            if (n > fr.qty) { toast(`Only ${fr.qty} at ${placeLabel(fr.location, fr.owner)}`); f.elements.qty.value = Math.max(1, fr.qty); draw(); return; }
            const d = readDate(f, today, entry, startDate);
            if (!d) return;
            close();
            resolve({ kind: 'move', qty: n, ...d, note: f.elements.note.value, location: fr.location, owner: fr.owner, toLocation: l, toOwner: o });
          };
        });
    });
  }

  /** Correct the count at one place. */
  async function countSheet(product) {
    const [project, moves] = await Promise.all([DB.getProject(product.projectId), DB.listMovements(product.id)]);
    const buckets = DB.bucketsOf(moves);
    const held = buckets.filter(b => b.qty > 0);
    const one = held.length === 1 ? held[0] : null;
    const hasUnsetLoc = buckets.some(b => !b.location && b.qty), hasUnsetOwn = buckets.some(b => !b.owner && b.qty);
    return new Promise((resolve) => {
      sheet(`<h3>Correct stock count</h3>
        <p class="desc" style="margin-top:-8px">${esc(productName(product))}. Enter what is actually there for one location and owner.</p>
        <form class="move-form">
          ${pickHtml('loc', 'Location', project.locations || [], one ? one.location : hasUnsetLoc && !(project.locations || []).length ? '' : null, 'location')}
          ${pickHtml('own', 'Owner', project.owners || [], one ? one.owner : hasUnsetOwn && !(project.owners || []).length ? '' : null, 'owner')}
          ${qtyHtml('Actual count here', one ? one.qty : 0, 0)}
          <div class="preview" aria-live="polite"></div>
          <div class="actions">
            <button type="button" class="btn" data-a="no">Cancel</button>
            <button class="btn primary">Set count</button>
          </div>
        </form>`,
        (el, close) => {
          const f = el.querySelector('form');
          // "Not set" stays choosable while old stock sits there.
          for (const [name, has] of [['loc', hasUnsetLoc], ['own', hasUnsetOwn]]) {
            const s = f.elements[name];
            if (has && ![...s.options].some(o => o.value === '__notset')) s.add(new Option(NOT_SET, '__notset'), 1);
          }
          const preview = el.querySelector('.preview');
          const draw = () => {
            const l = readPick(f, 'loc'), o = readPick(f, 'own');
            if (l == null || o == null) { preview.textContent = ''; return; }
            const here = qtyAt(buckets, l, o), n = qty();
            preview.innerHTML = `Recorded at ${esc(placeLabel(l, o))}: <b>${here}</b> → <b>${n}</b><br>Total <b>${product.stock}</b> → <b>${product.stock - here + n}</b>`;
          };
          const qty = wireCommon(el, f, [], draw, 0);
          wirePicks(el, draw);
          draw();
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => {
            e.preventDefault();
            const l = readPick(f, 'loc'), o = readPick(f, 'own'), n = qty();
            if (l == null) { toast('Choose or type a location'); return; }
            if (o == null) { toast('Choose or type an owner'); return; }
            if (n < 0) { toast('Enter 0 or more'); return; }
            close();
            resolve({ location: l, owner: o, count: n });
          };
        });
    });
  }

  const entryPlaceHtml = (m) => m.kind === 'move'
    ? `${placeHtml(m.location, m.owner)} → ${placeHtml(m.toLocation, m.toOwner)}`
    : placeHtml(m.location, m.owner);

  /** Details of one History entry, with Edit and Delete. */
  function entrySheet(product, m, before, after) {
    const edits = m.edits || [];
    const isMove = m.kind === 'move';
    sheet(`<h3>${moveLabel(m)} ${isMove ? m.qty : Math.abs(m.delta)}</h3>
      <dl class="entry">
        <dt>Date</dt><dd>${esc(fmtWhen(m.at, m.dateOnly))}</dd>
        ${isMove ? `<dt>From</dt><dd>${placeHtml(m.location, m.owner)}</dd><dt>To</dt><dd>${placeHtml(m.toLocation, m.toOwner)}</dd>`
          : `<dt>Location</dt><dd>${nameHtml(m.location)}</dd><dt>Owner</dt><dd>${nameHtml(m.owner)}</dd>`}
        <dt>Total</dt><dd>${before} → ${after}</dd>
        <dt>Note</dt><dd>${m.note ? esc(m.note) : '<span class="muted">None</span>'}</dd>
      </dl>
      ${edits.length ? `<h2 class="section">Edited ${plural(edits.length, 'time')}</h2>
        <ul class="edits">${edits.slice().reverse().map((e, i, arr) => {
          const next = i === 0 ? m : arr[i - 1];
          const diffs = [];
          if (isMove ? e.qty !== next.qty : e.delta !== next.delta) diffs.push(isMove ? `quantity ${e.qty} → ${next.qty}` : `quantity ${signed(e.delta)} → ${signed(next.delta)}`);
          if (e.at !== next.at) diffs.push(`date ${esc(fmtWhen(e.at, e.dateOnly))} → ${esc(fmtWhen(next.at, next.dateOnly))}`);
          if ((e.location || '') !== (next.location || '')) diffs.push(`${isMove ? 'from ' : ''}location ${esc(e.location || NOT_SET)} → ${esc(next.location || NOT_SET)}`);
          if ((e.owner || '') !== (next.owner || '')) diffs.push(`${isMove ? 'from ' : ''}owner ${esc(e.owner || NOT_SET)} → ${esc(next.owner || NOT_SET)}`);
          if (isMove && (e.toLocation || '') !== (next.toLocation || '')) diffs.push(`to location ${esc(e.toLocation || NOT_SET)} → ${esc(next.toLocation || NOT_SET)}`);
          if (isMove && (e.toOwner || '') !== (next.toOwner || '')) diffs.push(`to owner ${esc(e.toOwner || NOT_SET)} → ${esc(next.toOwner || NOT_SET)}`);
          if ((e.note || '') !== (next.note || '')) diffs.push(`note “${esc(e.note || '')}” → “${esc(next.note || '')}”`);
          return `<li><span class="muted">${esc(fmtWhen(e.editedAt))}:</span> ${diffs.join('; ') || 'no change'}</li>`;
        }).join('')}</ul>` : ''}
      <div class="actions">
        <button class="btn danger" data-a="del">Delete</button>
        <button class="btn primary" data-a="edit">Edit</button>
      </div>
      <button class="btn ghost wide" data-close>Close</button>`,
      (el, close) => {
        el.querySelector('[data-close]').onclick = close;
        el.querySelector('[data-a=edit]').onclick = async () => {
          close();
          const r = isMove ? await moveSheet(product, m) : await movementSheet(product, m.delta > 0 ? 'in' : 'out', m);
          if (!r) return;
          try {
            const { changed } = await DB.updateMovement(m.id, r);
            toast(changed ? 'Entry updated' : 'No changes');
          } catch (err) { toast(err.code === 'NEGATIVE' ? `Can't save: ${err.message}` : 'Could not save'); }
          render();
        };
        el.querySelector('[data-a=del]').onclick = async () => {
          close();
          const body = isMove ? `The ${m.qty} moved go back to ${placeLabel(m.location, m.owner)}, and the entry is removed from History.`
            : `Stock at ${placeLabel(m.location, m.owner)} will change by ${signed(-m.delta)} to undo it, and the entry is removed from History.`;
          if (await confirmSheet('Delete this entry?', body)) {
            try { await DB.deleteMovement(m.id); toast('Entry deleted'); }
            catch (err) { toast(err.code === 'NEGATIVE' ? `Can't delete: ${err.message}. Fix the later entry first.` : 'Could not delete'); }
            render();
          }
        };
      });
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
  function setChrome({ title, back, menu, settings }) {
    $title.textContent = title;
    document.title = title === 'Inventory' ? 'Simple Inventory' : `${title} · Inventory`;
    $back.hidden = !back;
    $back.onclick = back ? () => goBack(back) : null;
    $menu.hidden = !menu;
    $menu.onclick = menu || null;
    $settings.hidden = !settings;
    $settings.onclick = settings ? () => go('#/settings') : null;
  }

  // ---------- views ----------
  async function viewHome() {
    setChrome({ title: 'Inventory', settings: true });
    const projects = await DB.listProjects();
    const frag = h(`<div>
      ${projects.length ? `<div class="list">${projects.map(p => `
        <a class="card row" href="#/p/${p.id}">
          <div class="proj-icon">${esc((p.name.trim()[0] || '?').toUpperCase())}</div>
          <div class="grow"><div class="t">${esc(p.name)}</div>
            <div class="s">${plural(p.items, 'product')} · ${plural(p.units, 'unit')} in stock${p.low ? ` · <b class="low-txt">${p.low} low</b>` : ''}</div></div>
          ${ICON.chev}
        </a>`).join('')}</div>`
      : `<div class="empty">${ICON.box}<b>No projects yet</b>Create a project to start tracking its inventory.</div>`}
      <a class="app-version" href="#/settings/new">Simple Inventory · Version ${APP_VERSION} · Build ${APP_BUILD}<br><span>What's New</span></a>
      <button class="fab" id="newProj">${ICON.plus}New project</button>
    </div>`);
    frag.getElementById('newProj').onclick = async () => {
      const name = await textSheet('New project', { placeholder: 'Project name', label: 'Create' });
      if (name) { const p = await DB.saveProject({ name }); go(`#/p/${p.id}`); }
    };
    return frag;
  }

  let searchTerm = '', lowOnly = false;
  async function viewProject(id) {
    const project = await DB.getProject(id);
    if (!project) return notFound();
    setChrome({
      title: project.name, back: '#/',
      menu: () => menuSheet(project.name, [
        { label: 'Locations and owners', run: () => go(`#/p/${id}/places`) },
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
    const lowCount = products.filter(DB.isLow).length;
    if (!lowCount) lowOnly = false;

    const frag = h(`<div>
      ${products.length ? `
        <input class="search" type="search" placeholder="Search part # or description" value="${esc(searchTerm)}" autocomplete="off" enterkeyhint="search">
        <div class="summary-row">
          <div class="summary">${plural(products.length, 'product')} · ${plural(units, 'unit')} in stock</div>
          ${lowCount ? `<button class="filter ${lowOnly ? 'on' : ''}" id="lowOnly" aria-pressed="${lowOnly}">Low stock only (${lowCount})</button>` : ''}
        </div>
        <div class="list" id="plist"></div>`
      : `<div class="empty">${ICON.camera}<b>No products yet</b>Tap <i>Add product</i> to snap a photo and record a part.</div>`}
      <button class="fab" id="newProd">${ICON.plus}Add product</button>
    </div>`);

    const list = frag.getElementById('plist');
    const drawList = () => {
      if (!list) return;
      const q = searchTerm.trim().toLowerCase();
      let shown = q ? products.filter(p => `${p.partNumber} ${p.description}`.toLowerCase().includes(q)) : products;
      if (lowOnly) shown = shown.filter(DB.isLow);
      list.replaceChildren(h(shown.length ? shown.map(p => `
        <a class="card row" href="#/i/${p.id}">
          ${p.photo ? `<img class="thumb" alt="" src="${blobUrl(p.photo)}">` : `<div class="thumb">${ICON.box}</div>`}
          <div class="grow"><div class="t">${esc(p.partNumber || '—')}${DB.isLow(p) ? ' <span class="tag low">Low</span>' : ''}</div><div class="s">${esc(p.description)}</div></div>
          <div class="count ${p.stock ? '' : 'zero'} ${DB.isLow(p) ? 'low' : ''}"><span class="n">${p.stock}</span><span class="l">in stock</span></div>
        </a>`).join('') : `<div class="empty">${q ? `No matches for “${esc(searchTerm)}”${lowOnly ? ' in low stock' : ''}.` : 'No low-stock products.'}</div>`));
    };
    drawList();

    const s = frag.querySelector('.search');
    if (s) s.oninput = () => { searchTerm = s.value; drawList(); };
    const lo = frag.getElementById('lowOnly');
    if (lo) lo.onclick = () => { lowOnly = !lowOnly; lo.classList.toggle('on', lowOnly); lo.setAttribute('aria-pressed', lowOnly); drawList(); };
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
    const last = lastPlace.get(projectId);
    const startLoc = (project.locations || []).includes(last.location) ? last.location : null;
    const startOwner = (project.owners || []).includes(last.owner) ? last.owner : null;
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
        </div></label>
        <div id="startPlace" hidden>
          ${pickHtml('loc', 'Location', project.locations || [], startLoc, 'location')}
          ${pickHtml('own', 'Owner', project.owners || [], startOwner, 'owner')}
        </div>`}
      <label class="field"><span>Low-stock warning (optional)</span>
        <input class="input" name="lowStockAt" type="number" inputmode="numeric" min="0" step="1" value="${existing?.lowStockAt ?? ''}" placeholder="Off">
        <small class="hint">Flag this product when the total in stock is at or below this number. Leave empty for no warning.</small>
      </label>
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

    // Starting stock needs a location and owner; those fields show once the quantity is above 0.
    const startPlace = frag.getElementById('startPlace');
    const syncStart = () => { if (startPlace) startPlace.hidden = !((parseInt(form.elements.initialStock.value, 10) || 0) > 0); };
    frag.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const q = form.elements.initialStock;
      q.value = Math.max(0, (parseInt(q.value, 10) || 0) + (+b.dataset.s));
      syncStart();
    });
    if (startPlace) { form.elements.initialStock.oninput = syncStart; wirePicks(startPlace); }
    frag.getElementById('cancel').onclick = () => $back.click();

    form.onsubmit = async (e) => {
      e.preventDefault();
      const partNumber = form.elements.partNumber.value.trim();
      const description = form.elements.description.value.trim();
      if (!partNumber && !description) { toast('Add a part number or description'); form.elements.partNumber.focus(); return; }
      const lowRaw = form.elements.lowStockAt.value.trim();
      const lowStockAt = lowRaw === '' ? null : parseInt(lowRaw, 10);
      if (lowRaw !== '' && (isNaN(lowStockAt) || lowStockAt < 0)) { toast('Low-stock warning must be 0 or more'); return; }
      const initialStock = existing ? undefined : Math.max(0, parseInt(form.elements.initialStock.value, 10) || 0);
      let location, owner;
      if (initialStock > 0) {
        location = readPick(form, 'loc'); owner = readPick(form, 'own');
        if (location == null) { toast('Choose or type a location for the starting stock'); return; }
        if (owner == null) { toast('Choose or type an owner for the starting stock'); return; }
        lastPlace.set(projectId, { location, owner });
      }
      const rec = await DB.saveProduct({
        id: existing?.id, projectId, partNumber, description, photo: photo ?? null,
        initialStock, location, owner, lowStockAt,
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
          const r = await countSheet(p);
          if (!r) return;
          try {
            const { movement } = await DB.setCount({ productId: id, ...r });
            toast(movement ? `Count set: ${r.count} at ${placeLabel(r.location, r.owner)}` : 'Count already matches');
          } catch { toast('Could not save'); }
          render();
        } },
        { label: 'Delete product', danger: true, run: async () => {
          if (await confirmSheet('Delete product?', `${productName(p)} and its history will be permanently deleted.`)) {
            await DB.deleteProduct(id); goBack(`#/p/${p.projectId}`);
          }
        } },
      ]),
    });

    // stock before and after each entry, newest first
    let bal = p.stock;
    const rows = moves.map(m => { const after = bal; bal -= m.delta; return { m, before: bal, after }; });
    const places = DB.bucketsOf(moves).filter(b => b.qty !== 0);
    const low = DB.isLow(p);

    const frag = h(`<div>
      ${p.photo ? `<img class="hero" alt="" src="${blobUrl(p.photo)}">` : `<div class="hero">${ICON.camera}</div>`}
      <div class="pn">${esc(p.partNumber || '—')}</div>
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      <div class="card stockbox-wrap ${low ? 'is-low' : ''}">
        <div class="stockbox">
          <div><div class="lbl">Total in stock</div>
            ${p.lowStockAt != null ? `<div class="low-line ${low ? 'on' : ''}">${low ? 'Low stock · ' : ''}warns at ${p.lowStockAt} or less</div>` : ''}</div>
          <div class="big ${p.stock ? '' : 'zero'} ${low ? 'low' : ''}">${p.stock}</div>
        </div>
        ${places.length ? `<ul class="places">${places.map(b => `
          <li><span class="pl">${placeHtml(b.location, b.owner)}</span><b>${b.qty}</b></li>`).join('')}</ul>` : ''}
      </div>
      <div class="move-actions three">
        <button class="btn out" id="rm" ${p.stock ? '' : 'disabled'}>− Remove</button>
        <button class="btn" id="mv" ${p.stock ? '' : 'disabled'}>⇄ Move</button>
        <button class="btn in" id="add">+ Add</button>
      </div>
      <h2 class="section">History</h2>
      ${rows.length ? `<ul class="card hist">${rows.map(({ m, before, after }) => `
        <li data-id="${m.id}">
          <div class="d ${m.kind === 'move' ? 'mv' : m.delta > 0 ? 'in' : 'out'}">${m.kind === 'move' ? `⇄${m.qty}` : signed(m.delta)}</div>
          <div class="grow" style="flex:1;min-width:0">
            <div class="what">${moveLabel(m)} ${m.kind === 'move' ? m.qty : Math.abs(m.delta)}${m.editedAt ? ' <span class="tag">edited</span>' : ''}</div>
            <div class="when">${esc(fmtWhen(m.at, m.dateOnly))}</div>
            <div class="where">${entryPlaceHtml(m)}</div>
            ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
          </div>
          <div class="bal" aria-label="Stock before and after">${before} → <b>${after}</b></div>
        </li>`).join('')}</ul>`
      : `<div class="card empty" style="padding:24px">No stock changes yet.</div>`}
    </div>`);

    const doMove = async (dir) => {
      const r = dir === 'move' ? await moveSheet(p) : await movementSheet(p, dir);
      if (!r) return;
      let res;
      try { res = await DB.addMovement({ productId: id, ...r }); }
      catch (err) { toast(err.code === 'NEGATIVE' ? `Can't save: ${err.message}` : 'Could not save'); render(); return; }
      const { product, movement } = res;
      render();
      if (!movement) return;
      const msg = r.kind === 'move' ? `Moved ${r.qty} to ${placeLabel(r.toLocation, r.toOwner)}`
        : `${r.delta > 0 ? 'Added' : 'Removed'} ${Math.abs(r.delta)} · ${product.stock} in stock`;
      toast(msg + (DB.isLow(product) && r.delta < 0 ? ' · Low stock' : ''), [
        { label: 'Undo', run: async () => { await DB.deleteMovement(movement.id); toast('Undone'); render(); } },
      ]);
    };
    frag.getElementById('rm').onclick = () => doMove('out');
    frag.getElementById('add').onclick = () => doMove('in');
    frag.getElementById('mv').onclick = () => doMove('move');
    frag.querySelectorAll('.hist li').forEach(li => li.onclick = () => {
      const r = rows.find(x => x.m.id === li.dataset.id);
      entrySheet(p, r.m, r.before, r.after);
    });
    return frag;
  }

  // ---------- locations & owners manager ----------
  async function viewPlaces(id) {
    const project = await DB.getProject(id);
    if (!project) return notFound();
    setChrome({ title: 'Locations and owners', back: `#/p/${id}` });
    const section = (kind, title, word, ex) => {
      const list = project[kind] || [];
      return `<h2 class="section">${title}</h2>
        ${list.length ? `<div class="card namelist">${list.map((n, i) => `
          <div class="name-row"><span class="grow">${esc(n)}</span>
            <button class="link-btn" data-k="${kind}" data-i="${i}" data-a="ren">Rename</button>
            <button class="link-btn danger" data-k="${kind}" data-i="${i}" data-a="rm">Remove</button></div>`).join('')}</div>`
        : `<div class="card banner">No ${word}s yet. Add one here, or type one in when you add stock.</div>`}
        <button class="btn wide" data-k="${kind}" data-a="add" data-w="${word}" data-ex="${esc(ex)}">+ Add ${word}</button>`;
    };
    const frag = h(`<div>
      <p class="desc">Stock is counted separately for each location and owner. These lists are only for ${esc(project.name)}.</p>
      ${section('locations', 'Locations', 'location', 'e.g. Bin A, Truck, Site trailer')}
      ${section('owners', 'Owners', 'owner', 'Who owns the material')}
    </div>`);
    frag.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const kind = b.dataset.k, name = (project[kind] || [])[+b.dataset.i];
      const word = kind === 'locations' ? 'location' : 'owner';
      if (b.dataset.a === 'add') {
        const v = await textSheet(`New ${word}`, { placeholder: b.dataset.ex, label: 'Add' });
        if (v) { await DB.addName(id, kind, v); render(); }
      } else if (b.dataset.a === 'ren') {
        const v = await textSheet(`Rename ${word}`, { value: name });
        if (v && v !== name) { await DB.renameName(id, kind, name, v); toast('Renamed everywhere in this project'); render(); }
      } else if (await confirmSheet(`Remove “${name}”?`, `It won't be offered for new entries. Stock and History already recorded with it stay as they are.`, 'Remove')) {
        await DB.removeName(id, kind, name); render();
      }
    });
    return frag;
  }

  // ---------- settings, what's new, help ----------
  const verLabel = (r) => `Version ${esc(r.version)} · Build ${esc(r.build)}`;
  const fmtDate = (d) => { const t = new Date(`${d}T12:00:00`); return isNaN(t) ? esc(d) : t.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }); };
  const releaseHtml = (r, current) => `
    <div class="card release">
      <div class="rel-head">${verLabel(r)}${current ? ' <span class="pill">Current</span>' : ''}</div>
      <div class="rel-sub">${esc(r.title || '')}${r.title && r.date ? ' · ' : ''}${r.date ? fmtDate(r.date) : ''}</div>
      <ul class="changes">${r.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>`;

  function viewSettings() {
    setChrome({ title: 'Settings', back: '#/' });
    return h(`<div>
      <h2 class="section">Updates</h2>
      <div class="list">
        <a class="card row" href="#/settings/new">
          <div class="grow"><div class="t">What's New</div><div class="s">${verLabel(RELEASES[0] || { version: '?', build: '?' })} and earlier releases</div></div>${ICON.chev}
        </a>
      </div>
      <h2 class="section">Help</h2>
      <div class="list">
        <a class="card row" href="#/settings/help">
          <div class="grow"><div class="t">How to use the app</div><div class="s">Projects, products, photos, stock and updates</div></div>${ICON.chev}
        </a>
      </div>
      <h2 class="section">About</h2>
      <div class="card about">
        <div class="t">Simple Inventory</div>
        <div class="s">${verLabel(RELEASES[0] || { version: '?', build: '?' })}</div>
        <div class="s">All data is stored only on this phone.</div>
        <a class="btn primary" href="${COMMITS_URL}" target="_blank" rel="noopener">View all changes on GitHub</a>
      </div>
    </div>`);
  }

  function viewWhatsNew() {
    setChrome({ title: "What's New", back: '#/settings' });
    if (!RELEASES.length) return h(`<div class="empty">No release notes.</div>`);
    const [cur, ...older] = RELEASES;
    return h(`<div>
      <h2 class="section">This update</h2>
      ${releaseHtml(cur, true)}
      ${older.length ? `<h2 class="section">Earlier releases</h2><div class="list">${older.map(r => releaseHtml(r)).join('')}</div>` : ''}
      <a class="btn wide" href="${COMMITS_URL}" target="_blank" rel="noopener">View all changes on GitHub</a>
    </div>`);
  }

  function viewHelp() {
    setChrome({ title: 'Help', back: '#/settings' });
    const topics = [
      ['Projects', 'Each project keeps its own inventory. On the Inventory screen tap <b>New project</b>. Open a project and tap <b>⋮</b> to rename or delete it.'],
      ['Adding a product', 'Open a project and tap <b>Add product</b>. Tap the photo box to take a picture, enter the model/part number and a description, set the starting quantity, then tap <b>Add product</b>.'],
      ['Photos', 'Tap the photo box to use the camera, or <b>Choose from library</b> for a saved picture. To change a photo later, open the product, tap <b>⋮</b> › <b>Edit product</b>.'],
      ['Adding and removing stock', 'Tap a product to open it, then tap <b>+ Add</b> or <b>− Remove</b>. Pick the date (today is filled in), enter the quantity and, if you like, a note such as "10 for sections 15A". Add asks for the location and owner. Remove asks where the stock comes from and won\'t let you take more than that spot holds. The form shows the stock there and the total after the change. Notes you used recently appear under the note box: tap one to reuse it. Right after saving, tap <b>Undo</b> at the bottom if it was a mistake.'],
      ['Locations and owners', 'Stock is counted separately for each location (for example Bin A, Truck) and owner. The product page shows the total and how much is at each one. In the Add form, pick a location and owner, or choose <b>+ New location…</b> / <b>+ New owner…</b> to type a new one. To rename or remove names, open the project and tap <b>⋮</b> › <b>Locations and owners</b>. Renaming updates every entry in the project.'],
      ['Moving stock', 'To move stock between locations or owners (for example from Bin A to the truck), open the product and tap <b>⇄ Move</b>. Pick where it comes from, where it goes, and how many. The total stays the same and History shows one "Moved" entry.'],
      ['Low-stock warning', 'When adding a product, or later with <b>⋮</b> › <b>Edit product</b>, fill in <b>Low-stock warning</b>. When the total in stock is at or below that number, the product shows a red <b>Low</b> tag, the project shows how many items are low, and <b>Low stock only</b> above the product list shows just those.'],
      ['History', "Open a product to see every change, newest first: the date, whether it was added, removed or moved, the quantity, the location and owner, the total before → after, and the note."],
      ['Fixing a History entry', 'Tap an entry in History to see its details. Tap <b>Edit</b> to change the date, quantity, location, owner or note: the stock adjusts to match, and the entry is marked <b>edited</b> with a record of what it was before. Tap <b>Delete</b> to remove the entry and put the stock back.'],
      ['Correcting a count', 'If the count on the shelf is different, open the product, tap <b>⋮</b> › <b>Correct stock count</b>, pick the location and owner, and enter the real number there. The difference is saved in History as a "count" entry.'],
      ['“Not set”', 'Stock recorded before version 1.3 has no location or owner, so it shows as <b>Not set</b>. To sort it out, use <b>⇄ Move</b> to move it to the right location and owner, or tap an old History entry and <b>Edit</b> it.'],
      ['Searching', 'Inside a project, type in the search box to find products by part number or description.'],
      ['Updates', "The app checks for updates whenever you open it. When one arrives, it refreshes once by itself and shows <b>What's New</b>. Your data is not affected. You can see the version and build here in Settings."],
      ['Your data', 'Everything is stored only on this phone, and nothing is sent anywhere. Deleting the app or clearing the browser data for this site erases it.'],
    ];
    return h(`<div class="help">${topics.map(([t, b]) => `
      <details class="card"><summary>${esc(t)}</summary><p>${b}</p></details>`).join('')}</div>`);
  }

  /** Popup after an update: every release newer than the build last seen on this phone. */
  async function maybeShowWhatsNew() {
    if (!RELEASES.length) return;
    let seen = parseInt(ls.get('seenBuild'), 10);
    if (isNaN(seen)) {
      // No record yet. Phones that used build 1 (before this existed) already have
      // projects, so show them the news; a brand-new install starts quietly.
      const hasData = (await DB.listProjects().catch(() => [])).length > 0;
      seen = hasData ? 1 : APP_BUILD;
    }
    ls.set('seenBuild', String(APP_BUILD));
    const fresh = RELEASES.filter(r => r.build > seen);
    if (!fresh.length || $sheetRoot.children.length) return;
    sheet(`<h3>What's New</h3>
      <p class="desc" style="margin-top:-8px">You're now on ${verLabel(RELEASES[0])}${fresh.length > 1 ? `. Here's everything from the ${fresh.length} updates you missed.` : '.'}</p>
      <div class="whatsnew">${fresh.map((r, i) => releaseHtml(r, i === 0)).join('')}</div>
      <div class="actions"><button class="btn" data-a="all">See all in Settings</button><button class="btn primary" data-a="ok">Got it</button></div>`,
      (el, close) => {
        el.querySelector('[data-a=ok]').onclick = close;
        el.querySelector('[data-a=all]').onclick = () => { close(); go('#/settings/new'); };
      });
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
      else if (parts[0] === 'p' && parts[2] === 'places') node = await viewPlaces(parts[1]);
      else if (parts[0] === 'p' && parts[1]) node = await viewProject(parts[1]);
      else if (parts[0] === 'i' && parts[2] === 'edit') node = await viewProductForm(null, parts[1]);
      else if (parts[0] === 'i' && parts[1]) node = await viewProduct(parts[1]);
      else if (parts[0] === 'settings' && parts[1] === 'new') node = viewWhatsNew();
      else if (parts[0] === 'settings' && parts[1] === 'help') node = viewHelp();
      else if (parts[0] === 'settings') node = viewSettings();
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

  window.addEventListener('hashchange', () => { ss.set('nav', '1'); $sheetRoot.replaceChildren(); render(); reloadIfUpdated(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });

  // ---------- boot ----------
  DB.open().then(render).then(maybeShowWhatsNew).catch(err => {
    $view.replaceChildren(h(`<div class="empty"><b>Storage unavailable</b>${esc(err.message || err)}<br>Private browsing can block on-device storage.</div>`));
  });
  DB.persist();

  let canSW = false;
  try { canSW = 'serviceWorker' in navigator && window.isSecureContext && window.top === window; } catch {}
  // ---------- updates ----------
  // A new sw.js installs the new files and takes over right away (skipWaiting +
  // clients.claim), which fires 'controllerchange'. We then reload once so the
  // new app.js runs and shows What's New. The reload waits while the user is
  // busy (a sheet is open, or the add/edit product form is on screen).
  let updateReady = false, reloading = false;
  const busy = () => $sheetRoot.children.length > 0 || /^#\/(p\/[^/]+\/new|i\/[^/]+\/edit)/.test(location.hash);
  function reloadIfUpdated() {
    if (!updateReady || reloading || busy()) return;
    reloading = true;
    location.reload();
  }
  // Re-check when a sheet closes (sheets are removed from #sheetRoot).
  new MutationObserver(() => setTimeout(reloadIfUpdated, 300)).observe($sheetRoot, { childList: true });

  if (canSW) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;       // first install, not an update
      updateReady = true;
      reloadIfUpdated();
    });
    // updateViaCache:'none' makes the phone always fetch sw.js fresh, skipping the HTTP cache.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
        else reloadIfUpdated();       // safe moment: app is in the background
      });
      window.addEventListener('online', check);
    }).catch(() => {});
  }
})();
