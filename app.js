// Mint Systems — till & daily takings
// ---------------------------------------------------------------
// Firebase project: nice-systems-cd97a
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyADxFZ8cuI2ReEwXxpKIkhSttHfjQS1Y1s",
  authDomain: "nice-systems-cd97a.firebaseapp.com",
  projectId: "nice-systems-cd97a",
  storageBucket: "nice-systems-cd97a.firebasestorage.app",
  messagingSenderId: "824185975450",
  appId: "1:824185975450:web:562773b7338f5a91ac6523"
};
// ---------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, where, onSnapshot, setDoc, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Starting price list, used only the very first time (when the database is empty)
const DEFAULT_ITEMS = [
  { id: "skate-rental", name: "Entry + skate rental", price: 15, cat: "Entry" },
  { id: "own-skates",   name: "Entry (own skates)",   price: 10, cat: "Entry" },
  { id: "non-skater",   name: "Entry (non-skater)",   price: 5,  cat: "Entry" }
];

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cents = n => Math.round(Number(n || 0) * 100);
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2);
const pad = n => String(n).padStart(2, '0');
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const prettyDay = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'}); };
const timeOf = ts => new Date(ts).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

function show(id) { ['setup', 'login', 'app'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id)); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2000);
}
function modal(html) { $('#modal-box').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- config ----------
function parseConfig(text) {
  const out = {};
  for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) {
    const m = text.match(new RegExp('["\']?' + k + '["\']?\\s*:\\s*["\']([^"\']+)["\']'));
    if (m) out[k] = m[1];
  }
  return (out.apiKey && out.projectId && out.authDomain && out.appId) ? out : null;
}
function loadConfig() {
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey) return FIREBASE_CONFIG;
  const saved = lsGet('mintFirebaseConfig');
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return null;
}

// ---------- state ----------
const S = {
  db: null, auth: null, user: null,
  items: [], pricesLoaded: false,
  cart: {}, custom: [],
  today: dayKey(new Date()), todaySales: [],
  tab: 'sell', sheetOpen: false,
  pay: 'cash', tendered: '',
  histDay: null, histSales: null, weekRows: null,
  draft: null, unsubs: [], unsubToday: null,
  syncState: 'Connecting…'
};

function setStatus(text, warn) {
  const el = $('#status');
  el.classList.toggle('warn', !!warn);
  el.innerHTML = '<b>' + esc(text) + '</b><br><span>' + esc(prettyDay(S.today)) + '</span>';
}

function handleDbError(err) {
  console.warn(err);
  if (err && err.code === 'permission-denied') {
    $('#notice').innerHTML = '<div class="notice">This account isn’t on the staff list. Add <b>' + esc(S.user && S.user.email) + '</b> to the Firestore rules in Firebase, then reopen the app.</div>';
    setStatus('No access', true);
  } else {
    setStatus('Sync problem', true);
  }
}

// ---------- boot ----------
function boot() {
  const cfg = loadConfig();
  if (!cfg) { show('setup'); return; }
  let app;
  try { app = initializeApp(cfg); }
  catch (e) { show('setup'); $('#setup-err').textContent = 'That config didn’t work: ' + e.message; return; }
  S.auth = getAuth(app);
  S.db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

  onAuthStateChanged(S.auth, user => {
    S.unsubs.forEach(u => u()); S.unsubs = [];
    if (S.unsubToday) { S.unsubToday(); S.unsubToday = null; }
    S.user = user;
    if (!user) { show('login'); return; }
    show('app');
    startData();
  });
}

$('#setup-go').addEventListener('click', () => {
  const cfg = parseConfig($('#setup-config').value);
  if (!cfg) { $('#setup-err').textContent = 'Couldn’t find apiKey, authDomain, projectId and appId in that text.'; return; }
  lsSet('mintFirebaseConfig', JSON.stringify(cfg));
  $('#setup-err').textContent = '';
  boot();
});

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-go'); btn.disabled = true; $('#login-err').textContent = '';
  try {
    await signInWithEmailAndPassword(S.auth, $('#login-email').value.trim(), $('#login-pass').value);
  } catch (err) {
    const c = err && err.code || '';
    $('#login-err').textContent =
      c.includes('invalid') || c.includes('wrong') || c.includes('not-found') ? 'Wrong email or password.' :
      c.includes('network') ? 'No internet connection.' :
      c.includes('too-many') ? 'Too many tries — wait a minute.' :
      c.includes('unauthorized-domain') ? 'Add this website to Firebase → Authentication → Settings → Authorized domains.' :
      'Sign-in failed (' + c + ').';
  }
  btn.disabled = false;
});

