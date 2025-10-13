/**
 * Prosolar – pagamenti.js (v3)
 * - Crea link pagamento (Stripe Checkout: Klarna/carta)
 * - Apre WhatsApp/SMS al numero inserito (pre-apertura anti-popup)
 * - Rileva ?session_id al ritorno e mostra stato + link Stripe
 * - Autocomplete rubrica locale (contatti usati)
 * - Bottone "Verifica su Stripe (lista pagamenti)" sempre visibile
 */

// ====== CONFIG ======
const API_BASE = 'https://prosolar-pay.onrender.com'; // backend Render
const STRIPE_ACCOUNT_ID = 'acct_1S8IMaEwqxaMEDv2';     // tuo account
const STRIPE_MODE = 'test';                            // 'test' | 'live'
const STRIPE_DASHBOARD_BASE = `https://dashboard.stripe.com/${STRIPE_ACCOUNT_ID}${STRIPE_MODE === 'test' ? '/test' : ''}`;

// ====== UI refs (assume che l’HTML abbia questi id) ======
const form = document.getElementById('payForm');
const esito = document.getElementById('esito');
const copia = document.getElementById('copia');
const postCreate = document.getElementById('postCreate');

const elDescrizione = document.getElementById('descrizione');
const elImporto     = document.getElementById('importo');
const elTelefono    = document.getElementById('telefono');
const elEmail       = document.getElementById('email');
const elCanale      = document.getElementById('canale') || { value: 'wa' };

// area controllo stato (creata se manca)
let controlloBox = document.getElementById('controllo');
if (!controlloBox) {
  controlloBox = document.createElement('div');
  controlloBox.id = 'controllo';
  controlloBox.className = 'note';
  form.insertAdjacentElement('afterend', controlloBox);
}

// ====== “Verifica su Stripe” – bottone sempre visibile ======
function injectVerificaStripeButton() {
  // cerca contenitore azioni post-creazione o creane uno
  let host = document.getElementById('postCreate');
  if (!host) {
    host = document.createElement('div');
    host.id = 'postCreate';
    host.className = 'actions';
    host.style.marginTop = '12px';
    host.style.display = 'flex';
    form.insertAdjacentElement('afterend', host);
  }
  // se già presente, non duplicare
  if (document.getElementById('btnStripePayments')) return;

  const btn = document.createElement('button');
  btn.id = 'btnStripePayments';
  btn.type = 'button';
  btn.className = 'btn-ghost';
  btn.textContent = 'Verifica su Stripe (lista pagamenti)';
  btn.onclick = () => window.open(`${STRIPE_DASHBOARD_BASE}/payments`, '_blank', 'noopener');
  host.appendChild(btn);
}
injectVerificaStripeButton();

// ====== Local Storage (rubrica locale) ======
const LS_KEY = 'prosolar_contacts_v1'; // [{name, phone, email, lastUsed}...]

function loadContacts(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); }catch{ return []; } }
function saveContacts(list){ try{ localStorage.setItem(LS_KEY, JSON.stringify(list)); }catch{} }
function normalizePhone(t){
  let s = String(t||'').trim().replace(/\s+/g,'').replace(/^00/,'+').replace(/[^+0-9]/g,'');
  if(/^3\d{8,9}$/.test(s)) s = '+39'+s;
  return s;
}
function upsertContact({name, phone, email}){
  if(!phone) return;
  const list = loadContacts();
  const norm = normalizePhone(phone);
  const idx = list.findIndex(c => c.phone === norm);
  const now = Date.now();
  const entry = { name: (name||'').trim(), phone: norm, email: (email||'').trim(), lastUsed: now };
  if(idx >= 0){
    entry.name = entry.name || list[idx].name || '';
    entry.email = entry.email || list[idx].email || '';
    list[idx] = entry;
  } else list.push(entry);
  list.sort((a,b)=> b.lastUsed - a.lastUsed);
  saveContacts(list.slice(0,200));
}

