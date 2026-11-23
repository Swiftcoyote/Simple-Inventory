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
  const $tabbar = document.getElementById('tabbar');
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
    chart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>',
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

  // People (1.6): one app-wide list (Lists › Team Members since 1.10). The last name picked on this
  // phone is preselected, so a person using their own phone picks it once.
  const lastPerson = { get: () => ls.get('lastPerson') || '', set: (v) => { if (v) ls.set('lastPerson', v); } };
  const personStart = (people, entry) => entry ? (entry.person || '') : people.includes(lastPerson.get()) ? lastPerson.get() : null;
  const personHtml = (people, entry) => pickHtml('who', 'Team Member', people, personStart(people, entry), 'team member');
  const WHO_MSG = 'Choose or type the team member doing this';

  // Storage locations and product owners (1.10): one app-wide list of each, loaded on
  // every render. Each project's own names (project.locations / owners) show first.
  let NAMES = { locations: [], owners: [] };
  const refreshNames = async () => { NAMES = await DB.listNames().catch(() => NAMES); };
  const nameSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  /** For pickHtml: { all, top } where top is what this project uses. */
  const namesFor = (project, kind) => ({ all: NAMES[kind], top: project?.[kind] || [] });
  /** The project's product owner when it has exactly one (preselected on new stock). */
  const soleOwner = (project) => (project?.owners || []).length === 1 ? project.owners[0] : null;
  const locPick = (project, value) => pickHtml('loc', 'Storage Location', namesFor(project, 'locations'), value, 'storage location');
  const ownPick = (project, value) => pickHtml('own', 'Product Owner', namesFor(project, 'owners'), value, 'product owner');

  /** A dropdown of names with "+ New …" that opens a text box. names is a list, or
   *  { all, top }: top (the project's own names) shows first under "This project".
   *  value: the name to preselect; '' preselects "Not set" (old entries); null = none. */
  function pickHtml(name, label, names, value, word) {
    const all = Array.isArray(names) ? names : names.all || [];
    const top = Array.isArray(names) ? [] : [...new Set(names.top || [])].sort(nameSort);
    const rest = all.filter(n => !top.includes(n));
    if (value && !top.includes(value) && !rest.includes(value)) (top.length ? top : rest).unshift(value);
    const list = [...top, ...rest];
    const sel = value == null ? (list.length ? '__none' : '__new') : value === '' ? '__notset' : value;
    const opts = (l) => l.map(n => `<option value="${esc(n)}" ${sel === n ? 'selected' : ''}>${esc(n)}</option>`).join('');
    return `<div class="field pick"><label><span>${label}</span>
      <select class="input" name="${name}" data-pick>
        ${list.length ? `<option value="__none" disabled ${sel === '__none' ? 'selected' : ''}>Choose ${word}…</option>` : ''}
        ${value === '' ? `<option value="__notset" selected>${NOT_SET}</option>` : ''}
        ${top.length && rest.length ? `<optgroup label="This project">${opts(top)}</optgroup><optgroup label="Other ${word}s">${opts(rest)}</optgroup>` : opts(list)}
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
    const [notes, project, moves, people] = await Promise.all([
      DB.recentNotes(product.projectId).catch(() => []), DB.getProject(product.projectId), DB.listMovements(product.id), DB.listPeople(),
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
    const startOwner = entry ? (entry.owner || '') : (project.owners || []).includes(last.owner) ? last.owner : soleOwner(project);
    const startFrom = entry && isOut ? sources.findIndex(b => b.location === (entry.location || '') && b.owner === (entry.owner || '')) : null;
    return new Promise((resolve) => {
      sheet(`<h3>${title}</h3>
        <p class="desc" style="margin-top:-8px">${esc(productName(product))}</p>
        <form class="move-form">
          ${dateHtml(startDate, today)}
          ${personHtml(people, entry)}
          ${isOut ? fromHtml(sources, startFrom)
            : locPick(project, startLoc) + ownPick(project, startOwner)}
          ${qtyHtml(`Quantity ${isOut ? 'removed' : 'added'}`, startQty)}
          <div class="preview" aria-live="polite"></div>
          ${noteHtml(entry?.note, isOut ? 'e.g. 10 for sections 15A' : 'e.g. delivery from supplier, PO 5521')}
          ${entry ? '' : `<label class="field"><span>Low-stock warning (optional)</span>
            <input class="input" name="lowStockAt" type="number" inputmode="numeric" min="0" step="1" value="${product.lowStockAt ?? ''}" placeholder="Off">
            <small class="hint low-hint"></small>
          </label>`}
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
            const lowEl = f.elements.lowStockAt, hint = el.querySelector('.low-hint');
            if (lowEl && hint) {
              const lv = lowEl.value.trim() === '' ? null : parseInt(lowEl.value, 10);
              const on = lv != null && !isNaN(lv) && totalAfter <= lv;
              hint.textContent = lv == null || isNaN(lv) ? 'Warn when the total is at or below this number. Leave empty for no warning.'
                : on ? `The total after (${totalAfter}) is at or below ${lv}, so this product will show Low.` : `Warns when the total is ${lv} or less.`;
              hint.classList.toggle('low-txt', on);
            }
          };
          const qty = wireCommon(el, f, notes, draw);
          wirePicks(el, draw);
          if (f.elements.from) f.elements.from.onchange = draw;
          if (f.elements.lowStockAt) f.elements.lowStockAt.oninput = draw;
          draw();
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => {
            e.preventDefault();
            const pl = place();
            const person = readPick(f, 'who');
            if (person == null) { toast(WHO_MSG); return; }
            if (isOut && !pl) { toast('Choose where it comes from'); return; }
            if (!isOut && pl.location == null) { toast('Choose or type a storage location'); return; }
            if (!isOut && pl.owner == null) { toast('Choose or type a product owner'); return; }
            const n = qty();
            if (n < 1) { toast('Enter a quantity of 1 or more'); f.elements.qty.focus(); return; }
            if (isOut) {
              const here = qtyAt(base, pl.location, pl.owner);
              if (n > here) { toast(`Only ${here} at ${placeLabel(pl.location, pl.owner)}`); f.elements.qty.value = Math.max(1, here); draw(); return; }
            }
            let lowStockAt;            // undefined = unchanged
            if (f.elements.lowStockAt) {
              const raw = f.elements.lowStockAt.value.trim();
              const v = raw === '' ? null : parseInt(raw, 10);
              if (raw !== '' && (isNaN(v) || v < 0)) { toast('Low-stock warning must be 0 or more'); return; }
              if (v !== (product.lowStockAt ?? null)) lowStockAt = v;
            }
            const d = readDate(f, today, entry, startDate);
            if (!d) return;
            if (!isOut) lastPlace.set(product.projectId, pl);
            if (!entry) lastPerson.set(person);
            close();
            resolve({ delta: isOut ? -n : n, ...d, note: f.elements.note.value, ...pl, person, lowStockAt });
          };
        });
    });
  }

  /** Move stock from one place to another (or edit a move). Total stock is unchanged. */
  async function moveSheet(product, entry = null) {
    const [notes, project, moves, people] = await Promise.all([
      DB.recentNotes(product.projectId).catch(() => []), DB.getProject(product.projectId), DB.listMovements(product.id), DB.listPeople(),
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
          ${personHtml(people, entry)}
          ${fromHtml(sources, startFrom)}
          <div class="to-group">
            <div class="to-lbl">Move to</div>
            ${locPick(project, entry ? (entry.toLocation || '') : null)}
            ${ownPick(project, entry ? (entry.toOwner || '') : null)}
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
            if (readPick(f, 'who') == null) { toast(WHO_MSG); return; }
            if (!fr) { toast('Choose where it comes from'); return; }
            if (l == null) { toast('Choose or type where it goes'); return; }
            if (o == null) { toast('Choose or type a product owner'); return; }
            const person = readPick(f, 'who');
            if (person == null) { toast(WHO_MSG); return; }
            if (fr.location === l && fr.owner === o) { toast('Pick a different storage location or product owner to move to'); return; }
            if (n < 1) { toast('Enter a quantity of 1 or more'); return; }
            if (n > fr.qty) { toast(`Only ${fr.qty} at ${placeLabel(fr.location, fr.owner)}`); f.elements.qty.value = Math.max(1, fr.qty); draw(); return; }
            const d = readDate(f, today, entry, startDate);
            if (!d) return;
            if (!entry) lastPerson.set(person);
            close();
            resolve({ kind: 'move', qty: n, ...d, note: f.elements.note.value, location: fr.location, owner: fr.owner, toLocation: l, toOwner: o, person });
          };
        });
    });
  }

  /** Correct the count at one place. */
  async function countSheet(product) {
    const [project, moves, people] = await Promise.all([DB.getProject(product.projectId), DB.listMovements(product.id), DB.listPeople()]);
    const buckets = DB.bucketsOf(moves);
    const held = buckets.filter(b => b.qty > 0);
    const one = held.length === 1 ? held[0] : null;
    const hasUnsetLoc = buckets.some(b => !b.location && b.qty), hasUnsetOwn = buckets.some(b => !b.owner && b.qty);
    return new Promise((resolve) => {
      sheet(`<h3>Correct stock count</h3>
        <p class="desc" style="margin-top:-8px">${esc(productName(product))}. Enter what is actually there for one storage location and product owner.</p>
        <form class="move-form">
          ${personHtml(people)}
          ${locPick(project, one ? one.location : hasUnsetLoc && !NAMES.locations.length ? '' : null)}
          ${ownPick(project, one ? one.owner : hasUnsetOwn && !NAMES.owners.length ? '' : soleOwner(project))}
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
            if (l == null) { toast('Choose or type a storage location'); return; }
            if (o == null) { toast('Choose or type a product owner'); return; }
            if (n < 0) { toast('Enter 0 or more'); return; }
            const person = readPick(f, 'who');
            if (person == null) { toast(WHO_MSG); return; }
            lastPerson.set(person);
            close();
            resolve({ location: l, owner: o, person, count: n });
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
          : `<dt>Storage Location</dt><dd>${nameHtml(m.location)}</dd><dt>Product Owner</dt><dd>${nameHtml(m.owner)}</dd>`}
        <dt>Team Member</dt><dd>${nameHtml(m.person)}</dd>
        <dt>Total</dt><dd>${before} → ${after}</dd>
        <dt>Note</dt><dd>${m.note ? esc(m.note) : '<span class="muted">None</span>'}</dd>
      </dl>
      ${edits.length ? `<h2 class="section">Edited ${plural(edits.length, 'time')}</h2>
        <ul class="edits">${edits.slice().reverse().map((e, i, arr) => {
          const next = i === 0 ? m : arr[i - 1];
          const diffs = [];
          if (isMove ? e.qty !== next.qty : e.delta !== next.delta) diffs.push(isMove ? `quantity ${e.qty} → ${next.qty}` : `quantity ${signed(e.delta)} → ${signed(next.delta)}`);
          if (e.at !== next.at) diffs.push(`date ${esc(fmtWhen(e.at, e.dateOnly))} → ${esc(fmtWhen(next.at, next.dateOnly))}`);
          if ((e.location || '') !== (next.location || '')) diffs.push(`${isMove ? 'from ' : ''}storage location ${esc(e.location || NOT_SET)} → ${esc(next.location || NOT_SET)}`);
          if ((e.owner || '') !== (next.owner || '')) diffs.push(`${isMove ? 'from ' : ''}product owner ${esc(e.owner || NOT_SET)} → ${esc(next.owner || NOT_SET)}`);
          if (isMove && (e.toLocation || '') !== (next.toLocation || '')) diffs.push(`to storage location ${esc(e.toLocation || NOT_SET)} → ${esc(next.toLocation || NOT_SET)}`);
          if (isMove && (e.toOwner || '') !== (next.toOwner || '')) diffs.push(`to product owner ${esc(e.toOwner || NOT_SET)} → ${esc(next.toOwner || NOT_SET)}`);
          if ((e.person || '') !== (next.person || '')) diffs.push(`team member ${esc(e.person || NOT_SET)} → ${esc(next.person || NOT_SET)}`);
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
  function setChrome({ title, back, menu }) {
    $title.textContent = title;
    document.title = title === 'Projects' ? 'Simple Inventory' : `${title} · Inventory`;
    $back.hidden = !back;
    $back.onclick = back ? () => goBack(back) : null;
    $menu.hidden = !menu;
    $menu.onclick = menu || null;
  }

  // ---------- views ----------
  async function viewHome() {
    setChrome({ title: 'Projects' });
    const projects = await DB.listProjects();
    const frag = h(`<div>
      ${backupBannerHtml(projects.length > 0)}
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
      const r = await projectSheet({ title: 'New project', name: '', okLabel: 'Create' });
      if (r) { const p = await DB.saveProject({ name: r.name, owners: r.owners }); go(`#/p/${p.id}`); }
    };
    wireBackupBanner(frag);
    return frag;
  }

  let searchTerm = '', lowOnly = false;
  async function viewProject(id) {
    const project = await DB.getProject(id);
    if (!project) return notFound();
    setChrome({
      title: project.name, back: '#/',
      menu: () => menuSheet(project.name, [
        { label: 'Reports', run: () => { repState.proj = id; repState.prod = ALL; saveRep(); go('#/reports', true); } },
        { label: 'Product owners for this project', run: async () => {
          const r = await projectSheet({ title: 'Product owners for this project', chosen: project.owners || [] });
          if (r) { await DB.setProjectNames(id, 'owners', r.owners); toast('Product owners saved'); render(); }
        } },
        { label: 'Storage locations and product owners', run: () => { slideDir = 1; go(listHash(lastList.get() === 'team' ? 'locations' : lastList.get()), true); } },
        { label: 'Export to spreadsheet (CSV)', run: () => exportSheet(id) },
        { label: 'Rename project', run: async () => {
          const name = await textSheet('Rename project', { value: project.name });
          if (name) { await DB.saveProject({ id, name }); render(); }
        } },
        { label: 'Delete project', danger: true, run: async () => {
          if (await confirmSheet('Delete project?', `"${project.name}" and all its products and history will be deleted from this phone. A safety copy is kept, so you can undo this from Settings.`)) {
            await DB.deleteProject(id); goBack('#/');
            toast('Project deleted', [{ label: 'Undo', run: undoRestore }]);
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
    const [project, people] = await Promise.all([DB.getProject(projectId), DB.listPeople()]);
    if (!project) return notFound();
    setChrome({ title: existing ? 'Edit product' : 'New product', back: existing ? `#/i/${productId}` : `#/p/${projectId}` });

    let photo = existing?.photo;        // Blob | null | undefined
    const last = lastPlace.get(projectId);
    const startLoc = (project.locations || []).includes(last.location) ? last.location : null;
    const startOwner = (project.owners || []).includes(last.owner) ? last.owner : soleOwner(project);
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
          ${personHtml(people)}
          ${locPick(project, startLoc)}
          ${ownPick(project, startOwner)}
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
      let location, owner, person;
      if (initialStock > 0) {
        location = readPick(form, 'loc'); owner = readPick(form, 'own'); person = readPick(form, 'who');
        if (person == null) { toast('Choose or type who is adding the starting stock'); return; }
        if (location == null) { toast('Choose or type a storage location for the starting stock'); return; }
        if (owner == null) { toast('Choose or type a product owner for the starting stock'); return; }
        lastPlace.set(projectId, { location, owner });
        lastPerson.set(person);
      }
      const rec = await DB.saveProduct({
        id: existing?.id, projectId, partNumber, description, photo: photo ?? null,
        initialStock, location, owner, person, lowStockAt,
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
            ${m.person ? `<div class="who">By ${esc(m.person)}</div>` : ''}
            ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
          </div>
          <div class="bal" aria-label="Stock before and after">${before} → <b>${after}</b></div>
        </li>`).join('')}</ul>`
      : `<div class="card empty" style="padding:24px">No stock changes yet.</div>`}
    </div>`);

    const doMove = async (dir) => {
      const r = dir === 'move' ? await moveSheet(p) : await movementSheet(p, dir);
      if (!r) return;
      const { lowStockAt, ...entry } = r;
      let res;
      try {
        res = await DB.addMovement({ productId: id, ...entry });
        if (lowStockAt !== undefined) res.product = await DB.setLowStock(id, lowStockAt);
      }
      catch (err) { toast(err.code === 'NEGATIVE' ? `Can't save: ${err.message}` : 'Could not save'); render(); return; }
      const { product, movement } = res;
      render();
      if (!movement) return;
      const msg = r.kind === 'move' ? `Moved ${r.qty} to ${placeLabel(r.toLocation, r.toOwner)}`
        : `${r.delta > 0 ? 'Added' : 'Removed'} ${Math.abs(r.delta)} · ${product.stock} in stock`;
      const lowNote = lowStockAt !== undefined ? (lowStockAt == null ? ' · Warning off' : ` · Warns at ${lowStockAt}`) : '';
      toast(msg + lowNote + (DB.isLow(product) && r.delta < 0 ? ' · Low stock' : ''), [
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

  // ---------- Inventory tab (1.9): every product from every project ----------
  // Products with the same part number in different projects are one item here,
  // with a combined total. Products without a part number stay on their own.
  const invKey = (p) => (p.partNumber || '').trim() ? `pn:${p.partNumber.trim().toLowerCase()}` : `id:${p.id}`;
  const invState = { q: '', proj: '__all', loc: '__all', own: '__all', low: false, sort: 'pn' };
  const natCmp = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });

  async function inventoryItems() {
    const data = await DB.exportAll();
    const projById = Object.fromEntries(data.projects.map(p => [p.id, p]));
    const movesBy = {};
    for (const m of data.movements) (movesBy[m.productId] || (movesBy[m.productId] = [])).push(m);
    const items = new Map();
    for (const p of data.products) {
      if (!projById[p.projectId]) continue;
      const k = invKey(p);
      const it = items.get(k) || { key: k, partNumber: p.partNumber || '', description: '', photo: null, rows: [] };
      if (!it.description && p.description) it.description = p.description;
      if (!it.photo && p.photo) it.photo = p.photo;
      it.rows.push({ product: p, project: projById[p.projectId], buckets: DB.bucketsOf(movesBy[p.id] || []) });
      items.set(k, it);
    }
    for (const it of items.values()) {
      it.rows.sort((a, b) => natCmp(a.project.name, b.project.name));
      it.total = it.rows.reduce((a, r) => a + r.product.stock, 0);
      it.low = it.rows.some(r => DB.isLow(r.product));
      it.locations = new Set(it.rows.flatMap(r => r.buckets.filter(b => b.qty).map(b => b.location)));
    }
    return { items: [...items.values()], projects: data.projects.slice().sort((a, b) => natCmp(a.name, b.name)) };
  }

  async function viewInventory() {
    setChrome({ title: 'Inventory' });
    const { items, projects } = await inventoryItems();
    const st = invState;
    const locs = new Set(), owns = new Set();
    for (const it of items) for (const r of it.rows) for (const b of r.buckets) { locs.add(b.location); owns.add(b.owner); }
    for (const p of projects) { (p.locations || []).forEach(n => locs.add(n)); (p.owners || []).forEach(n => owns.add(n)); }
    if (st.proj !== ALL && !projects.some(p => p.id === st.proj)) st.proj = ALL;
    if (st.loc !== ALL && !locs.has(st.loc)) st.loc = ALL;
    if (st.own !== ALL && !owns.has(st.own)) st.own = ALL;
    const opts = (set, cur) => [...set].sort((a, b) => (a === '') - (b === '') || natCmp(a, b))
      .map(n => `<option value="${esc(n)}" ${cur === n ? 'selected' : ''}>${esc(n || NOT_SET)}</option>`).join('');
    const sel = (name, label, inner, cur) => `<label class="field"><span>${label}</span>
      <select class="input" name="${name}"><option value="${ALL}" ${cur === ALL ? 'selected' : ''}>All</option>${inner}</select></label>`;
    const nFilters = () => [st.proj, st.loc, st.own].filter(v => v !== ALL).length;
    const lowCount = items.filter(i => i.low).length;
    if (!lowCount) st.low = false;

    const frag = h(`<div>
      ${items.length ? `
        <input class="search" type="search" placeholder="Search part #, description or project" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search">
        <form class="card rfilters inv-filters" autocomplete="off">
          <details class="more-filters" ${nFilters() ? 'open' : ''}>
            <summary>Filters and sort${nFilters() ? ` (${nFilters()})` : ''}</summary>
            ${sel('proj', 'Project', projects.map(p => `<option value="${esc(p.id)}" ${st.proj === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join(''), st.proj)}
            ${sel('loc', 'Storage Location', opts(locs, st.loc), st.loc)}
            ${sel('own', 'Product Owner', opts(owns, st.own), st.own)}
            <label class="field"><span>Sort by</span><select class="input" name="sort">
              ${[['pn', 'Part number'], ['desc', 'Description'], ['low', 'Lowest stock first']].map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
            <button type="button" class="link-btn" data-a="clear" ${nFilters() ? '' : 'hidden'}>Clear filters</button>
          </details>
        </form>
        <div class="summary-row">
          <div class="summary" id="invSum"></div>
          ${lowCount ? `<button class="filter ${st.low ? 'on' : ''}" id="lowOnly" aria-pressed="${st.low}">Low stock only (${lowCount})</button>` : ''}
        </div>
        <div class="list" id="ilist"></div>`
      : `<div class="empty">${ICON.box}<b>No products yet</b>Products you add in any project show up here, all in one list.</div>`}
    </div>`);

    const list = frag.getElementById('ilist'), sumEl = frag.getElementById('invSum');
    const draw = () => {
      if (!list) return;
      const q = st.q.trim().toLowerCase();
      const shown = [];
      for (const it of items) {
        let rows = it.rows.filter(r => st.proj === ALL || r.project.id === st.proj);
        const placeOk = (b) => (st.loc === ALL || b.location === st.loc) && (st.own === ALL || b.owner === st.own);
        const placed = st.loc === ALL && st.own === ALL;
        if (!placed) rows = rows.filter(r => r.buckets.some(placeOk));
        if (!rows.length) continue;
        if (q && !`${it.partNumber} ${it.description} ${it.rows.map(r => `${r.product.description} ${r.project.name}`).join(' ')}`.toLowerCase().includes(q)) continue;
        if (st.low && !it.low) continue;
        const qty = placed ? rows.reduce((a, r) => a + r.product.stock, 0)
          : rows.reduce((a, r) => a + r.buckets.filter(placeOk).reduce((s, b) => s + b.qty, 0), 0);
        shown.push({ it, rows, qty });
      }
      const cmp = { pn: (a, b) => natCmp(a.it.partNumber || a.it.description, b.it.partNumber || b.it.description),
        desc: (a, b) => natCmp(a.it.description || a.it.partNumber, b.it.description || b.it.partNumber),
        low: (a, b) => a.qty - b.qty || natCmp(a.it.partNumber, b.it.partNumber) }[st.sort];
      shown.sort(cmp);
      const units = shown.reduce((a, s) => a + s.qty, 0);
      sumEl.textContent = `${plural(shown.length, 'product')} · ${plural(units, 'unit')}${st.loc !== ALL || st.own !== ALL ? ' there' : ' in stock'}`;
      list.replaceChildren(h(shown.length ? shown.map(({ it, rows, qty }) => {
        const projNames = rows.map(r => r.project.name);
        const where = projNames.length === 1 ? esc(projNames[0]) : `${projNames.length} projects`;
        const nLoc = it.locations.size;
        return `<a class="card row" href="#/inventory/${encodeURIComponent(it.key)}">
          ${it.photo ? `<img class="thumb" alt="" src="${blobUrl(it.photo)}">` : `<div class="thumb">${ICON.box}</div>`}
          <div class="grow"><div class="t">${esc(it.partNumber || '—')}${it.low ? ' <span class="tag low">Low</span>' : ''}</div>
            <div class="s">${esc(it.description)}</div>
            <div class="s inv-where">${where}${nLoc ? ` · ${plural(nLoc, 'storage location')}` : ''}</div></div>
          <div class="count ${qty ? '' : 'zero'}"><span class="n">${qty}</span><span class="l">${st.loc !== ALL || st.own !== ALL ? 'there' : 'in stock'}</span></div>
        </a>`;
      }).join('') : `<div class="empty">No products match${q ? ` “${esc(st.q)}”` : ''}${st.low ? ' in low stock' : ''}${nFilters() ? ' with these filters' : ''}.</div>`));
    };

    const s = frag.querySelector('.search');
    if (s) s.oninput = () => { st.q = s.value; draw(); };
    const lo = frag.getElementById('lowOnly');
    if (lo) lo.onclick = () => { st.low = !st.low; lo.classList.toggle('on', st.low); lo.setAttribute('aria-pressed', st.low); draw(); };
    const f = frag.querySelector('form.inv-filters');
    if (f) {
      const sync = () => {
        const n = nFilters();
        f.querySelector('summary').textContent = `Filters and sort${n ? ` (${n})` : ''}`;
        f.querySelector('[data-a="clear"]').hidden = !n;
      };
      f.addEventListener('change', (e) => { st[e.target.name] = e.target.value; sync(); draw(); });
      f.querySelector('[data-a="clear"]').onclick = () => {
        st.proj = st.loc = st.own = ALL;
        for (const n of ['proj', 'loc', 'own']) f.elements[n].value = ALL;
        sync(); draw();
      };
    }
    draw();
    return frag;
  }

  async function viewInventoryItem(key) {
    const { items } = await inventoryItems();
    const it = items.find(i => i.key === key);
    if (!it) return notFound();
    setChrome({ title: it.partNumber || it.description || 'Product', back: '#/inventory' });
    const byLoc = new Map(), byOwn = new Map();
    for (const r of it.rows) for (const b of r.buckets) {
      if (!b.qty) continue;
      byLoc.set(b.location, (byLoc.get(b.location) || 0) + b.qty);
      byOwn.set(b.owner, (byOwn.get(b.owner) || 0) + b.qty);
    }
    const sortNames = (m) => [...m].sort((a, b) => (a[0] === '') - (b[0] === '') || natCmp(a[0], b[0]));
    const nameList = (m) => `<ul class="card places inv-places">${sortNames(m).map(([n, q]) => `<li><span class="pl">${nameHtml(n)}</span><b>${q}</b></li>`).join('')}</ul>`;
    const descs = [...new Set(it.rows.map(r => r.product.description).filter(Boolean))];
    const frag = h(`<div>
      ${it.photo ? `<img class="hero" alt="" src="${blobUrl(it.photo)}">` : `<div class="hero">${ICON.camera}</div>`}
      <div class="pn">${esc(it.partNumber || '—')}</div>
      ${descs.map(d => `<p class="desc">${esc(d)}</p>`).join('')}
      <div class="card stockbox-wrap">
        <div class="stockbox">
          <div><div class="lbl">Total in stock</div>
            <div class="low-line">${plural(it.rows.length, 'project')} · ${plural(byLoc.size, 'storage location')}</div></div>
          <div class="big ${it.total ? '' : 'zero'}">${it.total}</div>
        </div>
      </div>
      <h2 class="section">Projects</h2>
      <p class="hint inv-hint">Tap a project to add, remove or move stock there and see its History.</p>
      <div class="list">${it.rows.map(({ product: p, project, buckets }) => {
        const low = DB.isLow(p), places = buckets.filter(b => b.qty);
        return `<a class="card inv-proj" href="#/i/${p.id}">
          <div class="row">
            <div class="proj-icon">${esc((project.name.trim()[0] || '?').toUpperCase())}</div>
            <div class="grow"><div class="t">${esc(project.name)}${low ? ' <span class="tag low">Low</span>' : ''}</div>
              ${p.lowStockAt != null ? `<div class="s">Warns at ${p.lowStockAt} or less</div>` : ''}</div>
            <div class="count ${p.stock ? '' : 'zero'} ${low ? 'low' : ''}"><span class="n">${p.stock}</span><span class="l">in stock</span></div>
            ${ICON.chev}
          </div>
          ${places.length ? `<ul class="places">${places.map(b => `<li><span class="pl">${placeHtml(b.location, b.owner)}</span><b>${b.qty}</b></li>`).join('')}</ul>` : ''}
        </a>`;
      }).join('')}</div>
      ${byLoc.size ? `<h2 class="section">By storage location</h2>${nameList(byLoc)}` : ''}
      ${byOwn.size ? `<h2 class="section">By product owner</h2>${nameList(byOwn)}` : ''}
    </div>`);
    return frag;
  }

  // ---------- Lists tab (1.10) ----------
  // Storage Locations, Product Owners and Team Members, one app-wide list of each, on
  // three swipeable sub-tabs. A storage location or product owner opens its own page:
  // what's stored there (or owned) in every project, and for locations, named photos.
  const LIST_TABS = [['locations', 'Storage<br>Locations'], ['owners', 'Product<br>Owners'], ['team', 'Team<br>Members']];
  const LIST_KEYS = LIST_TABS.map(t => t[0]);
  const LIST_WORD = { locations: 'storage location', owners: 'product owner' };
  const listHash = (kind, name) => `#/lists/${kind}${name != null ? `/${encodeURIComponent(name)}` : ''}`;
  const lastList = { get: () => LIST_KEYS.includes(ss.get('listTab')) ? ss.get('listTab') : 'locations', set: (v) => ss.set('listTab', v) };
  const PIN = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const initial = (n) => esc((n.trim()[0] || '?').toUpperCase());

  function listTabsHtml(cur) {
    return `<nav class="seg" aria-label="Lists">${LIST_TABS.map(([k, t]) =>
      `<a href="${listHash(k)}" data-sub="${k}" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  }

  /** How each name is used: projects that use it and units stored there right now. */
  async function nameUsage(kind) {
    const { rows, projects } = await DB.stockRows();
    const key = kind === 'locations' ? 'location' : 'owner';
    const use = {};
    const u = (n) => use[n] || (use[n] = { projects: new Set(), units: 0 });
    for (const p of projects) for (const n of p[kind] || []) u(n).projects.add(p.id);
    for (const r of rows) if (r[key]) { u(r[key]).units += r.qty; u(r[key]).projects.add(r.project.id); }
    return use;
  }
  const usageLine = (kind, x) => {
    if (!x || (!x.projects.size && !x.units)) return 'Not used in a project yet';
    const bits = [`Used in ${plural(x.projects.size, 'project')}`];
    if (x.units) bits.push(kind === 'locations' ? `${plural(x.units, 'unit')} here` : `owns ${plural(x.units, 'unit')}`);
    return bits.join(' · ');
  };

  async function viewLists(sub) {
    if (!LIST_KEYS.includes(sub)) sub = lastList.get();
    lastList.set(sub);
    setChrome({ title: 'Lists' });
    let body;
    if (sub === 'team') body = await teamHtml();
    else body = await namesHtml(sub);
    const frag = h(`<div class="lists">${listTabsHtml(sub)}<div class="sub-body"></div></div>`);
    frag.querySelector('.sub-body').append(body);
    frag.querySelectorAll('.seg a').forEach(a => a.onclick = (e) => {
      e.preventDefault();
      const to = a.dataset.sub;
      if (to === sub) return;
      slideDir = Math.sign(LIST_KEYS.indexOf(to) - LIST_KEYS.indexOf(sub));
      go(listHash(to), true);
    });
    return frag;
  }

  async function namesHtml(kind) {
    const word = LIST_WORD[kind];
    const [use, photos] = await Promise.all([nameUsage(kind), kind === 'locations' ? DB.listLocPhotos() : {}]);
    const names = NAMES[kind];
    const frag = h(`<div>
      <p class="desc">${kind === 'locations'
        ? 'Where stock is kept, for example Bin A, Truck or Site trailer. Every project uses this one list. Tap one to add photos and see what is stored there.'
        : 'Who owns the material, for example your company, the client or the general contractor. Every project uses this one list. Tap one to see what they own.'}</p>
      ${names.length ? `<div class="list">${names.map(n => {
        const ph = photos[n] || [];
        const icon = kind === 'locations'
          ? (ph.length ? `<img class="thumb sm" alt="" src="${blobUrl(ph[0].photo)}">` : `<div class="thumb sm">${PIN}</div>`)
          : `<div class="proj-icon">${initial(n)}</div>`;
        return `<a class="card row" href="${listHash(kind, n)}">${icon}
          <div class="grow"><div class="t">${esc(n)}</div><div class="s">${esc(usageLine(kind, use[n]))}${ph.length ? ` · ${plural(ph.length, 'photo')}` : ''}</div></div>${ICON.chev}</a>`;
      }).join('')}</div>`
      : `<div class="card banner">No ${word}s yet. Add one here, or choose <b>+ New ${word}…</b> when you add stock.</div>`}
      <button class="btn wide" data-a="add">+ Add ${word}</button>
    </div>`);
    frag.querySelector('[data-a=add]').onclick = async () => {
      const v = await textSheet(`New ${word}`, { placeholder: kind === 'locations' ? 'e.g. Bin A, Truck, Site trailer' : 'e.g. Our company, Client, GC', label: 'Add' });
      if (v) { await DB.addName(kind, v); toast(`Added ${v}`); render(); }
    };
    return frag;
  }

  async function teamHtml() {
    const people = await DB.listPeople();
    const frag = h(`<div>
      <p class="desc">Names to pick under <b>Team Member</b> when you add, remove, move or count stock. Reports show how much each team member added and used. Every project uses this one list.</p>
      ${people.length ? `<div class="card namelist">${people.map((n, i) => `
        <div class="name-row"><span class="grow">${esc(n)}</span>
          <button class="link-btn" data-i="${i}" data-a="ren">Rename</button>
          <button class="link-btn danger" data-i="${i}" data-a="rm">Remove</button></div>`).join('')}</div>`
      : `<div class="card banner">No names yet. Add one here, or choose <b>+ New team member…</b> on the Add or Remove form.</div>`}
      <button class="btn wide" data-a="add">+ Add team member</button>
    </div>`);
    frag.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const name = people[+b.dataset.i];
      if (b.dataset.a === 'add') {
        const v = await textSheet('New team member', { placeholder: 'Name, e.g. Sam R.', label: 'Add' });
        if (v) { await DB.addPerson(v); render(); }
      } else if (b.dataset.a === 'ren') {
        const v = await textSheet('Rename team member', { value: name });
        if (v && v !== name) {
          await DB.renamePerson(name, v);
          if (lastPerson.get() === name) lastPerson.set(v);
          toast('Renamed on every entry'); render();
        }
      } else if (await confirmSheet(`Remove “${name}”?`, `They won't be offered for new entries. History already recorded with their name stays as it is.`, 'Remove')) {
        await DB.removePerson(name); render();
      }
    });
    return frag;
  }

  /** A storage location's or product owner's page. */
  async function viewListItem(kind, name) {
    const word = LIST_WORD[kind];
    const isLoc = kind === 'locations';
    const [{ rows }, allPhotos, projects] = await Promise.all([DB.stockRows(), isLoc ? DB.listLocPhotos() : {}, DB.listProjects()]);
    const photos = allPhotos[name] || [];
    const key = isLoc ? 'location' : 'owner', other = isLoc ? 'owner' : 'location';
    const here = rows.filter(r => r[key] === name);
    const usedIn = projects.filter(p => (p[kind] || []).includes(name) || here.some(r => r.project.id === p.id));
    const onList = NAMES[kind].includes(name);
    setChrome({
      title: name, back: listHash(kind),
      menu: () => menuSheet(name, [
        { label: `Rename ${word}`, run: async () => {
          const v = await textSheet(`Rename ${word}`, { value: name });
          if (!v || v === name) return;
          await DB.renameName(kind, name, v);
          for (const p of projects) {
            const lp = lastPlace.get(p.id);
            if (lp[key] === name) lastPlace.set(p.id, { ...lp, [key]: v });
          }
          toast('Renamed in every project and in History');
          go(listHash(kind, v), true);
        } },
        { label: `Remove ${word}`, danger: true, run: async () => {
          if (!await confirmSheet(`Remove “${name}”?`, `It won't be offered for new entries in any project.${photos.length ? ` Its ${plural(photos.length, 'photo')} will be deleted.` : ''} Stock and History already recorded with it stay as they are.`, 'Remove')) return;
          await DB.removeName(kind, name);
          toast(`Removed ${name}`);
          goBack(listHash(kind));
        } },
      ]),
    });
    // stock here, grouped by project
    const byProj = new Map();
    for (const r of here) { if (!byProj.has(r.project.id)) byProj.set(r.project.id, { project: r.project, rows: [] }); byProj.get(r.project.id).rows.push(r); }
    const groups = [...byProj.values()].sort((a, b) => nameSort(a.project.name, b.project.name));
    for (const g of groups) g.rows.sort((a, b) => nameSort(productName(a.product), productName(b.product)) || nameSort(a[other], b[other]));
    const units = here.reduce((a, r) => a + r.qty, 0);
    const frag = h(`<div>
      ${onList ? '' : `<div class="card banner">“${esc(name)}” is not on the ${word} list any more. Stock recorded with it is shown below.</div>`}
      <div class="card stat-row"><div><b>${units}</b><span>${isLoc ? 'units stored here' : 'units owned'}</span></div>
        <div><b>${new Set(here.map(r => r.product.id)).size}</b><span>products</span></div>
        <div><b>${usedIn.length}</b><span>${usedIn.length === 1 ? 'project' : 'projects'}</span></div></div>
      ${isLoc ? `<h2 class="section">Photos</h2>
        ${photos.length ? `<div class="photo-grid">${photos.map((p, i) => `
          <button class="photo-tile" data-i="${i}"><img alt="" src="${blobUrl(p.photo)}"><span>${esc(p.label || 'Photo')}</span></button>`).join('')}</div>`
        : `<p class="desc">No photos yet. Add photos of the door, the shelves, the area, or anything that helps someone find it.</p>`}
        <button class="btn wide" data-a="photo">+ Add photo</button>
        <input type="file" accept="image/*" capture="environment" id="camInput" hidden>
        <input type="file" accept="image/*" id="libInput" hidden>` : ''}
      <h2 class="section">${isLoc ? 'Stored here' : 'Owned stock'}</h2>
      ${groups.length ? groups.map(g => `
        <div class="sub-head">${esc(g.project.name)}</div>
        <div class="list">${g.rows.map(r => `
          <a class="card row" href="#/i/${r.product.id}">
            ${r.product.photo ? `<img class="thumb" alt="" src="${blobUrl(r.product.photo)}">` : `<div class="thumb">${ICON.box}</div>`}
            <div class="grow"><div class="t">${esc(r.product.partNumber || '—')}</div><div class="s">${esc(r.product.description)}</div>
              <div class="s">${isLoc ? 'Product Owner' : 'Storage Location'}: ${nameHtml(r[other])}</div></div>
            <div class="count"><span class="n">${r.qty}</span><span class="l">${isLoc ? 'here' : 'owned'}</span></div>
          </a>`).join('')}</div>`).join('')
      : `<div class="card banner">Nothing in stock ${isLoc ? 'here' : `for ${esc(name)}`} right now.</div>`}
      ${usedIn.length ? `<p class="desc used-in">Used in: ${usedIn.map(p => `<a href="#/p/${p.id}">${esc(p.name)}</a>`).join(', ')}</p>` : ''}
    </div>`);
    if (isLoc) {
      const cam = frag.getElementById('camInput'), lib = frag.getElementById('libInput');
      const onFile = async (input) => {
        const f = input.files?.[0];
        input.value = '';
        if (!f) return;
        let blob;
        try { blob = await shrinkPhoto(f); } catch { toast('Could not read that photo'); return; }
        const label = await textSheet('Name this photo', { placeholder: 'e.g. Door, Shelves, Area', label: 'Save photo' });
        if (label == null) return;      // cancelled: photo not saved
        await DB.addLocPhoto(name, label || `Photo ${photos.length + 1}`, blob);
        toast('Photo saved'); render();
      };
      cam.onchange = () => onFile(cam);
      lib.onchange = () => onFile(lib);
      frag.querySelector('[data-a=photo]').onclick = () => menuSheet('Add photo', [
        { label: 'Take photo', run: () => cam.click() },
        { label: 'Choose from library', run: () => lib.click() },
      ]);
      frag.querySelectorAll('.photo-tile').forEach(t => t.onclick = () => photoViewer(photos, +t.dataset.i, {
        rename: async (p) => {
          const v = await textSheet('Rename photo', { value: p.label });
          if (v != null && v !== p.label) { await DB.renameLocPhoto(name, p.id, v || p.label); render(); }
        },
        remove: async (p) => {
          if (await confirmSheet(`Delete photo “${p.label}”?`, 'The photo will be deleted from this phone.', 'Delete')) { await DB.removeLocPhoto(name, p.id); render(); }
        },
      }));
    }
    return frag;
  }

  /** Full-screen photos: swipe or tap the arrows to go through them. */
  function photoViewer(photos, start, { rename, remove }) {
    hideToast();
    let i = start;
    const node = h(`<div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div class="viewer-top"><span class="viewer-label"></span><button class="icon-btn" data-a="close" aria-label="Close">✕</button></div>
      <div class="viewer-img"><img alt=""></div>
      <button class="viewer-nav prev" aria-label="Previous photo">‹</button><button class="viewer-nav next" aria-label="Next photo">›</button>
      <div class="viewer-bar"><span class="viewer-n"></span>
        <button class="link-btn" data-a="ren">Rename</button><button class="link-btn danger" data-a="rm">Delete</button></div>
    </div>`);
    const el = node.firstElementChild;
    const src = photos.map(p => URL.createObjectURL(p.photo));
    const img = el.querySelector('img');
    const draw = () => {
      img.src = src[i];
      el.querySelector('.viewer-label').textContent = photos[i].label || 'Photo';
      el.querySelector('.viewer-n').textContent = `${i + 1} of ${photos.length}`;
      el.querySelector('.prev').hidden = i === 0;
      el.querySelector('.next').hidden = i === photos.length - 1;
    };
    const close = () => { el.remove(); src.forEach(u => URL.revokeObjectURL(u)); };
    const step = (d) => { const n = i + d; if (n >= 0 && n < photos.length) { i = n; draw(); } };
    el.querySelector('.prev').onclick = () => step(-1);
    el.querySelector('.next').onclick = () => step(1);
    el.querySelector('[data-a=close]').onclick = close;
    el.querySelector('[data-a=ren]').onclick = () => { const p = photos[i]; close(); rename(p); };
    el.querySelector('[data-a=rm]').onclick = () => { const p = photos[i]; close(); remove(p); };
    let sx = null;
    el.addEventListener('touchstart', (e) => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    $sheetRoot.replaceChildren(el);
    draw();
  }

  /** New project (name + optional product owners), or the owners of an existing one.
   *  Resolves with { name, owners } or null. */
  function projectSheet({ title, name = null, chosen = [], okLabel = 'Save' }) {
    return new Promise((resolve) => {
      const picked = new Set(chosen);
      const all = [...new Set([...NAMES.owners, ...chosen])].sort(nameSort);
      sheet(`<h3>${esc(title)}</h3><form autocomplete="off">
        ${name != null ? `<label class="field"><span>Project name</span><input class="input" name="name" value="${esc(name)}" placeholder="e.g. Main St. renovation" enterkeyhint="next"></label>` : ''}
        <div class="field"><span>Product owners${name != null ? ' (optional)' : ''}</span>
          <small class="hint" style="margin:0 0 8px">Who owns the material on this project. Tap to pick. They show first when you add stock here, and if there's only one, it's filled in for you.</small>
          <div class="chips owner-chips"></div>
          <div class="add-inline"><input class="input" name="newOwner" placeholder="New product owner" enterkeyhint="done">
            <button type="button" class="btn" data-a="addOwner">Add</button></div>
        </div>
        <div class="actions"><button type="button" class="btn" data-a="no">Cancel</button><button class="btn primary">${esc(okLabel)}</button></div></form>`,
        (el, close) => {
          const f = el.querySelector('form'), box = el.querySelector('.owner-chips');
          const draw = () => {
            box.innerHTML = all.length ? all.map(n => `<button type="button" class="chip ${picked.has(n) ? 'on' : ''}" aria-pressed="${picked.has(n)}">${picked.has(n) ? '✓ ' : ''}${esc(n)}</button>`).join('')
              : `<span class="chips-lbl">No product owners yet. Type one below.</span>`;
            box.querySelectorAll('.chip').forEach((c, i) => c.onclick = () => { const n = all[i]; picked.has(n) ? picked.delete(n) : picked.add(n); draw(); });
          };
          const addOwner = () => {
            const v = f.elements.newOwner.value.trim();
            if (!v) return;
            if (!all.includes(v)) { all.push(v); all.sort(nameSort); }
            picked.add(v); f.elements.newOwner.value = ''; draw();
          };
          draw();
          if (f.elements.name) setTimeout(() => f.elements.name.focus(), 50);
          el.querySelector('[data-a=addOwner]').onclick = addOwner;
          f.elements.newOwner.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addOwner(); } };
          el.querySelector('[data-a=no]').onclick = () => { close(); resolve(null); };
          f.onsubmit = (e) => {
            e.preventDefault();
            if (f.elements.newOwner.value.trim()) addOwner();
            const nm = f.elements.name ? f.elements.name.value.trim() : null;
            if (f.elements.name && !nm) { toast('Type a project name'); f.elements.name.focus(); return; }
            close(); resolve({ name: nm, owners: all.filter(n => picked.has(n)) });
          };
        });
    });
  }

  // ---------- backup, restore & export ----------
  // A backup is one JSON file: { app, format, version, build, createdAt, counts, data }.
  // data holds every project, product and entry exactly as stored; photos become
  // data: URLs so the file is self-contained. Nothing leaves the phone unless the
  // user shares or saves the file themselves.
  const BACKUP_APP = 'simple-inventory', BACKUP_FORMAT = 1;
  const REMIND_DAYS = 7;
  const DAY = 86400000;

  const blobToDataUrl = (b) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b);
  });
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u || '');
    if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/jpeg' });
  }
  const fmtSize = (n) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const countsOf = (d) => ({
    projects: d.projects.length, products: d.products.length, entries: d.movements.length,
    photos: d.products.filter(p => p.photo).length + Object.values(d.locPhotos || {}).reduce((a, l) => a + l.length, 0),
  });
  const countsText = (c) => `${plural(c.projects, 'project')}, ${plural(c.products, 'product')}, ${c.entries} History ${c.entries === 1 ? 'entry' : 'entries'} and ${plural(c.photos, 'photo')}`;
  /** "3 days ago" style, for the last backup. */
  function ago(iso) {
    const d = Math.floor((Date.now() - new Date(iso)) / DAY);
    if (d <= 0) return `today, ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  const fmtStamp = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const slug = (s) => (s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').toLowerCase().slice(0, 40) || 'project';

  const backupPrefs = {
    last: () => ls.get('lastBackup'),
    remind: () => ls.get('backupReminder') !== 'off',
    due() {
      if (!this.remind()) return false;
      const snooze = ls.get('backupSnooze');
      if (snooze && Date.now() < +new Date(snooze)) return false;
      const last = this.last();
      return !last || Date.now() - new Date(last) > REMIND_DAYS * DAY;
    },
  };

  async function makeBackupFile() {
    const data = await DB.exportAll();
    const products = [];
    for (const p of data.products) products.push({ ...p, photo: p.photo ? await blobToDataUrl(p.photo) : null });
    const locPhotos = {};
    for (const [n, list] of Object.entries(data.locPhotos || {})) {
      locPhotos[n] = [];
      for (const x of list) locPhotos[n].push({ ...x, photo: await blobToDataUrl(x.photo) });
    }
    const createdAt = new Date().toISOString();
    const out = {
      app: BACKUP_APP, format: BACKUP_FORMAT, version: APP_VERSION, build: APP_BUILD, createdAt,
      counts: countsOf(data), data: {
        projects: data.projects, products, movements: data.movements, people: data.people,
        locations: data.locations, owners: data.owners, locPhotos,
      },
    };
    const file = new File([JSON.stringify(out)], `inventory-backup-${toDateInput()}.json`, { type: 'application/json' });
    return { file, counts: out.counts };
  }

  /** Opens the phone's Share sheet. true = shared, false = cancelled. */
  async function shareFile(file) {
    try { await navigator.share({ files: [file], title: file.name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; throw e; }
  }
  const canShareFile = (file) => { try { return !!navigator.canShare?.({ files: [file] }); } catch { return false; } };
  function saveFile(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  /** The file is ready: Share (when the phone can) or Save to phone. Built first and
   *  shared on a fresh tap, because phones only open the Share sheet straight after a tap. */
  function fileReadySheet(files, { title, desc, onSent }) {
    const share = files.every(canShareFile) && (files.length === 1 || canShareMany(files));
    const size = files.reduce((a, f) => a + f.size, 0);
    sheet(`<h3>${esc(title)}</h3>
      <p class="desc">${desc}</p>
      <div class="file-list">${files.map(f => `<div class="file-name">${esc(f.name)}</div>`).join('')}<div class="muted">${fmtSize(size)}</div></div>
      <div class="menu">
        ${share ? `<button class="btn primary" data-a="share">Share or save…</button>` : ''}
        <button class="btn ${share ? '' : 'primary'}" data-a="save">Save to phone (Downloads)</button>
        <button class="btn ghost" data-a="no">Close</button>
      </div>`,
      (el, close) => {
        el.querySelector('[data-a=no]').onclick = close;
        el.querySelector('[data-a=save]').onclick = () => { files.forEach(saveFile); close(); onSent?.('saved'); };
        const sb = el.querySelector('[data-a=share]');
        if (sb) sb.onclick = async () => {
          try {
            const ok = await (files.length === 1 ? shareFile(files[0]) : navigator.share({ files, title }).then(() => true, e => { if (e.name === 'AbortError') return false; throw e; }));
            if (ok) { close(); onSent?.('shared'); }
          } catch (e) { console.error(e); toast('Could not share. Try Save to phone.'); }
        };
      });
  }
  const canShareMany = (files) => { try { return !!navigator.canShare?.({ files }); } catch { return false; } };

  async function backupNow() {
    sheet(`<h3>Back up</h3><p class="desc">Preparing your backup…</p>`);
    let made;
    try { made = await makeBackupFile(); }
    catch (e) { console.error(e); $sheetRoot.replaceChildren(); toast('Could not make the backup'); return; }
    fileReadySheet([made.file], {
      title: 'Backup ready',
      desc: `Holds ${esc(countsText(made.counts))}. Keep it somewhere off this phone, like Google Drive, iCloud Drive or an email to yourself.`,
      onSent: () => {
        ls.set('lastBackup', new Date().toISOString());
        toast('Backup saved');
        render();
      },
    });
  }

  /** Reads a backup file. Throws with a message for the user if it isn't one. */
  async function readBackup(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw new Error("This isn't a Simple Inventory backup file."); }
    if (!obj || obj.app !== BACKUP_APP || !obj.data) throw new Error("This isn't a Simple Inventory backup file.");
    if (obj.format > BACKUP_FORMAT || obj.build > APP_BUILD) throw new Error(`This backup was made by a newer version (${obj.version} build ${obj.build}). Update the app first: close it fully and open it again.`);
    const { projects, products, movements, people, locations, owners, locPhotos } = obj.data;
    const ok = Array.isArray(projects) && Array.isArray(products) && Array.isArray(movements)
      && projects.every(p => p && p.id && typeof p.name === 'string')
      && products.every(p => p && p.id && p.projectId)
      && movements.every(m => m && m.id && m.productId && typeof m.at === 'string' && typeof m.delta === 'number');
    if (!ok) throw new Error('This backup file is damaged or incomplete, so nothing was changed.');
    const data = {
      projects,
      products: products.map(p => ({ ...p, photo: typeof p.photo === 'string' ? dataUrlToBlob(p.photo) : null })),
      movements,
    };
    if (Array.isArray(people)) data.people = people.filter(n => typeof n === 'string');
    // 1.10: app-wide storage locations and product owners, and location photos
    if (Array.isArray(locations)) data.locations = locations.filter(n => typeof n === 'string');
    if (Array.isArray(owners)) data.owners = owners.filter(n => typeof n === 'string');
    if (locPhotos && typeof locPhotos === 'object') {
      data.locPhotos = {};
      for (const [n, list] of Object.entries(locPhotos)) {
        const ok = (Array.isArray(list) ? list : []).filter(x => x && typeof x.photo === 'string')
          .map(x => ({ id: x.id || String(Math.random()).slice(2), label: String(x.label || 'Photo'), at: x.at, photo: dataUrlToBlob(x.photo) }))
          .filter(x => x.photo);
        if (ok.length) data.locPhotos[n] = ok;
      }
    }
    return { createdAt: obj.createdAt, version: obj.version, build: obj.build, data, counts: countsOf(data) };
  }

  function restorePick() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      let b;
      try { b = await readBackup(file); }
      catch (e) { sheet(`<h3>Can't restore</h3><p class="desc">${esc(e.message)}</p><div class="menu"><button class="btn" data-a="ok">OK</button></div>`, (el, close) => { el.querySelector('[data-a=ok]').onclick = close; }); return; }
      const cur = countsOf(await DB.exportAll());
      sheet(`<h3>Restore this backup?</h3>
        <dl class="entry">
          <dt>Made</dt><dd>${b.createdAt ? esc(fmtStamp(b.createdAt)) : 'Unknown'}</dd>
          <dt>App</dt><dd>Version ${esc(b.version)} · Build ${esc(b.build)}</dd>
          <dt>Holds</dt><dd>${esc(countsText(b.counts))}</dd>
        </dl>
        <p class="desc warn-box"><b>Everything on this phone will be replaced</b> (now ${esc(countsText(cur))}). A safety copy of it is kept, so you can undo this from Settings.</p>
        <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn out" data-a="ok">Replace</button></div>`,
        (el, close) => {
          el.querySelector('[data-a=no]').onclick = close;
          el.querySelector('[data-a=ok]').onclick = async () => {
            close();
            try { await DB.replaceAll(b.data); }
            catch (e) { console.error(e); toast('Restore failed. Nothing was changed.'); return; }
            toast('Backup restored');
            go('#/');
          };
        });
    };
    inp.click();
  }

  /** What the safety copy was kept for: 'restore' or 'delete'. */
  const safeWord = (safe) => safe?.reason === 'delete' || safe?.reason === 'deleteAll' ? 'delete' : 'restore';

  async function undoRestore() {
    const safe = await DB.beforeRestore();
    if (!safe) return;
    const w = safeWord(safe);
    const c = countsOf(safe.data);
    if (!await confirmSheet(`Undo the ${w}?`, `This puts back what was on this phone before the ${w} on ${fmtStamp(safe.savedAt)}: ${countsText(c)}. Everything there now will be replaced.`, `Undo ${w}`)) return;
    try { await DB.replaceAll(safe.data, { undo: true }); }
    catch (e) { console.error(e); toast('Could not undo. Nothing was changed.'); return; }
    toast(w === 'delete' ? 'Delete undone' : 'Restore undone');
    if (/^#?\/?$/.test(location.hash)) render(); else go('#/'); // the toast's Undo can run on the Inventory screen
  }

  // ---------- delete projects / delete all (1.5) ----------
  // Both keep a safety copy first (see DB.deleteProjects / DB.deleteAll), so the
  // "Undo last delete" row in Settings and the toast's Undo can put everything back.
  const backupLine = () => {
    const last = backupPrefs.last();
    return last ? `Last backup: ${esc(ago(last))}` : 'You have never made a backup';
  };

  async function viewDeleteProjects() {
    setChrome({ title: 'Delete projects', back: '#/settings' });
    const projects = await DB.listProjects();
    if (!projects.length) return h(`<div class="empty">${ICON.box}<b>No projects</b>There is nothing to delete.</div>`);
    const frag = h(`<div class="del-page">
      <p class="desc">Tick the projects to delete. Their products, photos and History go with them. Storage locations, product owners and team members stay on the Lists tab.</p>
      <div class="sel-bar"><span data-a="count">None selected</span><button type="button" class="link-btn" data-a="all">Select all</button></div>
      <div class="list">${projects.map(p => `
        <label class="card row check-row">
          <input type="checkbox" class="check" value="${esc(p.id)}">
          <div class="grow"><div class="t">${esc(p.name)}</div>
            <div class="s">${plural(p.items, 'product')} · ${plural(p.units, 'unit')} in stock</div></div>
        </label>`).join('')}</div>
      <div class="del-bar"><button class="btn out wide" data-a="del" disabled>Delete selected</button></div>
    </div>`);
    const boxes = [...frag.querySelectorAll('.check')];
    const $count = frag.querySelector('[data-a=count]');
    const $all = frag.querySelector('[data-a=all]');
    const $del = frag.querySelector('[data-a=del]');
    const picked = () => boxes.filter(b => b.checked).map(b => b.value);
    const update = () => {
      const n = picked().length;
      $count.textContent = n ? `${plural(n, 'project')} selected` : 'None selected';
      $all.textContent = n === boxes.length ? 'Clear all' : 'Select all';
      $del.disabled = !n;
      $del.textContent = n ? `Delete ${plural(n, 'project')}` : 'Delete selected';
      boxes.forEach(b => b.closest('.check-row').classList.toggle('on', b.checked));
    };
    boxes.forEach(b => b.onchange = update);
    $all.onclick = () => { const on = picked().length !== boxes.length; boxes.forEach(b => b.checked = on); update(); };
    $del.onclick = () => deleteProjectsSheet(picked());
    return frag;
  }

  async function viewDeleteItems() {
    setChrome({ title: 'Delete inventory', back: '#/settings' });
    const projects = (await DB.listProjects()).filter(p => p.items);
    if (!projects.length) return h(`<div class="empty">${ICON.box}<b>No inventory</b>There are no products to delete.</div>`);
    const nat = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
    const groups = await Promise.all(projects.map(async p => ({ p,
      items: (await DB.listProducts(p.id)).sort((a, b) => nat(a.partNumber, b.partNumber) || nat(a.description, b.description)) })));
    const frag = h(`<div>
      <p class="desc">Tick the products to delete. Their photos and History go with them. The projects and the Lists stay.</p>
      <div class="sel-bar"><span data-a="count">None selected</span></div>
      ${groups.map(({ p, items }) => `<div class="del-group" data-p="${esc(p.id)}">
        <div class="sel-bar group-head"><h2 class="section">${esc(p.name)}</h2><button type="button" class="link-btn" data-a="grp">Select all</button></div>
        <div class="list">${items.map(it => `
          <label class="card row check-row">
            <input type="checkbox" class="check" value="${esc(it.id)}">
            ${it.photo ? `<img class="thumb" alt="" src="${blobUrl(it.photo)}">` : `<div class="thumb">${ICON.box}</div>`}
            <div class="grow"><div class="t">${esc(it.partNumber || 'No part number')}</div>
              <div class="s">${esc(it.description || '')}${it.description ? ' · ' : ''}${it.stock} in stock</div></div>
          </label>`).join('')}</div>
      </div>`).join('')}
      <div class="del-bar"><button class="btn out wide" data-a="del" disabled>Delete selected</button></div>
    </div>`);
    const boxes = [...frag.querySelectorAll('.check')];
    const $count = frag.querySelector('[data-a=count]');
    const $del = frag.querySelector('[data-a=del]');
    const picked = () => boxes.filter(b => b.checked).map(b => b.value);
    const update = () => {
      const n = picked().length;
      $count.textContent = n ? `${plural(n, 'product')} selected` : 'None selected';
      $del.disabled = !n;
      $del.textContent = n ? `Delete ${plural(n, 'product')}` : 'Delete selected';
      boxes.forEach(b => b.closest('.check-row').classList.toggle('on', b.checked));
      groupEls.forEach(g => {
        const gb = [...g.querySelectorAll('.check')];
        g.querySelector('[data-a=grp]').textContent = gb.every(b => b.checked) ? 'Clear all' : 'Select all';
      });
    };
    const groupEls = [...frag.querySelectorAll('.del-group')];
    groupEls.forEach(g => {
      g.querySelector('[data-a=grp]').onclick = () => {
        const gb = [...g.querySelectorAll('.check')];
        const on = !gb.every(b => b.checked);
        gb.forEach(b => b.checked = on); update();
      };
    });
    boxes.forEach(b => b.onchange = update);
    $del.onclick = () => deleteItemsSheet(picked());
    return frag;
  }

  async function deleteItemsSheet(ids) {
    if (!ids.length) return;
    const data = await DB.exportAll();
    const drop = new Set(ids);
    const items = data.products.filter(p => drop.has(p.id));
    const pName = Object.fromEntries(data.projects.map(p => [p.id, p.name]));
    const entries = data.movements.filter(m => drop.has(m.productId)).length;
    const photos = items.filter(p => p.photo).length;
    const units = items.reduce((a, p) => a + p.stock, 0);
    const n = items.length;
    const shown = items.slice(0, 8);
    sheet(`<h3>Delete ${n === 1 ? 'this product' : `these ${n} products`}?</h3>
      <div class="file-list">${shown.map(p => `<div><span class="file-name">${esc(p.partNumber || 'No part number')}</span> · ${esc(pName[p.projectId] || '')}</div>`).join('')}${n > shown.length ? `<div>and ${n - shown.length} more</div>` : ''}</div>
      <p class="desc warn-box">This deletes ${esc(plural(n, 'product'))} (${esc(plural(units, 'unit'))} in stock), ${entries} History ${entries === 1 ? 'entry' : 'entries'} and ${esc(plural(photos, 'photo'))} from this phone. The projects stay. A safety copy is kept, so you can undo this from Settings.</p>
      <button class="btn wide" data-a="backup">Back up first</button>
      <p class="desc hint">${backupLine()}</p>
      <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn out" data-a="ok">Delete</button></div>`,
      (el, close) => {
        el.querySelector('[data-a=no]').onclick = close;
        el.querySelector('[data-a=backup]').onclick = backupNow;
        el.querySelector('[data-a=ok]').onclick = async () => {
          close();
          try { await DB.deleteProducts(ids); }
          catch (e) { console.error(e); toast('Could not delete. Nothing was changed.'); return; }
          go('#/settings', true);
          toast(n === 1 ? 'Product deleted' : `${n} products deleted`, [{ label: 'Undo', run: undoRestore }]);
        };
      });
  }

  async function deleteProjectsSheet(ids) {
    if (!ids.length) return;
    const data = await DB.exportAll();
    const drop = new Set(ids);
    const gone = countsOf({
      projects: data.projects.filter(p => drop.has(p.id)),
      products: data.products.filter(p => drop.has(p.projectId)),
      movements: data.movements.filter(m => drop.has(m.projectId)),
    });
    const names = data.projects.filter(p => drop.has(p.id)).map(p => p.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const n = names.length;
    sheet(`<h3>Delete ${n === 1 ? 'this project' : `these ${n} projects`}?</h3>
      <div class="file-list">${names.map(x => `<div class="file-name">${esc(x)}</div>`).join('')}</div>
      <p class="desc warn-box">This deletes ${esc(countsText(gone))} from this phone. A safety copy is kept, so you can undo this from Settings.</p>
      <button class="btn wide" data-a="backup">Back up first</button>
      <p class="desc hint">${backupLine()}</p>
      <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn out" data-a="ok">Delete</button></div>`,
      (el, close) => {
        el.querySelector('[data-a=no]').onclick = close;
        el.querySelector('[data-a=backup]').onclick = backupNow;
        el.querySelector('[data-a=ok]').onclick = async () => {
          close();
          try { await DB.deleteProjects(ids); }
          catch (e) { console.error(e); toast('Could not delete. Nothing was changed.'); return; }
          go('#/settings', true);
          toast(n === 1 ? 'Project deleted' : `${n} projects deleted`, [{ label: 'Undo', run: undoRestore }]);
        };
      });
  }

  async function deleteAllSheet() {
    const cur = countsOf(await DB.exportAll());
    if (!cur.projects && !cur.products && !cur.entries) { toast('There is no data to delete'); return; }
    sheet(`<h3>Delete all data?</h3>
      <p class="desc warn-box"><b>Everything on this phone will be erased:</b> ${esc(countsText(cur))}. Your settings, like the backup reminder, stay. A safety copy is kept, so you can undo this from Settings.</p>
      <button class="btn wide" data-a="backup">Back up first</button>
      <p class="desc hint">${backupLine()}</p>
      <form>
        <label class="desc" for="wipe-word">Type <b>DELETE</b> to confirm</label>
        <input class="input" id="wipe-word" name="v" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">
        <div class="actions"><button type="button" class="btn" data-a="no">Cancel</button><button class="btn out" data-a="ok" disabled>Delete all</button></div>
      </form>`,
      (el, close) => {
        const f = el.querySelector('form');
        const ok = el.querySelector('[data-a=ok]');
        const typed = () => f.elements.v.value.trim().toUpperCase() === 'DELETE';
        f.elements.v.oninput = () => { ok.disabled = !typed(); };
        el.querySelector('[data-a=no]').onclick = close;
        el.querySelector('[data-a=backup]').onclick = backupNow;
        f.onsubmit = async (e) => {
          e.preventDefault();
          if (!typed()) return;
          close();
          try { await DB.deleteAll(); }
          catch (e2) { console.error(e2); toast('Could not delete. Nothing was changed.'); return; }
          go('#/');
          toast('All data deleted', [{ label: 'Undo', run: undoRestore }]);
        };
      });
  }

  // CSV: opens in Excel, Google Sheets or Numbers. UTF-8 with a BOM so Excel reads
  // accents correctly. Text starting with = + - @ gets a leading ' so spreadsheets
  // don't treat it as a formula.
  const csvCell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvFile = (name, rows) => new File(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'], name, { type: 'text/csv' });
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const orName = (n) => n || NOT_SET;
  const kindWord = (m) => m.kind === 'count' ? 'Count correction' : m.kind === 'move' ? 'Moved' : m.delta > 0 ? 'Added' : 'Removed';

  async function makeCsvFiles(projectId, which) {
    const data = await DB.exportAll();
    const projects = data.projects.filter(p => !projectId || p.id === projectId);
    const pName = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const nat = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
    const products = data.products.filter(p => pName[p.projectId] != null)
      .sort((a, b) => nat(pName[a.projectId], pName[b.projectId]) || nat(a.partNumber, b.partNumber) || nat(a.description, b.description));
    const byProduct = {};
    for (const m of data.movements) (byProduct[m.productId] ||= []).push(m);
    const chrono = (a, b) => a.at.localeCompare(b.at) || a.createdAt.localeCompare(b.createdAt);
    const tag = projectId ? slug(pName[projectId]) : 'all-projects';
    const files = [];

    if (which !== 'history') {
      const rows = [['Project', 'Part number', 'Description', 'Storage Location', 'Product Owner', 'Quantity', 'Product total', 'Low-stock warning at', 'Low']];
      for (const p of products) {
        const moves = byProduct[p.id] || [];
        const total = moves.reduce((a, m) => a + m.delta, 0);
        const low = DB.isLow({ ...p, stock: total }) ? 'Yes' : '';
        const buckets = DB.bucketsOf(moves).filter(b => b.qty !== 0);
        const base = [pName[p.projectId], p.partNumber || '', p.description || ''];
        const tail = [total, p.lowStockAt ?? '', low];
        if (!buckets.length) rows.push([...base, '', '', 0, ...tail]);
        for (const b of buckets) rows.push([...base, orName(b.location), orName(b.owner), b.qty, ...tail]);
      }
      files.push(csvFile(`inventory-stock-${tag}-${toDateInput()}.csv`, rows));
    }
    if (which !== 'stock') {
      const rows = [['Date', 'Time', 'Project', 'Part number', 'Description', 'Type', 'Quantity', 'Storage Location', 'Product Owner', 'Moved to storage location', 'Moved to product owner', 'Team Member', 'Product total after', 'Note', 'Edited']];
      const all = [];
      for (const p of products) {
        let run = 0;
        for (const m of (byProduct[p.id] || []).slice().sort(chrono)) { run += m.delta; all.push({ m, p, after: run }); }
      }
      all.sort((a, b) => chrono(a.m, b.m));
      for (const { m, p, after } of all) {
        const d = new Date(m.at);
        const mv = m.kind === 'move';
        rows.push([toDateInput(d), m.dateOnly ? '' : hhmm(d), pName[p.projectId], p.partNumber || '', p.description || '',
          kindWord(m), mv ? m.qty : m.delta, orName(m.location), orName(m.owner),
          mv ? orName(m.toLocation) : '', mv ? orName(m.toOwner) : '', orName(m.person), after, m.note || '', m.edits?.length ? 'Yes' : '']);
      }
      files.push(csvFile(`inventory-history-${tag}-${toDateInput()}.csv`, rows));
    }
    return { files, products: products.length };
  }

  async function exportSheet(projectId = '') {
    const projects = await DB.listProjects();
    if (!projects.length) { toast('No projects to export yet'); return; }
    sheet(`<h3>Export to spreadsheet</h3>
      <p class="desc">Makes CSV files that open in Excel, Google Sheets or Numbers.</p>
      <form>
        <label class="field"><span>Project</span>
          <select class="input" name="proj">
            <option value="">All projects</option>
            ${projects.map(p => `<option value="${esc(p.id)}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></label>
        <div class="field"><span>What to export</span>
          <label class="radio"><input type="radio" name="which" value="both" checked><span><b>Stock and History</b> (2 files)</span></label>
          <label class="radio"><input type="radio" name="which" value="stock"><span><b>Stock list</b>: what's in stock now, one row per storage location and product owner</span></label>
          <label class="radio"><input type="radio" name="which" value="history"><span><b>History</b>: every add, remove, move and count, with notes</span></label>
        </div>
        <div class="actions"><button type="button" class="btn" data-a="no">Cancel</button><button class="btn primary">Create</button></div>
      </form>`,
      (el, close) => {
        el.querySelector('[data-a=no]').onclick = close;
        const f = el.querySelector('form');
        f.onsubmit = async (e) => {
          e.preventDefault();
          let made;
          try { made = await makeCsvFiles(f.elements.proj.value, f.elements.which.value); }
          catch (err) { console.error(err); toast('Could not make the file'); return; }
          const pn = projects.find(p => p.id === f.elements.proj.value)?.name;
          fileReadySheet(made.files, {
            title: made.files.length > 1 ? 'Files ready' : 'File ready',
            desc: `${esc(pn || 'All projects')}: ${plural(made.products, 'product')}.`,
            onSent: (how) => toast(how === 'saved' ? 'Saved to Downloads' : 'Shared'),
          });
        };
      });
  }

  // ---------- reports (1.6) ----------
  // A report covers a date range (inclusive, by the phone's local date) for one project
  // or all, optionally narrowed to one location, owner, person or product. Each entry is
  // split into "legs" per place: a move is a leg out of one place and a leg into another,
  // so totals per location/owner come out right. Start = stock before the first day,
  // End = stock at the end of the last day (for the places picked).
  const ALL = '__all';
  const PERIODS = [
    ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'],
    ['lastmonth', 'Last month'], ['30', 'Last 30 days'], ['custom', 'Custom'],
  ];
  const repState = (() => {
    let saved = {};
    try { saved = JSON.parse(ss.get('report')) || {}; } catch {}
    return { proj: '', period: 'month', from: '', to: '', loc: ALL, own: ALL, who: ALL, prod: ALL, ...saved };
  })();
  const saveRep = () => ss.set('report', JSON.stringify(repState));

  function periodRange(key) {
    const t = new Date(); t.setHours(12, 0, 0, 0);
    const day = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const monday = day(t, -((t.getDay() + 6) % 7));
    switch (key) {
      case 'week': return [toDateInput(monday), toDateInput(t)];
      case 'lastweek': return [toDateInput(day(monday, -7)), toDateInput(day(monday, -1))];
      case 'lastmonth': return [toDateInput(new Date(t.getFullYear(), t.getMonth() - 1, 1, 12)), toDateInput(new Date(t.getFullYear(), t.getMonth(), 0, 12))];
      case '30': return [toDateInput(day(t, -29)), toDateInput(t)];
      default: return [toDateInput(new Date(t.getFullYear(), t.getMonth(), 1, 12)), toDateInput(t)];
    }
  }
  const fmtDay = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  const legsOf = (m) => m.kind === 'move'
    ? [{ l: m.location || '', o: m.owner || '', q: -m.qty, type: 'moveOut' }, { l: m.toLocation || '', o: m.toOwner || '', q: m.qty, type: 'moveIn' }]
    : [{ l: m.location || '', o: m.owner || '', q: m.delta, type: m.kind === 'count' ? 'count' : m.delta > 0 ? 'in' : 'out' }];
  const newAcc = () => ({ start: 0, added: 0, used: 0, count: 0, movedIn: 0, movedOut: 0, end: 0, entries: 0, lastUsed: null, _e: new Set() });
  function addLeg(a, leg, m) {
    if (leg.type === 'in') a.added += leg.q;
    else if (leg.type === 'out') { a.used -= leg.q; if (!a.lastUsed || m.at > a.lastUsed.at) a.lastUsed = m; }
    else if (leg.type === 'count') a.count += leg.q;
    else if (leg.type === 'moveIn') a.movedIn += leg.q;
    else a.movedOut -= leg.q;
    a._e.add(m.id); a.entries = a._e.size;
  }

  /** Builds the report from all data. Returns everything the screen and the CSV need. */
  async function buildReport(st) {
    const data = await DB.exportAll();
    const nat = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
    const projects = data.projects.filter(p => !st.proj || p.id === st.proj);
    const pName = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const allProducts = data.products.filter(p => pName[p.projectId] != null)
      .sort((a, b) => nat(pName[a.projectId], pName[b.projectId]) || nat(a.partNumber, b.partNumber) || nat(a.description, b.description));
    const products = allProducts.filter(p => st.prod === ALL || p.id === st.prod);
    const pById = Object.fromEntries(products.map(p => [p.id, p]));
    const moves = data.movements.filter(m => pById[m.productId])
      .sort((a, b) => a.at.localeCompare(b.at) || a.createdAt.localeCompare(b.createdAt));
    // pick lists for the filters, from the projects in scope and their entries
    const lists = { locations: new Set(), owners: new Set(), people: new Set(data.people || []) };
    for (const p of projects) { (p.locations || []).forEach(n => lists.locations.add(n)); (p.owners || []).forEach(n => lists.owners.add(n)); }
    for (const m of data.movements) if (pName[m.projectId] != null) {
      for (const g of legsOf(m)) { lists.locations.add(g.l); lists.owners.add(g.o); }
      lists.people.add(m.person || '');
    }

    const { from, to } = st;
    const placeOk = (g) => (st.loc === ALL || g.l === st.loc) && (st.own === ALL || g.o === st.own);
    const whoOk = (m) => st.who === ALL || (m.person || '') === st.who;
    const total = newAcc(), byProd = new Map(), byLoc = new Map(), byOwn = new Map(), byWho = new Map(), byNote = new Map();
    const acc = (map, k) => { if (!map.has(k)) map.set(k, newAcc()); return map.get(k); };
    const entries = [];
    for (const m of moves) {
      const d = toDateInput(new Date(m.at));
      if (d > to) continue;
      const legs = legsOf(m).filter(placeOk);
      if (!legs.length) continue;
      const inRange = d >= from && whoOk(m);
      for (const g of legs) {
        const targets = [total, acc(byProd, m.productId), acc(byLoc, g.l), acc(byOwn, g.o)];
        for (const a of targets) { a.end += g.q; if (d < from) a.start += g.q; }
        if (!inRange) continue;
        for (const a of targets) addLeg(a, g, m);
        addLeg(acc(byWho, m.person || ''), g, m);
        if (m.note) addLeg(acc(byNote, m.note.trim()), g, m);
      }
      if (inRange) entries.push(m);
    }
    // keep rows that had activity, or hold stock (unless a person filter is on)
    const keep = (a) => a.entries > 0 || (st.who === ALL && (a.start || a.end));
    const sortNames = (map) => [...map].filter(([, a]) => keep(a)).sort((x, y) => (x[0] === '') - (y[0] === '') || nat(x[0], y[0]));
    return {
      pName, pById, products, allProducts, lists, entries: entries.reverse(), total,
      byProd: products.filter(p => byProd.has(p.id) && keep(byProd.get(p.id))).map(p => [p, byProd.get(p.id)]),
      byLoc: sortNames(byLoc), byOwn: sortNames(byOwn),
      byWho: [...byWho].filter(([, a]) => a.entries).sort((x, y) => (x[0] === '') - (y[0] === '') || nat(x[0], y[0])),
      byNote: [...byNote].sort((x, y) => (y[1].used - x[1].used) || (y[1].added - x[1].added) || nat(x[0], y[0])),
    };
  }

  const nEntries = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
  const numCell = (lbl, n, cls = '') => `<div class="${cls}"><span>${lbl}</span><b>${n}</b></div>`;
  const plusN = (n) => n ? `+${n}` : '0';
  const minusN = (n) => n ? `−${n}` : '0';
  /** Count corrections and moves under the numbers. split: show moves in and out
   *  separately (locations and owners); otherwise a move inside the group is one line. */
  function extrasHtml(a, split = false) {
    const x = [];
    if (a.count) x.push(`Count corrections ${signed(a.count)}`);
    if (!split && a.movedIn && a.movedIn === a.movedOut) x.push(`Moved ${a.movedIn} between places`);
    else {
      if (a.movedIn) x.push(`Moved in ${a.movedIn}`);
      if (a.movedOut) x.push(`Moved out ${a.movedOut}`);
    }
    return x.length ? `<div class="rg-extra">${x.join(' · ')}</div>` : '';
  }
  function groupHtml(name, a, { showStock, sub = '', last = false, split = false }) {
    return `<div class="card rgroup">
      <div class="rg-name">${name}</div>${sub ? `<div class="rg-sub">${sub}</div>` : ''}
      <div class="rnums ${showStock ? '' : 'two'}">
        ${showStock ? numCell('Start', a.start) : ''}
        ${numCell('Added', plusN(a.added), a.added ? 'in' : '')}
        ${numCell('Used', minusN(a.used), a.used ? 'out' : '')}
        ${showStock ? numCell('End', a.end) : ''}
      </div>
      ${extrasHtml(a, split)}
      ${last && a.lastUsed ? `<div class="rg-extra">Last used ${esc(fmtWhen(a.lastUsed.at, a.lastUsed.dateOnly))}</div>` : ''}
    </div>`;
  }

  const setPreview = (on) => document.documentElement.classList.toggle('previewing', on);

  async function viewReports() {
    setChrome({ title: 'Reports' });
    const projects = await DB.listProjects();
    if (!projects.length) return h(`<div class="empty"><b>Nothing to report yet</b>Create a project and add some stock first.</div>`);
    const st = repState;
    if (st.proj && !projects.some(p => p.id === st.proj)) st.proj = '';
    if (st.period !== 'custom' || !st.from || !st.to) [st.from, st.to] = periodRange(st.period === 'custom' ? 'month' : st.period);
    if (st.from > st.to) [st.from, st.to] = [st.to, st.from];
    let r = await buildReport(st);
    // a filter whose name no longer exists in this scope goes back to All
    let reset = false;
    for (const [k, list] of [['loc', r.lists.locations], ['own', r.lists.owners], ['who', r.lists.people]]) if (st[k] !== ALL && !list.has(st[k])) { st[k] = ALL; reset = true; }
    if (st.prod !== ALL && !r.allProducts.some(p => p.id === st.prod)) { st.prod = ALL; reset = true; }
    if (reset) r = await buildReport(st);
    saveRep();

    const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const opts = (set, cur) => [...set].sort((a, b) => (a === '') - (b === '') || nat(a, b))
      .map(n => `<option value="${esc(n)}" ${cur === n ? 'selected' : ''}>${esc(n || NOT_SET)}</option>`).join('');
    const sel = (name, label, inner, cur) => `<label class="field"><span>${label}</span>
      <select class="input" name="${name}"><option value="${ALL}" ${cur === ALL ? 'selected' : ''}>All</option>${inner}</select></label>`;
    const projLabel = st.proj ? r.pName[st.proj] : 'All projects';
    const filterBits = [
      st.loc !== ALL && `Storage Location: ${st.loc || NOT_SET}`, st.own !== ALL && `Product Owner: ${st.own || NOT_SET}`,
      st.who !== ALL && `Team Member: ${st.who || NOT_SET}`, st.prod !== ALL && `Product: ${productName(r.pById[st.prod] || {})}`,
    ].filter(Boolean);
    const showStock = st.who === ALL;
    const t = r.total;
    const many = !st.proj;
    const prodName = (p) => `${esc(productName(p))}${p.partNumber && p.description ? ` <span class="muted">${esc(p.description)}</span>` : ''}`;

    const frag = h(`<div class="report">
      <form class="card rfilters no-print" autocomplete="off">
        <label class="field"><span>Project</span>
          <select class="input" name="proj"><option value="">All projects</option>
            ${projects.map(p => `<option value="${esc(p.id)}" ${p.id === st.proj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select></label>
        <div class="field"><span>Dates</span>
          <div class="chips periods">${PERIODS.map(([k, l]) => `<button type="button" class="chip ${st.period === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
          <div class="daterow">
            <input class="input" type="date" name="from" value="${st.from}" max="${toDateInput()}" aria-label="From">
            <span class="muted">to</span>
            <input class="input" type="date" name="to" value="${st.to}" max="${toDateInput()}" aria-label="To">
          </div>
        </div>
        <details class="more-filters" ${filterBits.length ? 'open' : ''}>
          <summary>Filters${filterBits.length ? ` (${filterBits.length})` : ''}</summary>
          ${sel('loc', 'Storage Location', opts(r.lists.locations, st.loc), st.loc)}
          ${sel('own', 'Product Owner', opts(r.lists.owners, st.own), st.own)}
          ${sel('who', 'Team Member', opts(r.lists.people, st.who), st.who)}
          ${sel('prod', 'Product', r.allProducts.map(p => `<option value="${esc(p.id)}" ${st.prod === p.id ? 'selected' : ''}>${esc(productName(p))}${many ? ` (${esc(r.pName[p.projectId])})` : ''}</option>`).join(''), st.prod)}
          ${filterBits.length ? `<button type="button" class="link-btn" data-a="clear">Clear filters</button>` : ''}
        </details>
      </form>
      <button class="btn primary wide no-print" data-a="preview" style="margin-top:4px">Preview report</button>
      <div class="actions no-print">
        <button class="btn" data-a="pdf">Print / save PDF</button>
        <button class="btn" data-a="csv">Share spreadsheet</button>
      </div>
      <div class="preview-bar">
        <div class="pv-lbl">Preview: this is how the PDF and printout will look</div>
        <div class="actions">
          <button class="btn" data-a="close-preview">Close</button>
          <button class="btn primary" data-a="pdf">Print / save PDF</button>
        </div>
      </div>

      <div class="report-head">
        <div class="rh-title">Inventory report · ${esc(projLabel)}</div>
        <div class="rh-sub">${esc(fmtDay(st.from))} to ${esc(fmtDay(st.to))}${filterBits.length ? ` · ${esc(filterBits.join(' · '))}` : ''}</div>
        <div class="rh-sub print-only">Made ${esc(fmtStamp(new Date().toISOString()))} with Simple Inventory</div>
      </div>

      <h2 class="section">Totals</h2>
      <div class="card rgroup totals">
        <div class="rnums ${showStock ? '' : 'two'}">
          ${showStock ? numCell('Start', t.start) : ''}
          ${numCell('Added', plusN(t.added), t.added ? 'in' : '')}
          ${numCell('Used', minusN(t.used), t.used ? 'out' : '')}
          ${showStock ? numCell('End', t.end) : ''}
        </div>
        ${extrasHtml(t)}
        <div class="rg-extra">${nEntries(t.entries)} · ${plural(r.byProd.length, 'product')}</div>
      </div>
      ${showStock ? '' : `<p class="hint">Start and end stock are left out while a team member is picked, because stock isn't owned by a team member.</p>`}

      ${t.entries || r.byProd.length ? `
      <h2 class="section">By product</h2>
      <div class="list">${r.byProd.map(([p, a]) => groupHtml(prodName(p), a, { showStock, sub: many ? esc(r.pName[p.projectId]) : '', last: true })).join('')}</div>

      <h2 class="section">By storage location</h2>
      <div class="list">${r.byLoc.map(([n, a]) => groupHtml(nameHtml(n), a, { showStock, split: true })).join('')}</div>

      <h2 class="section">By product owner</h2>
      <div class="list">${r.byOwn.map(([n, a]) => groupHtml(nameHtml(n), a, { showStock, split: true })).join('')}</div>

      <h2 class="section">By team member</h2>
      ${r.byWho.length ? `<div class="list">${r.byWho.map(([n, a]) => groupHtml(nameHtml(n), a, { showStock: false, sub: nEntries(a.entries) })).join('')}</div>`
        : `<div class="card banner">No entries in these dates.</div>`}

      <h2 class="section">By note</h2>
      ${r.byNote.length ? `<div class="card rtable"><div class="rt-row rt-head"><span>Note</span><span>Added</span><span>Used</span></div>
        ${r.byNote.map(([n, a]) => `<div class="rt-row"><span>${esc(n)}</span><span class="in-txt">${plusN(a.added)}</span><span class="out-txt">${minusN(a.used)}</span></div>`).join('')}</div>`
        : `<div class="card banner">No notes on entries in these dates.</div>`}

      <h2 class="section">Every entry (${r.entries.length})</h2>
      ${r.entries.length ? `<ul class="card hist rentries">${r.entries.map(m => {
        const p = r.pById[m.productId];
        const mv = m.kind === 'move';
        return `<li>
          <div class="d ${mv ? 'mv' : m.delta > 0 ? 'in' : 'out'}">${mv ? `⇄${m.qty}` : signed(m.delta)}</div>
          <div style="flex:1;min-width:0">
            <div class="what">${moveLabel(m)} ${mv ? m.qty : Math.abs(m.delta)} · ${esc(productName(p))}</div>
            <div class="when">${esc(fmtWhen(m.at, m.dateOnly))}${many ? ` · ${esc(r.pName[m.projectId])}` : ''}</div>
            <div class="where">${entryPlaceHtml(m)}</div>
            <div class="who">By ${nameHtml(m.person)}</div>
            ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
          </div>
        </li>`;
      }).join('')}</ul>` : `<div class="card banner">No entries in these dates.</div>`}`
      : `<div class="card empty" style="padding:24px">Nothing was added, used or in stock for these dates and filters.</div>`}
    </div>`);

    const f = frag.querySelector('form');
    const redo = () => { saveRep(); render(); };
    f.elements.proj.onchange = () => { st.proj = f.elements.proj.value; st.prod = ALL; redo(); };
    frag.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      st.period = b.dataset.p;
      if (st.period !== 'custom') [st.from, st.to] = periodRange(st.period);
      redo();
    });
    for (const k of ['from', 'to']) f.elements[k].onchange = () => {
      if (!f.elements[k].value) return;
      st[k] = f.elements[k].value; st.period = 'custom'; redo();
    };
    for (const k of ['loc', 'own', 'who', 'prod']) f.elements[k].onchange = () => { st[k] = f.elements[k].value; redo(); };
    const clr = f.querySelector('[data-a=clear]');
    if (clr) clr.onclick = () => { st.loc = st.own = st.who = st.prod = ALL; redo(); };
    const printNow = () => {
      try { window.print(); } catch { toast("This phone can't print from here. Try Share spreadsheet."); }
    };
    frag.querySelectorAll('[data-a=pdf]').forEach(b => b.onclick = printNow);
    // Preview: the same page the printout uses (html.previewing applies the print
    // styles on screen), with a bar at the bottom to print or close.
    frag.querySelector('[data-a=preview]').onclick = () => { setPreview(true); window.scrollTo(0, 0); };
    frag.querySelector('[data-a=close-preview]').onclick = () => { setPreview(false); window.scrollTo(0, 0); };
    frag.querySelector('[data-a=csv]').onclick = () => {
      const tag = `${st.proj ? slug(r.pName[st.proj]) : 'all-projects'}-${st.from}-to-${st.to}`;
      fileReadySheet(reportCsvFiles(r, st, tag, projLabel, filterBits), {
        title: 'Report ready',
        desc: `${esc(projLabel)}, ${esc(fmtDay(st.from))} to ${esc(fmtDay(st.to))}. Two files: the summary and every entry. They open in Excel, Google Sheets or Numbers.`,
        onSent: (how) => toast(how === 'saved' ? 'Saved to Downloads' : 'Shared'),
      });
    };
    return frag;
  }

  function reportCsvFiles(r, st, tag, projLabel, filterBits) {
    const head = ['Section', 'Name', 'Project', 'Start', 'Added', 'Used', 'Count corrections', 'Moved in', 'Moved out', 'End', 'Entries', 'Last used'];
    const showStock = st.who === ALL;
    const row = (sec, name, proj, a) => [sec, name, proj, showStock ? a.start : '', a.added, a.used, a.count, a.movedIn, a.movedOut,
      showStock ? a.end : '', a.entries, a.lastUsed ? toDateInput(new Date(a.lastUsed.at)) : ''];
    const sum = [
      ['Inventory report', projLabel, `${st.from} to ${st.to}`, ...filterBits],
      [],
      head,
      row('Totals', 'All', projLabel, r.total),
      ...r.byProd.map(([p, a]) => row('Product', [p.partNumber, p.description].filter(Boolean).join(' · ') || 'Untitled', r.pName[p.projectId], a)),
      ...r.byLoc.map(([n, a]) => row('Storage Location', orName(n), '', a)),
      ...r.byOwn.map(([n, a]) => row('Product Owner', orName(n), '', a)),
      ...r.byWho.map(([n, a]) => row('Team Member', orName(n), '', { ...a, start: '', end: '' })),
      ...r.byNote.map(([n, a]) => row('Note', n, '', { ...a, start: '', end: '' })),
    ];
    const ent = [['Date', 'Time', 'Project', 'Part number', 'Description', 'Type', 'Quantity', 'Storage Location', 'Product Owner', 'Moved to storage location', 'Moved to product owner', 'Team Member', 'Note', 'Edited']];
    for (const m of r.entries.slice().reverse()) {
      const p = r.pById[m.productId], d = new Date(m.at), mv = m.kind === 'move';
      ent.push([toDateInput(d), m.dateOnly ? '' : hhmm(d), r.pName[m.projectId], p.partNumber || '', p.description || '', kindWord(m),
        mv ? m.qty : m.delta, orName(m.location), orName(m.owner), mv ? orName(m.toLocation) : '', mv ? orName(m.toOwner) : '',
        orName(m.person), m.note || '', m.edits?.length ? 'Yes' : '']);
    }
    return [csvFile(`inventory-report-${tag}.csv`, sum), csvFile(`inventory-report-entries-${tag}.csv`, ent)];
  }

  /** Home screen nudge when there's data and no backup for REMIND_DAYS. */
  function backupBannerHtml(hasData) {
    if (!hasData || !backupPrefs.due()) return '';
    const last = backupPrefs.last();
    return `<div class="card banner backup-nudge">
      <div><b>${last ? `Last backup ${esc(ago(last))}` : 'No backup yet'}</b><br>Your inventory is only on this phone. A backup file keeps it safe if the phone is lost or reset.</div>
      <div class="actions"><button class="btn" data-a="later">Later</button><button class="btn primary" data-a="backup">Back up now</button></div>
    </div>`;
  }
  function wireBackupBanner(frag) {
    const b = frag.querySelector('.backup-nudge');
    if (!b) return;
    b.querySelector('[data-a=backup]').onclick = backupNow;
    b.querySelector('[data-a=later]').onclick = () => { ls.set('backupSnooze', new Date(Date.now() + DAY).toISOString()); b.remove(); };
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

  async function viewSettings() {
    setChrome({ title: 'Settings' });
    const last = backupPrefs.last();
    const safe = await DB.beforeRestore().catch(() => null);
    const frag = h(`<div>
      <p class="desc">Storage locations, product owners and team members are on the <b>Lists</b> tab.</p>
      <h2 class="section">Backup and export</h2>
      <div class="list">
        <button class="card row" data-a="backup">
          <div class="grow"><div class="t">Back up now</div><div class="s ${last && !backupPrefs.due() ? '' : 'low-txt'}">${last ? `Last backup: ${esc(ago(last))}` : 'Never backed up'}</div></div>${ICON.chev}
        </button>
        <button class="card row" data-a="restore">
          <div class="grow"><div class="t">Restore from backup</div><div class="s">Replace this phone's data with a backup file</div></div>${ICON.chev}
        </button>
        ${safe ? `<button class="card row" data-a="undo">
          <div class="grow"><div class="t">Undo last ${safeWord(safe)}</div><div class="s">Put back the data from before the ${safeWord(safe)} on ${esc(fmtStamp(safe.savedAt))}</div></div>${ICON.chev}
        </button>` : ''}
        <button class="card row" data-a="csv">
          <div class="grow"><div class="t">Export to spreadsheet (CSV)</div><div class="s">Stock and History for one project or all, with storage locations and product owners</div></div>${ICON.chev}
        </button>
        <label class="card row switch-row">
          <div class="grow"><div class="t">Backup reminder</div><div class="s">Remind me on the Projects screen after ${REMIND_DAYS} days without a backup</div></div>
          <input type="checkbox" class="switch" name="remind" ${backupPrefs.remind() ? 'checked' : ''}>
        </label>
      </div>
      <h2 class="section">Delete data</h2>
      <div class="list">
        <a class="card row" href="#/settings/delete-items">
          <div class="grow"><div class="t danger-txt">Delete inventory</div><div class="s">Pick products to delete, with their photos and History. The projects stay.</div></div>${ICON.chev}
        </a>
        <a class="card row" href="#/settings/delete">
          <div class="grow"><div class="t danger-txt">Delete projects</div><div class="s">Pick one or more projects to delete, with their products, photos and History</div></div>${ICON.chev}
        </a>
        <button class="card row" data-a="wipe">
          <div class="grow"><div class="t danger-txt">Delete all data</div><div class="s">Erase every project, product, photo, storage location, product owner and History entry on this phone</div></div>${ICON.chev}
        </button>
      </div>
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
    frag.querySelector('[data-a=backup]').onclick = backupNow;
    frag.querySelector('[data-a=restore]').onclick = restorePick;
    frag.querySelector('[data-a=csv]').onclick = () => exportSheet();
    const u = frag.querySelector('[data-a=undo]');
    if (u) u.onclick = undoRestore;
    frag.querySelector('[data-a=wipe]').onclick = deleteAllSheet;
    frag.querySelector('[name=remind]').onchange = (e) => {
      ls.set('backupReminder', e.target.checked ? 'on' : 'off');
      toast(e.target.checked ? 'Backup reminder on' : 'Backup reminder off');
    };
    return frag;
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
      ['Getting around', 'The bar at the bottom of the screen has four tabs: <b>Projects</b> (your projects and their products), <b>Inventory</b> (every product from every project in one list), <b>Reports</b> and <b>Settings</b>. Tap a tab to switch, or swipe left or right on the Projects, Inventory, Reports or Settings screen to move to the next tab. Going back to <b>Projects</b> takes you to the project or product you had open; tap <b>Projects</b> again for the list of projects. The tabs hide while you fill in a product form.'],
      ['Inventory (all projects)', 'The <b>Inventory</b> tab lists every product from every project, including ones with 0 in stock. Products with the same part number in different projects are shown once with the combined total. Search by part number, description or project, tap <b>Filters and sort</b> to look at one project, storage location or product owner or to change the order, or tap <b>Low stock only</b>. Tap a product to see the total, how much is in each project and where, and totals by storage location and product owner. Tap a project there to add, remove or move stock.'],
      ['Projects', 'Each project keeps its own inventory. On the <b>Projects</b> tab tap <b>New project</b>. Open a project and tap <b>⋮</b> to rename or delete it.'],
      ['Deleting inventory, projects or all data', 'To delete products but keep their project, tap <b>Settings</b> (bottom of the screen) › <b>Delete inventory</b>, tick the products (or <b>Select all</b> under a project) and tap <b>Delete</b>. To delete whole projects, tap <b>Delete projects</b>, tick the projects you want gone and tap <b>Delete</b>. To wipe everything, tap <b>Delete all data</b> and type <b>DELETE</b> to confirm. Both offer <b>Back up first</b>. A safety copy is kept, so if it was a mistake, tap <b>Undo</b> straight away or <b>Undo last delete</b> in Settings. Only the last restore or delete can be undone.'],
      ['Adding a product', 'Open a project and tap <b>Add product</b>. Tap the photo box to take a picture, enter the model/part number and a description, set the starting quantity, then tap <b>Add product</b>.'],
      ['Photos', 'Tap the photo box to use the camera, or <b>Choose from library</b> for a saved picture. To change a photo later, open the product, tap <b>⋮</b> › <b>Edit product</b>.'],
      ['Adding and removing stock', 'Tap a product to open it, then tap <b>+ Add</b> or <b>− Remove</b>. Pick the date (today is filled in), enter the quantity and, if you like, a note such as "10 for sections 15A". Add asks for the storage location and product owner. Remove asks where the stock comes from and won\'t let you take more than that spot holds. The form shows the stock there and the total after the change. Notes you used recently appear under the note box: tap one to reuse it. Right after saving, tap <b>Undo</b> at the bottom if it was a mistake.'],
      ['Storage locations and product owners', 'Stock is counted separately for each storage location (for example Bin A, Truck) and product owner. The product page shows the total and how much is at each one. In the Add form, pick a storage location and product owner, or choose <b>+ New storage location…</b> / <b>+ New product owner…</b> to type a new one. The names the project already uses show first, under <b>This project</b>. Every project shares one list of each: tap <b>Lists</b> (bottom of the screen). Tap a name there to see what is stored there (or owned), and to rename or remove it with <b>⋮</b>. Renaming updates every project and History.'],
      ['Storage location photos', 'Tap <b>Lists</b> › <b>Storage Locations</b> and tap a location. Tap <b>+ Add photo</b>, take a photo or choose one from your library, then give it a name, like Door or Shelves. Add as many as you like. Tap a photo to see it full size, swipe to see the next one, and use <b>Rename</b> or <b>Delete</b> at the bottom.'],
      ['Project product owners', 'When you create a project, tap the product owners who own the material on it (or type a new one). They show first when you add stock in that project, and if there is only one it is filled in for you. To change them, open the project and tap <b>⋮</b> › <b>Product owners for this project</b>.'],
      ['Team members', 'Add, Remove, Move and Correct stock count ask which <b>Team Member</b> is doing it. Pick a name, or choose <b>+ New team member…</b> to type one. The last name you picked is filled in next time. To rename or remove names, tap <b>Lists</b> (bottom of the screen) › <b>Team Members</b>. Renaming changes the name on every entry. Entries from before version 1.6 show Team Member as <b>Not set</b>; tap one in History and <b>Edit</b> it to fill it in.'],
      ['Reports', 'Tap the <b>Reports</b> tab at the bottom of the screen, or open a project and tap <b>⋮</b> › <b>Reports</b>. Pick a project or All projects and the dates (This week, Last week, This month, Last month, Last 30 days, or type your own). Tap <b>Filters</b> to look at one storage location, product owner, team member or product. The report shows the totals added and used, then the same per product (with stock at the start and end, and when it was last used), per storage location, per product owner, per team member and per note, then every entry with its date, team member and note. Tap <b>Preview report</b> to see it exactly as the PDF will look, then <b>Print / save PDF</b> or <b>Close</b>. Tap <b>Print / save PDF</b> to print it or save it as a PDF (on iPhone, tap the Share button on the print screen), or <b>Share spreadsheet</b> for CSV files.'],
      ['Moving stock', 'To move stock between storage locations or product owners (for example from Bin A to the truck), open the product and tap <b>⇄ Move</b>. Pick where it comes from, where it goes, and how many. The total stays the same and History shows one "Moved" entry.'],
      ['Low-stock warning', 'When adding a product, when adding or removing stock, or with <b>⋮</b> › <b>Edit product</b>, fill in <b>Low-stock warning</b>. When the total in stock is at or below that number, the product shows a red <b>Low</b> tag, the project shows how many items are low, and <b>Low stock only</b> above the product list shows just those.'],
      ['History', "Open a product to see every change, newest first: the date, whether it was added, removed or moved, the quantity, the storage location and product owner, the team member, the total before → after, and the note."],
      ['Fixing a History entry', 'Tap an entry in History to see its details. Tap <b>Edit</b> to change the date, quantity, storage location, product owner, team member or note: the stock adjusts to match, and the entry is marked <b>edited</b> with a record of what it was before. Tap <b>Delete</b> to remove the entry and put the stock back.'],
      ['Correcting a count', 'If the count on the shelf is different, open the product, tap <b>⋮</b> › <b>Correct stock count</b>, pick the storage location and product owner, and enter the real number there. The difference is saved in History as a "count" entry.'],
      ['“Not set”', 'Stock recorded before version 1.3 has no storage location or product owner, so it shows as <b>Not set</b>. To sort it out, use <b>⇄ Move</b> to move it to the right storage location and product owner, or tap an old History entry and <b>Edit</b> it.'],
      ['Searching', 'Inside a project, type in the search box to find products by part number or description.'],
      ['Updates', "The app checks for updates whenever you open it. When one arrives, it refreshes once by itself and shows <b>What's New</b>. Your data is not affected. You can see the version and build here in Settings."],
      ['Backing up', 'Your inventory is stored only on this phone, so make a backup now and then. Tap <b>Settings</b> (bottom of the screen) › <b>Back up now</b>. When the backup is ready, tap <b>Share or save…</b> and pick where it goes, for example Google Drive, Files, or an email to yourself. Or tap <b>Save to phone</b> to put it in Downloads. The file holds every project, product, photo, storage location, product owner, team member and History entry. Settings shows when you last backed up, and the Projects screen reminds you after 7 days (turn this off with <b>Backup reminder</b>).'],
      ['Restoring a backup', 'Tap <b>Settings</b> (bottom of the screen) › <b>Restore from backup</b> and pick the backup file. The app shows what is in it before anything changes. Tap <b>Replace</b> to swap everything on this phone for the backup. A safety copy of what was there is kept: if you restored the wrong file, tap <b>Undo last restore</b> in Settings.'],
      ['Exporting to a spreadsheet', 'Tap <b>Settings</b> (bottom of the screen) › <b>Export to spreadsheet (CSV)</b>, or open a project and tap <b>⋮</b> › <b>Export to spreadsheet (CSV)</b>. Pick a project or All projects, and what to export: the <b>Stock list</b> (one row per product, storage location and product owner) and/or <b>History</b> (every add, remove, move and count with its date and note). The files open in Excel, Google Sheets or Numbers.'],
      ['Your data', 'Everything is stored only on this phone, and nothing is sent anywhere unless you share a backup or export file yourself. Deleting the app or clearing the browser data for this site erases it, so keep a recent backup.'],
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

  // ---------- tabs (1.8) ----------
  // Five top-level tabs (1.10 build 12: Projects, Inventory, Lists, Reports, Settings). 'inv' is the
  // Projects tab (it was called Inventory in 1.8); 'all' is the all-projects Inventory.
  // Lists has three sub-tabs; swiping moves through them before moving to the next tab.
  // Switching tabs replaces the history entry instead of adding one, so the ‹ back
  // button inside a project still goes to the parent screen. Projects remembers the
  // project or product you had open.
  const TABS = ['inv', 'all', 'lst', 'rep', 'set'];
  const TAB_ROOT = { inv: '#/', all: '#/inventory', rep: '#/reports', lst: '#/lists', set: '#/settings' };
  const curHash = () => location.hash || '#/';
  const tabOf = (hash) => /^#\/inventory/.test(hash) ? 'all' : /^#\/reports/.test(hash) ? 'rep' : /^#\/lists/.test(hash) ? 'lst' : /^#\/settings/.test(hash) ? 'set' : 'inv';
  const listSubOf = (hash) => { const m = /^#\/lists(?:\/(locations|owners|team))?$/.exec(hash); return m ? (m[1] || lastList.get()) : null; };
  const isTabRoot = (hash) => /^(#\/?)?$/.test(hash) || hash === '#/inventory' || hash === '#/reports' || hash === '#/settings' || !!listSubOf(hash);
  // forms and the delete screens have their own bottom buttons, so no tab bar there
  const noTabs = (hash) => /^#\/(p\/[^/]+\/new|i\/[^/]+\/edit|settings\/delete)/.test(hash);
  let slideDir = 0;

  function updateTabs() {
    const hash = curHash(), tab = tabOf(hash);
    if (tab === 'inv' && !noTabs(hash)) ss.set('invHash', hash);
    const show = !noTabs(hash);
    $tabbar.hidden = !show;
    document.body.classList.toggle('has-tabs', show);
    for (const a of $tabbar.querySelectorAll('a')) {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }

  async function switchTab(tab) {
    const from = tabOf(curHash());
    let target = TAB_ROOT[tab];
    if (tab === 'lst') target = listHash(lastList.get());
    if (tab === 'inv' && from !== 'inv') {
      // back to the project or product that was open, if it still exists
      const m = (ss.get('invHash') || '').match(/^#\/(p|i)\/([^/]+)$/);
      if (m && await (m[1] === 'p' ? DB.getProject(m[2]) : DB.getProduct(m[2])).catch(() => null)) target = m[0];
    }
    if (target === curHash() || (tab === 'lst' && from === 'lst' && listSubOf(curHash()))) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    slideDir = Math.sign(TABS.indexOf(tab) - TABS.indexOf(from));
    go(target, true);
    reloadIfUpdated();
  }

  $tabbar.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (!a) return;
    e.preventDefault();
    switchTab(a.dataset.tab);
  });

  // Swipe left/right on the main screens to change tab (on Lists, sub-tab first). Not inside a
  // project (it would fire while scrolling), not from the screen edges (the
  // phone's own back gesture), and not on text boxes or while a sheet is open.
  let swipe = null;
  document.addEventListener('touchstart', (e) => {
    swipe = null;
    if (e.touches.length !== 1 || !isTabRoot(curHash()) || $sheetRoot.children.length) return;
    if (document.documentElement.classList.contains('previewing')) return;
    const t = e.touches[0];
    if (t.clientX < 24 || t.clientX > window.innerWidth - 24) return;
    if (e.target.closest('input, textarea, select, .tabbar, .toast')) return;
    swipe = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    const quick = Date.now() - swipe.t < 800;
    swipe = null;
    if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const sub = listSubOf(curHash());
    if (sub) {
      const j = LIST_KEYS.indexOf(sub) + (dx < 0 ? 1 : -1);
      if (j >= 0 && j < LIST_KEYS.length) { slideDir = dx < 0 ? 1 : -1; go(listHash(LIST_KEYS[j]), true); return; }
    }
    const i = TABS.indexOf(tabOf(curHash())) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) switchTab(TABS[i]);
  }, { passive: true });
  document.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    if (!/^#\/reports/.test(location.hash)) setPreview(false);
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
    let node;
    try {
      await refreshNames();
      if (parts[0] === 'p' && parts[2] === 'new') node = await viewProductForm(parts[1]);
      else if (parts[0] === 'p' && parts[2] === 'places') node = await viewLists('locations'); // before 1.10
      else if (parts[0] === 'p' && parts[1]) node = await viewProject(parts[1]);
      else if (parts[0] === 'i' && parts[2] === 'edit') node = await viewProductForm(null, parts[1]);
      else if (parts[0] === 'i' && parts[1]) node = await viewProduct(parts[1]);
      else if (parts[0] === 'settings' && parts[1] === 'new') node = viewWhatsNew();
      else if (parts[0] === 'settings' && parts[1] === 'help') node = viewHelp();
      else if (parts[0] === 'inventory' && parts[1]) node = await viewInventoryItem(decodeURIComponent(parts[1]));
      else if (parts[0] === 'inventory') node = await viewInventory();
      else if (parts[0] === 'reports') node = await viewReports();
      else if (parts[0] === 'settings' && parts[1] === 'people') node = await viewLists('team'); // before 1.10
      else if (parts[0] === 'lists' && LIST_WORD[parts[1]] && parts[2]) node = await viewListItem(parts[1], decodeURIComponent(parts[2]));
      else if (parts[0] === 'lists') node = await viewLists(parts[1]);
      else if (parts[0] === 'settings' && parts[1] === 'delete-items') node = await viewDeleteItems();
      else if (parts[0] === 'settings' && parts[1] === 'delete') node = await viewDeleteProjects();
      else if (parts[0] === 'settings') node = await viewSettings();
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
    updateTabs();
    $view.classList.remove('slide-l', 'slide-r');
    if (slideDir) { void $view.offsetWidth; $view.classList.add(slideDir > 0 ? 'slide-l' : 'slide-r'); slideDir = 0; }
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