// ---------- data ----------
function startData() {
  $('#notice').innerHTML = '';
  setStatus('Connecting…');
  S.pricesLoaded = false; render();

  S.unsubs.push(onSnapshot(doc(S.db, 'config', 'prices'), snap => {
    S.pricesLoaded = true;
    if (!snap.exists()) {
      if (!snap.metadata.fromCache) {
        // first ever run: save the starting price list
        setDoc(doc(S.db, 'config', 'prices'), { items: DEFAULT_ITEMS, updatedAt: Date.now() }).catch(handleDbError);
      }
      S.items = [];
    } else {
      const d = snap.data();
      S.items = Array.isArray(d.items) ? d.items.map(x => ({ ...x })) : [];
    }
    render();
  }, handleDbError));

  subscribeToday();
}

function subscribeToday() {
  if (S.unsubToday) S.unsubToday();
  const q = query(collection(S.db, 'sales'), where('day', '==', S.today));
  S.unsubToday = onSnapshot(q, { includeMetadataChanges: true }, snap => {
    S.todaySales = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.ts - a.ts);
    if (snap.metadata.hasPendingWrites) setStatus(navigator.onLine ? 'Syncing…' : 'Offline · will sync', !navigator.onLine);
    else if (snap.metadata.fromCache) setStatus(navigator.onLine ? 'Connecting…' : 'Offline · will sync', !navigator.onLine);
    else setStatus('Saved ✓');
    render();
  }, handleDbError);
}

window.addEventListener('online', () => setStatus('Syncing…'));
window.addEventListener('offline', () => setStatus('Offline · will sync', true));

// day rollover while app is open
setInterval(() => {
  const k = dayKey(new Date());
  if (k !== S.today && S.db && S.user) { S.today = k; S.todaySales = []; subscribeToday(); render(); }
}, 60000);

// ---------- cart ----------
function cartLines() {
  const lines = [];
  for (const it of S.items) {
    const q = S.cart[it.id] || 0;
    if (q > 0) lines.push({ key: it.id, name: it.name, priceC: cents(it.price), qty: q });
  }
  for (const c of S.custom) lines.push({ key: c.id, name: c.name, priceC: c.priceC, qty: c.qty });
  return lines;
}
const cartTotal = () => cartLines().reduce((s, l) => s + l.priceC * l.qty, 0);
const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);

function changeQty(key, delta) {
  const c = S.custom.find(x => x.id === key);
  if (c) { c.qty += delta; if (c.qty <= 0) S.custom = S.custom.filter(x => x.id !== key); }
  else { S.cart[key] = Math.max(0, (S.cart[key] || 0) + delta); if (!S.cart[key]) delete S.cart[key]; }
  render();
}
function clearCart() { S.cart = {}; S.custom = []; S.tendered = ''; S.sheetOpen = false; render(); }

function completeSale() {
  const lines = cartLines();
  if (!lines.length) return;
  const total = cartTotal();
  const tenderedC = S.pay === 'cash' && S.tendered !== '' ? cents(S.tendered) : null;
  if (tenderedC !== null && tenderedC < total) { toast('Cash given is less than total'); return; }
  const sale = {
    ts: Date.now(), day: S.today, pay: S.pay,
    lines: lines.map(l => ({ name: l.name, priceC: l.priceC, qty: l.qty })),
    totalC: total, tenderedC, changeC: tenderedC !== null ? tenderedC - total : null,
    by: (S.user && S.user.email) || ''
  };
  // Saved instantly on the phone; Firebase uploads it when online.
  setDoc(doc(S.db, 'sales', uid()), sale).catch(err => { handleDbError(err); toast('A sale failed to save — check the Today tab'); });
  const msg = sale.changeC ? 'Sale saved · Change ' + money(sale.changeC) : 'Sale saved · ' + money(total);
  S.cart = {}; S.custom = []; S.tendered = ''; S.sheetOpen = false;
  render(); toast(msg);
}

