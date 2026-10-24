(() => {
  'use strict';

  /* ---------- Utilidades ---------- */
  const KEY = 'cv.productos.v1', THEME = 'cv.tema';
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // textContent: nunca interpreta HTML (previene XSS)
    return e;
  };
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysLeft = (s) => Math.round((parseDate(s) - today()) / 864e5);
  const fmtDate = (s) => s.split('-').reverse().join('/');
  const plural = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  const STATES = {
    danger:  { label: 'VENCIDO',   filter: '🔴 Vencidos' },
    today:   { label: 'VENCE HOY', filter: '🚨 Hoy' },
    warning: { label: '1-7 DÍAS',  filter: '🟠 1-7 días' },
    soon:    { label: '8-15 DÍAS', filter: '🟡 8-15 días' },
    success: { label: 'VIGENTE',   filter: '🟢 Vigentes' }
  };
  const statusOf = (n) => n < 0 ? 'danger' : n === 0 ? 'today' : n <= 7 ? 'warning' : n <= 15 ? 'soon' : 'success';
  const daysText = (n) => n < 0 ? `${plural(-n)} vencido` : n === 0 ? 'Vence hoy' : plural(n);

  /* ---------- Estado y persistencia ---------- */
  const state = { items: [], filter: 'todos', query: '', sort: { key: 'date', dir: 1 }, editingId: null, deletingId: null };

  function clean(p) { // valida y normaliza un registro (formulario o archivo importado)
    if (!p || typeof p !== 'object') return null;
    const code = String(p.code ?? '').trim().slice(0, 30);
    const name = String(p.name ?? '').trim().slice(0, 60);
    const desc = String(p.desc ?? '').trim().slice(0, 150);
    const qty = Number(p.qty);
    const date = String(p.date ?? '');
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(parseDate(date));
    if (!code || !name || !Number.isInteger(qty) || qty < 0 || qty > 999999 || !validDate) return null;
    return { id: String(p.id || uid()), code, name, desc, qty, date };
  }
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw).map(clean).filter(Boolean);
    } catch (_) { /* datos corruptos: se usan los de ejemplo */ }
    return window.SEED_PRODUCTS.map(clean);
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state.items)); } catch (_) { toast('No se pudo guardar en el navegador'); } };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Render ---------- */
  const enriched = () => state.items.map((p) => { const d = daysLeft(p.date); return { ...p, days: d, status: statusOf(d) }; });

  function renderStats(list) {
    const c = (s) => list.filter((p) => p.status === s).length;
    const defs = [
      ['', 'Total', list.length, 'Productos registrados'],
      ['danger', 'Vencidos', c('danger'), 'Requieren atención'],
      ['today', 'Vencen hoy', c('today'), 'Atención inmediata'],
      ['warning', 'Próximos 7 días', c('warning'), 'Prioridad alta'],
      ['success', 'Vigentes', c('success') + c('soon'), 'En buen estado']
    ];
    const box = $('#stats'); box.replaceChildren();
    defs.forEach(([cls, label, n, sub]) => {
      const card = el('div', 'card ' + cls);
      card.append(el('span', '', label), el('strong', '', n), el('small', '', sub));
      box.append(card);
    });
  }

  function renderAlerts(list) {
    const urgent = list.filter((p) => p.days <= 15).sort((a, b) => a.days - b.days);
    $('#atencionN').textContent = urgent.length;
    $('#atencion').hidden = urgent.length === 0;
    const box = $('#alertas'); box.replaceChildren();
    urgent.slice(0, 12).forEach((p) => {
      const item = el('div', 'alert-item ' + p.status);
      const info = el('div'); const b = el('b', '', p.name);
      info.append(b, el('small', '', `${p.code} · ${fmtDate(p.date)}`));
      item.append(info, el('span', `badge ${p.status}`, daysText(p.days).replace(' vencido', ' venc.')));
      box.append(item);
    });
    if (urgent.length > 12) box.append(el('p', '', `… y ${urgent.length - 12} más. Usa los filtros para verlos.`));
  }

  function renderFilters(list) {
    const box = $('#filtros'); box.replaceChildren();
    const mk = (key, label, n) => {
      const b = el('button', 'filter' + (state.filter === key ? ' active' : ''), `${label} (${n})`);
      b.type = 'button'; b.addEventListener('click', () => { state.filter = key; render(); });
      box.append(b);
    };
    mk('todos', 'Todos', list.length);
    Object.entries(STATES).forEach(([k, v]) => mk(k, v.filter, list.filter((p) => p.status === k).length));
  }

  function renderTable(list) {
    const q = state.query.trim().toLowerCase(), { key, dir } = state.sort;
    const rows = list
      .filter((p) => (state.filter === 'todos' || p.status === state.filter) &&
        (!q || `${p.code} ${p.name} ${p.desc}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        const va = key === 'date' ? a.days : key === 'qty' ? a.qty : a[key].toLowerCase();
        const vb = key === 'date' ? b.days : key === 'qty' ? b.qty : b[key].toLowerCase();
        return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
      });
    const body = $('#tbody'); body.replaceChildren();
    rows.forEach((p) => {
      const tr = el('tr');
      const tdCode = el('td'); tdCode.append(el('b', '', p.code));
      const tdName = el('td', '', p.name); if (p.desc) tdName.append(el('small', '', p.desc));
      const tdDays = el('td'); tdDays.append(el('b', '', daysText(p.days)));
      const tdState = el('td'); tdState.append(el('span', `badge ${p.status}`, STATES[p.status].label));
      const tdAct = el('td');
      const edit = el('button', 'action', 'Editar'), del = el('button', 'action delete', 'Eliminar');
      edit.type = del.type = 'button';
      edit.addEventListener('click', () => openForm(p.id));
      del.addEventListener('click', () => openDelete(p.id));
      tdAct.append(edit, del);
      tr.append(tdCode, tdName, el('td', '', p.qty), el('td', '', fmtDate(p.date)), tdDays, tdState, tdAct);
      body.append(tr);
    });
    $('#vacio').hidden = rows.length > 0;
  }

  function render() {
    const list = enriched();
    renderStats(list); renderAlerts(list); renderFilters(list); renderTable(list);
  }

  /* ---------- Formulario (crear / editar) ---------- */
  const dlgForm = $('#dlgForm'), form = $('#form'), dlgDel = $('#dlgDel');

  function openForm(id = null) {
    state.editingId = id; form.reset(); $('#formError').textContent = '';
    $('#formTitulo').textContent = id ? 'Editar producto' : 'Registrar producto';
    if (id) { const p = state.items.find((x) => x.id === id); ['code', 'name', 'desc', 'qty', 'date'].forEach((k) => (form[k].value = p[k])); }
    dlgForm.showModal(); form.code.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = clean({ id: state.editingId, code: form.code.value, name: form.name.value, desc: form.desc.value, qty: form.qty.value, date: form.date.value });
    const err = $('#formError');
    if (!data) { err.textContent = 'Revisa los campos: código, producto, cantidad entera (≥ 0) y una fecha válida.'; return; }
    if (state.items.some((p) => p.id !== data.id && p.code === data.code && p.date === data.date)) {
      err.textContent = 'Ya existe un producto con ese código y esa fecha de vencimiento.'; return;
    }
    if (state.editingId) state.items = state.items.map((p) => (p.id === data.id ? data : p));
    else state.items.push(data);
    save(); render(); dlgForm.close();
    toast(state.editingId ? 'Producto actualizado' : 'Producto registrado');
  });

  function openDelete(id) {
    const p = state.items.find((x) => x.id === id); state.deletingId = id;
    $('#delTexto').textContent = `¿Eliminar "${p.name}" (${p.code})? Esta acción no se puede deshacer.`;
    dlgDel.showModal();
  }
  $('#btnConfirmDel').addEventListener('click', () => {
    state.items = state.items.filter((p) => p.id !== state.deletingId);
    save(); render(); dlgDel.close(); toast('Producto eliminado');
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  /* ---------- Exportar / importar ---------- */
  function download(name, content, type) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const csvCell = (v) => { // evita inyección de fórmulas en Excel (=, +, -, @)
    let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };

  $('#btnCsv').addEventListener('click', () => {
    const head = ['Código', 'Producto', 'Descripción', 'Cantidad', 'Vencimiento', 'Días restantes', 'Estado'];
    const lines = enriched().sort((a, b) => a.days - b.days).map((p) =>
      [p.code, p.name, p.desc, p.qty, fmtDate(p.date), p.days, STATES[p.status].label].map(csvCell).join(','));
    download(`vencimientos_${stamp()}.csv`, '\uFEFF' + [head.map(csvCell).join(','), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
    toast('CSV exportado');
  });
  $('#btnJson').addEventListener('click', () => {
    download(`respaldo_vencimientos_${stamp()}.json`, JSON.stringify(state.items, null, 2), 'application/json');
    toast('Respaldo generado');
  });
  $('#btnImp').addEventListener('click', () => $('#fileImp').click());
  $('#fileImp').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('Archivo demasiado grande (máx. 2 MB)');
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) throw new Error();
      const valid = arr.map(clean).filter(Boolean);
      if (!valid.length) return toast('El archivo no contiene productos válidos');
      state.items = valid; save(); render(); toast(`${valid.length} productos importados`);
    } catch (_) { toast('Archivo JSON no válido'); }
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Se reemplazarán todos los datos por los de ejemplo. ¿Continuar?')) return;
    state.items = window.SEED_PRODUCTS.map(clean); save(); render(); toast('Datos de ejemplo restaurados');
  });

  /* ---------- Eventos generales ---------- */
  $('#btnNuevo').addEventListener('click', () => openForm());
  $('#buscar').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; render();
  }));
  $('#btnTema').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME, next); } catch (_) {}
  });

  /* ---------- Inicio ---------- */
  try { document.documentElement.dataset.theme = localStorage.getItem(THEME) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (_) {}
  $('#hoy').textContent = '· Hoy: ' + today().toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  state.items = load();
  render();
  setInterval(render, 60 * 60 * 1000); // recalcula los días si la página queda abierta
})();