// Autocomplete con <datalist> su telefono/email
function ensureDatalist(inputEl, id){
  let dl = document.getElementById(id);
  if(!dl){ dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
  inputEl.setAttribute('list', id);
  return dl;
}
const phoneDL = ensureDatalist(elTelefono, 'prosolar_phone_list');
const emailDL = ensureDatalist(elEmail, 'prosolar_email_list');

function refreshAutocomplete(){
  const list = loadContacts().slice(0,50);
  phoneDL.innerHTML = ''; emailDL.innerHTML = '';
  for(const c of list){
    if(c.phone){ const o=document.createElement('option'); o.value=c.phone; o.label=c.name?`${c.name} (${c.phone})`:c.phone; phoneDL.appendChild(o); }
    if(c.email){ const o=document.createElement('option'); o.value=c.email; o.label=c.name?`${c.name} (${c.email})`:c.email; emailDL.appendChild(o); }
  }
}
refreshAutocomplete();

// Mini “Rubrica (storico)” – bottone vicino al telefono
(function injectRubricaButton(){
  if(document.getElementById('btnRubrica')) return;
  const btn = document.createElement('button');
  btn.id = 'btnRubrica';
  btn.type = 'button';
  btn.textContent = 'Rubrica (storico)';
  btn.className = 'btn-ghost';
  btn.style.marginTop = '8px';
  elTelefono.insertAdjacentElement('afterend', btn);
  btn.onclick = () => {
    const list = loadContacts();
    if(!list.length) { alert('Nessun contatto salvato ancora.'); return; }
    const top = list.slice(0,15);
    const lines = top.map((c,i)=> `${i+1}) ${c.name?c.name+' — ':''}${c.phone}${c.email?' — '+c.email:''}`).join('\n');
    const choice = prompt(`Seleziona contatto (1-${top.length}):\n${lines}`);
    const idx = (parseInt(choice,10)||0)-1;
    if(idx>=0 && idx<top.length){
      const c = top[idx];
      elTelefono.value = c.phone || '';
      elEmail.value = c.email || '';
      if(!elDescrizione.value && c.name) elDescrizione.value = c.name;
    }
  };
})();

// ====== API helpers ======
async function creaCheckout(descrizione, importoEuro, email){
  const res = await fetch(`${API_BASE}/api/create-checkout`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ descrizione, importoEuro, email })
  });
  let data;
  try{ data = await res.json(); }
  catch{ const txt = await res.text().catch(()=> ''); throw new Error(`Risposta non valida dall'API (${res.status}). ${txt?.slice(0,140)}`); }
  if(!res.ok) throw new Error(data.error || data.details || 'Errore server API');
  return data; // { url, sessionId }
}

async function getSessionStatus(sessionId){
  const res = await fetch(`${API_BASE}/api/session-status?session_id=${encodeURIComponent(sessionId)}`);
  let data;
  try{ data = await res.json(); }
  catch{ const txt = await res.text().catch(()=> ''); throw new Error(`Risposta non valida dal server (${res.status}). ${txt?.slice(0,140)}`); }
  if(!res.ok) throw new Error(data.error || 'Errore session-status');
  return data;
}