function voidSale(id) {
  const s = S.todaySales.find(x => x.id === id) || (S.histSales || []).find(x => x.id === id);
  if (!s) return;
  modal(`<div style="font-weight:700;font-size:18px">Delete this sale?</div>
    <p class="muted">${esc(timeOf(s.ts))} · ${money(s.totalC)} · ${esc(s.pay)}</p>
    <div class="row" style="gap:8px"><button class="btn ghost full" data-act="close">Keep it</button>
    <button class="btn pink full" data-act="confirm-void" data-id="${esc(id)}">Delete</button></div>`);
}
function doVoid(id) {
  closeModal();
  deleteDoc(doc(S.db, 'sales', id)).catch(handleDbError);
  if (S.histSales) S.histSales = S.histSales.filter(x => x.id !== id);
  toast('Sale deleted'); render();
}

function addCustom() {
  modal(`<div style="font-weight:700;font-size:18px;margin-bottom:10px">Custom amount</div>
    <input class="field" id="cu-name" placeholder="What is it? (e.g. Snack, Repair)" style="margin-bottom:8px">
    <input class="field" id="cu-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Price">
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn ghost full" data-act="close">Cancel</button>
    <button class="btn pink full" data-act="custom-add">Add</button></div>`);
  setTimeout(() => $('#cu-price') && $('#cu-price').focus(), 50);
}

// ---------- summaries ----------
function summarize(sales) {
  const out = { total: 0, count: sales.length, cash: 0, card: 0, byItem: {} };
  for (const s of sales) {
    out.total += s.totalC || 0;
    if (s.pay === 'cash') out.cash += s.totalC || 0; else if (s.pay === 'card') out.card += s.totalC || 0;
    for (const l of (s.lines || [])) {
      if (!out.byItem[l.name]) out.byItem[l.name] = { qty: 0, c: 0 };
      out.byItem[l.name].qty += l.qty; out.byItem[l.name].c += l.priceC * l.qty;
    }
  }
  return out;
}

function summaryHTML(sales, title) {
  const s = summarize(sales);
  const items = Object.entries(s.byItem).sort((a, b) => b[1].c - a[1].c);
  return `
    <div class="card">
      <div class="muted small">${esc(title)}</div>
      <div class="big">${money(s.total)}</div>
      <div class="stats">
        <div class="stat"><div class="small muted">Sales</div><div class="v">${s.count}</div></div>
        <div class="stat"><div class="small muted">Cash</div><div class="v">${money(s.cash)}</div></div>
        <div class="stat"><div class="small muted">Card</div><div class="v">${money(s.card)}</div></div>
      </div>
    </div>
    <div class="card">
      <div style="font-weight:700;margin-bottom:4px">What sold</div>
      ${items.length ? `<table><tr><th>Item</th><th class="r">Qty</th><th class="r">Total</th></tr>
        ${items.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="r">${v.qty}</td><td class="r">${money(v.c)}</td></tr>`).join('')}
      </table>` : '<div class="empty">No sales yet.</div>'}
    </div>
    <div class="card">
      <div style="font-weight:700;margin-bottom:4px">Sales log</div>
      ${sales.length ? sales.map(x => `
        <div class="sale">
          <div class="row">
            <div><b>${money(x.totalC)}</b> <span class="pill ${esc(x.pay)}">${esc(x.pay)}</span></div>
            <div class="row" style="gap:8px"><span class="muted small">${esc(timeOf(x.ts))}</span>
            <button class="btn red" style="padding:5px 10px;font-size:12px" data-act="void" data-id="${esc(x.id)}">Delete</button></div>
          </div>
          <div class="muted small" style="margin-top:4px">${(x.lines || []).map(l => esc(l.qty + '× ' + l.name)).join(', ')}
          ${x.tenderedC != null ? ` · given ${money(x.tenderedC)}, change ${money(x.changeC)}` : ''}</div>
          ${x.by ? `<div class="by">${esc(x.by)}</div>` : ''}
        </div>`).join('') : '<div class="empty">Nothing yet.</div>'}
    </div>`;
}

// ---------- history ----------
async function loadHistory(day) {
  S.histDay = day; S.histSales = null; render();
  try {
    const snap = await getDocs(query(collection(S.db, 'sales'), where('day', '==', day)));
    S.histSales = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.ts - a.ts);
  } catch (e) { S.histSales = []; handleDbError(e); }
  render();
}
async function loadWeek() {
  const d = new Date(); d.setDate(d.getDate() - 13);
  try {
    const snap = await getDocs(query(collection(S.db, 'sales'), where('day', '>=', dayKey(d))));
    const by = {};
    snap.docs.forEach(doc => { const x = doc.data(); by[x.day] = by[x.day] || { c: 0, n: 0 }; by[x.day].c += x.totalC || 0; by[x.day].n++; });
    S.weekRows = Object.entries(by).sort((a, b) => b[0].localeCompare(a[0]));
  } catch (e) { S.weekRows = []; handleDbError(e); }
  render();
}

// ---------- price editor ----------
function startDraft() {
  S.draft = S.items.map(x => ({ ...x }));
  if (!S.draft.length) S.draft.push({ id: uid(), name: '', price: '', cat: 'General' });
}
function readDraftFromDOM() {
  document.querySelectorAll('[data-draft]').forEach(el => {
    const [id, field] = el.dataset.draft.split('|');
    const it = S.draft.find(x => x.id === id); if (it) it[field] = el.value;
  });
}
function applyCatRenames() {
  document.querySelectorAll('[data-cat-rename]').forEach(el => {
    const from = el.dataset.catRename, to = el.value.trim() || 'General';
    if (from !== to) S.draft.forEach(x => { if ((x.cat || 'General') === from) x.cat = to; });
  });
}
function saveDraft() {
  readDraftFromDOM();
  const items = S.draft.filter(x => String(x.name).trim() !== '')
    .map(x => ({ id: x.id, name: String(x.name).trim(), price: Math.round(Number(x.price || 0) * 100) / 100, cat: String(x.cat || 'General').trim() || 'General' }));
  setDoc(doc(S.db, 'config', 'prices'), { items, updatedAt: Date.now() }).catch(handleDbError);
  S.items = items; S.draft = null; toast('Price list saved'); render();
}

// ---------- render ----------
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  ['sell', 'today', 'history', 'prices'].forEach(t => $('#tab-' + t).classList.toggle('hidden', S.tab !== t));
  $('#bar').classList.toggle('hidden', S.tab !== 'sell');
  if (S.tab === 'sell') renderSell();
  if (S.tab === 'today') $('#tab-today').innerHTML = summaryHTML(S.todaySales, 'Taken today · ' + prettyDay(S.today));
  if (S.tab === 'history') renderHistory();
  if (S.tab === 'prices') renderPrices();
  renderBar();
}

function renderSell() {
  const el = $('#tab-sell');
  if (!S.pricesLoaded) { el.innerHTML = '<div class="empty">Loading price list…</div>'; return; }
  if (!S.items.length) {
    el.innerHTML = `<div class="card empty">No items yet.<br><br><button class="btn pink" data-act="goto-prices">Add your price list</button></div>`;
    return;
  }
  const cats = [];
  S.items.forEach(it => { const c = it.cat || 'General'; if (!cats.includes(c)) cats.push(c); });
  el.innerHTML = cats.map(c => `
    <div class="cat">${esc(c)}</div>
    <div class="grid">
      ${S.items.filter(it => (it.cat || 'General') === c).map(it => {
        const q = S.cart[it.id] || 0;
        return `<button class="item ${q ? 'has' : ''}" data-act="add" data-id="${esc(it.id)}">
          ${q ? `<span class="badge">${q}</span>` : ''}
          <span class="n">${esc(it.name)}</span><span class="p">${money(cents(it.price))}</span></button>`;
      }).join('')}
    </div>`).join('') +
    `<div class="cat">Other</div><div class="grid"><button class="item" data-act="custom"><span class="n">＋ Custom amount</span><span class="p muted">Any price</span></button></div>`;
}

function changeHTML(tenderedC, total) {
  if (tenderedC === null) return '';
  const ch = tenderedC - total;
  return `<div class="change ${ch < 0 ? 'short' : ''}"><span>${ch < 0 ? 'Still owed' : 'Change'}</span><span>${money(Math.abs(ch))}</span></div>`;
}

function renderBar() {
  const lines = cartLines(), total = cartTotal(), count = cartCount();
  $('#bar-total').textContent = money(total);
  $('#bar-count').textContent = count ? count + ' item' + (count > 1 ? 's' : '') : 'No items';
  $('#bar-go').disabled = !count; $('#bar-clear').disabled = !count;
  if (!count) S.sheetOpen = false;
  $('#bar-go').textContent = S.sheetOpen ? 'Back' : 'Checkout';
  const sh = $('#sheet');
  if (!S.sheetOpen) { sh.classList.add('hidden'); return; }
  sh.classList.remove('hidden');
  const tenderedC = S.tendered === '' ? null : cents(S.tendered);
  const quick = [...new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 2000) * 2000, Math.ceil(total / 5000) * 5000, 10000])]
    .filter(v => v >= total).sort((a, b) => a - b).slice(0, 5);
  sh.innerHTML = `
    ${lines.map(l => `<div class="line">
      <div class="nm">${esc(l.name)}<div class="small muted">${money(l.priceC)} each</div></div>
      <div class="qty"><button data-act="dec" data-id="${esc(l.key)}">−</button><span>${l.qty}</span><button data-act="inc" data-id="${esc(l.key)}">+</button></div>
      <div class="amt">${money(l.priceC * l.qty)}</div></div>`).join('')}
    <div style="margin-top:12px" class="seg">
      <button data-act="pay" data-v="cash" class="${S.pay === 'cash' ? 'on' : ''}">💵 Cash</button>
      <button data-act="pay" data-v="card" class="${S.pay === 'card' ? 'on' : ''}">💳 Card</button>
    </div>
    ${S.pay === 'cash' ? `
      <div style="margin-top:10px"><input class="field" id="tendered" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Cash given (optional)" value="${esc(S.tendered)}"></div>
      <div class="quick">${quick.map(v => `<button data-act="tender" data-v="${v}">${v === total ? 'Exact' : money(v)}</button>`).join('')}</div>
      <div id="change-box">${changeHTML(tenderedC, total)}</div>` : ''}
    <button class="btn cyan full" data-act="complete" style="margin-top:12px">Complete sale · ${money(total)}</button>`;
}

function renderHistory() {
  const el = $('#tab-history');
  if (S.weekRows === null) { el.innerHTML = '<div class="empty">Loading…</div>'; loadWeek(); S.weekRows = 'loading'; return; }
  if (S.weekRows === 'loading') return;
  const weekTotal = S.weekRows.reduce((s, r) => s + r[1].c, 0);
  el.innerHTML = `
    <div class="card">
      <div class="row"><div style="font-weight:700">Last 14 days</div><div class="muted small">${money(weekTotal)} total</div></div>
      ${S.weekRows.length ? `<table style="margin-top:6px"><tr><th>Day</th><th class="r">Sales</th><th class="r">Taken</th></tr>
        ${S.weekRows.map(([d, v]) => `<tr data-act="pick-day" data-v="${esc(d)}" style="cursor:pointer"><td>${esc(prettyDay(d))}</td><td class="r">${v.n}</td><td class="r"><b>${money(v.c)}</b></td></tr>`).join('')}
      </table>` : '<div class="empty">No sales in the last 14 days.</div>'}
    </div>
    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">Look up a day</div>
      <div class="row" style="gap:8px"><input class="field" type="date" id="hist-date" value="${esc(S.histDay || S.today)}">
      <button class="btn pink" data-act="load-day">View</button></div>
    </div>
    ${S.histDay ? (S.histSales === null ? '<div class="empty">Loading…</div>' : summaryHTML(S.histSales, prettyDay(S.histDay))) : ''}`;
}

function renderPrices() {
  const el = $('#tab-prices');
  const who = `<div class="who">Signed in as ${esc(S.user && S.user.email)} · <button data-act="sign-out">Sign out</button></div>`;
  if (!S.draft) {
    const cats = {};
    S.items.forEach(it => { (cats[it.cat || 'General'] = cats[it.cat || 'General'] || []).push(it); });
    el.innerHTML = `<div class="card">
      <div class="row"><div style="font-weight:700">Price list</div><button class="btn pink" data-act="edit-prices">Edit</button></div>
      ${S.items.length ? Object.entries(cats).map(([c, list]) => `<div class="cat">${esc(c)}</div>
        <table>${list.map(it => `<tr><td>${esc(it.name)}</td><td class="r"><b>${money(cents(it.price))}</b></td></tr>`).join('')}</table>`).join('')
        : '<div class="empty">No prices yet — tap Edit to add them.</div>'}
    </div>` + who;
    return;
  }
  const cats = [...new Set(S.draft.map(x => x.cat || 'General'))];
  el.innerHTML = `<div class="card">
    <div style="font-weight:700;margin-bottom:4px">Edit price list</div>
    <div class="muted small" style="margin-bottom:8px">Blank names are removed when you save.</div>
    ${cats.map(c => `
      <div class="cat row"><input class="field" style="padding:6px 10px;font-size:13px;text-transform:uppercase;letter-spacing:1px" data-cat-rename="${esc(c)}" value="${esc(c)}"></div>
      ${S.draft.filter(x => (x.cat || 'General') === c).map(it => `
        <div class="edit">
          <input class="field" placeholder="Item name" data-draft="${esc(it.id)}|name" value="${esc(it.name)}">
          <input class="field" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" data-draft="${esc(it.id)}|price" value="${esc(it.price)}">
          <button class="x" data-act="del-item" data-id="${esc(it.id)}">×</button>
        </div>`).join('')}
      <button class="btn ghost" style="padding:8px 12px;font-size:13px" data-act="add-item" data-v="${esc(c)}">＋ Add to ${esc(c)}</button>`).join('')}
    <div style="margin-top:14px"><button class="btn ghost full" data-act="add-cat">＋ New category</button></div>
    <div class="row" style="gap:8px;margin-top:14px">
      <button class="btn ghost full" data-act="cancel-edit">Cancel</button>
      <button class="btn cyan full" data-act="save-prices">Save prices</button>
    </div>
  </div>`;
}

// ---------- events ----------
document.querySelector('nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab;
  if (S.tab === 'history') S.weekRows = null;
  if (S.tab !== 'prices') S.draft = null;
  render(); window.scrollTo(0, 0);
});
$('#bar-go').addEventListener('click', () => { S.sheetOpen = !S.sheetOpen; render(); });
$('#bar-clear').addEventListener('click', clearCart);

document.addEventListener('input', e => {
  if (e.target.id === 'tendered') {
    S.tendered = e.target.value;
    const box = $('#change-box'); if (box) box.innerHTML = changeHTML(S.tendered === '' ? null : cents(S.tendered), cartTotal());
  }
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, id = t.dataset.id, v = t.dataset.v;
  switch (a) {
    case 'add': S.cart[id] = (S.cart[id] || 0) + 1; renderSell(); renderBar(); break;
    case 'inc': changeQty(id, 1); break;
    case 'dec': changeQty(id, -1); break;
    case 'pay': S.pay = v; renderBar(); break;
    case 'tender': S.tendered = (Number(v) / 100).toFixed(2); renderBar(); break;
    case 'complete': completeSale(); break;
    case 'custom': addCustom(); break;
    case 'custom-add': {
      const name = ($('#cu-name').value || '').trim() || 'Custom';
      const p = cents($('#cu-price').value);
      if (p <= 0) { toast('Enter a price'); return; }
      S.custom.push({ id: 'c' + uid(), name, priceC: p, qty: 1 }); closeModal(); render(); break;
    }
    case 'close': closeModal(); break;
    case 'void': voidSale(id); break;
    case 'confirm-void': doVoid(id); break;
    case 'goto-prices': S.tab = 'prices'; startDraft(); render(); break;
    case 'pick-day': loadHistory(v); break;
    case 'load-day': { const d = $('#hist-date').value; if (d) loadHistory(d); break; }
    case 'edit-prices': startDraft(); render(); break;
    case 'cancel-edit': S.draft = null; render(); break;
    case 'save-prices': applyCatRenames(); saveDraft(); break;
    case 'add-item': readDraftFromDOM(); applyCatRenames(); S.draft.push({ id: uid(), name: '', price: '', cat: v }); render(); break;
    case 'del-item': readDraftFromDOM(); applyCatRenames(); S.draft = S.draft.filter(x => x.id !== id); render(); break;
    case 'add-cat': {
      readDraftFromDOM(); applyCatRenames();
      let n = 'New category', i = 2; const ex = new Set(S.draft.map(x => x.cat));
      while (ex.has(n)) n = 'New category ' + i++;
      S.draft.push({ id: uid(), name: '', price: '', cat: n }); render(); break;
    }
    case 'sign-out': signOut(S.auth); break;
  }
});

boot();