// ====== UI Stato / Stripe detail ======
function renderControlloUI(sessionId){
  controlloBox.innerHTML = `
    <div style="margin-top:4px">
      <div><strong>Session ID:</strong> ${sessionId}</div>
      <div class="actions" style="margin-top:8px">
        <button id="btnControlla" class="btn-ghost">Controlla pagamento</button>
        <a id="btnApriLista" class="btn-ghost" href="${STRIPE_DASHBOARD_BASE}/payments" target="_blank" rel="noopener"
           style="text-decoration:none; display:inline-block; padding:12px; border-radius:10px; border:1px solid #333">
           Verifica su Stripe (lista pagamenti)
        </a>
      </div>
      <div id="stato" class="note" style="margin-top:8px"></div>
      <div id="tools" style="margin-top:6px"></div>
    </div>
  `;
  const btnControlla = document.getElementById('btnControlla');
  const stato = document.getElementById('stato');
  const tools = document.getElementById('tools');

  btnControlla.onclick = async () => {
    stato.textContent = 'Controllo in corso...';
    tools.innerHTML = '';
    try {
      const data = await getSessionStatus(sessionId);
      stato.innerHTML = `
        Stato sessione: <strong>${data.sessionStatus}</strong><br>
        Stato pagamento: <strong>${data.paymentStatus || '—'}</strong><br>
        Importo: €${data.amount} ${data.currency}<br>
        Charge ID: ${data.chargeId || '—'}
      `;
      if (data.stripePaymentLink) {
        const a = document.createElement('a');
        a.href = data.stripePaymentLink;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Apri dettaglio pagamento su Stripe';
        a.style.cssText = 'display:inline-block;margin-top:6px;text-decoration:none;padding:12px;border:1px solid #333;border-radius:10px;';
        tools.appendChild(a);
      } else {
        const hint = document.createElement('div');
        hint.className = 'note';
        hint.textContent = 'Dettaglio diretto non disponibile: usa la lista pagamenti.';
        tools.appendChild(hint);
      }
    } catch (err) {
      stato.textContent = 'Errore: ' + (err.message || 'imprevisto');
    }
  };
}

// ====== Rientro dopo pagamento (?session_id=...) ======
(function checkSessionIdFromURL(){
  const m = location.search.match(/[?&]session_id=([^&]+)/);
  if (m && m[1]) {
    const sid = decodeURIComponent(m[1]);
    renderControlloUI(sid);
    const doCheck = async () => { try { await getSessionStatus(sid); } catch {} };
    doCheck(); setTimeout(doCheck, 5000); setTimeout(doCheck, 15000);
  }
})();

// ====== SUBMIT: crea link + apre WA/SMS con pre-apertura ======
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  esito.textContent = 'Creo il link...';

  const descrizione = elDescrizione.value.trim();
  const importo = elImporto.value.trim();
  const telefono = normalizePhone(elTelefono.value.trim());
  const email = (elEmail.value || '').trim();
  if (!descrizione || !importo || !telefono) {
    esito.textContent = 'Compila prodotto, prezzo e telefono.';
    return;
  }

  // Pre-apri finestra per evitare blocco popup
  let pendingWin = null;
  try { pendingWin = window.open('', '_blank'); } catch {}

  try {
    const { url, sessionId } = await creaCheckout(descrizione, importo, email);

    // salva in rubrica locale
    upsertContact({ name: descrizione, phone: telefono, email });
    refreshAutocomplete();

    esito.textContent = 'Link creato. Apro WhatsApp/SMS…';
    // Messaggio
    const msg = encodeURIComponent(
      `Ciao! Ecco il link di pagamento per "${descrizione}" (€${importo}). ` +
      `Puoi pagare con Klarna (3 rate) o carta: ${url}`
    );

    // Apertura automatica secondo canale
    const canale = elCanale.value || 'wa';
    const dest = (canale === 'wa')
      ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(telefono)}&text=${msg}`
      : `sms:${encodeURIComponent(telefono)}?body=${msg}`;

    if (pendingWin && !pendingWin.closed) {
      pendingWin.location.href = dest;
    } else {
      window.open(dest, '_blank');
    }

    // Copia link
    if (copia) copia.onclick = async () => {
      try { await navigator.clipboard.writeText(url); esito.textContent = 'Link copiato negli appunti.'; }
      catch { esito.textContent = 'Impossibile copiare (permesso negato).'; }
    };

    // Mostra controlli
    renderControlloUI(sessionId);

    // Mostra (se esiste) area azioni post-creazione
    if (postCreate) postCreate.style.display = 'flex';
  } catch (err) {
    try { if (pendingWin && !pendingWin.closed) pendingWin.close(); } catch {}
    esito.textContent = 'Errore: ' + (err.message || 'imprevisto');
  }
});
