// ====== CONFIG ======
const API_BASE = 'https://prosolar-pay.onrender.com'; // backend su Render
const STRIPE_ACCOUNT_ID = 'acct_1S8IMaEwqxaMEDv2';     // il tuo account
const STRIPE_DASHBOARD_BASE = `https://dashboard.stripe.com/${STRIPE_ACCOUNT_ID}/test`; // LIVE: togli /test

// ====== UI ======
const form = document.getElementById('payForm');
const esito = document.getElementById('esito');
const copia = document.getElementById('copia');
const controlloBox = document.getElementById('controllo') || (() => {
  const d = document.createElement('div');
  d.id = 'controllo';
  d.className = 'note';
  form.insertAdjacentElement('afterend', d);
  return d;
})();

const postCreate = document.getElementById('postCreate'); // opzionale
const btnWA = document.getElementById('sendWA');
const btnSMS = document.getElementById('sendSMS');
const btnOpen = document.getElementById('openNow');

let lastSession = { id: null, url: null };
let lastFormData = { descrizione: '', importo: '', telefono: '', email: '' };

// ====== UTILS ======
function normTelefono(t){
  let s = String(t || '').trim().replace(/\s+/g,'').replace(/^00/,'+');
  if (/^3\d{8,9}$/.test(s)) s = '+39' + s; // 3xxxxxxxx -> +39...
  return s;
}

async function creaCheckout(descrizione, importoEuro, email){
  const res = await fetch(`${API_BASE}/api/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ descrizione, importoEuro, email })
  });
  let data;
  try { data = await res.json(); }
  catch {
    const txt = await res.text().catch(()=> '');
    throw new Error(`Risposta non valida dall'API (${res.status}). ${txt?.slice(0,140)}`);
  }
  if (!res.ok) throw new Error(data.error || data.details || 'Errore server API');
  return data; // { url, sessionId }
}

async function getSessionStatus(sessionId){
  const res = await fetch(`${API_BASE}/api/session-status?session_id=${encodeURIComponent(sessionId)}`);
  let data;
  try { data = await res.json(); }
  catch {
    const txt = await res.text().catch(()=> '');
    throw new Error(`Risposta non valida dal server (${res.status}). ${txt?.slice(0,140)}`);
  }
  if (!res.ok) throw new Error(data.error || 'Errore session-status');
  return data;
}

function renderControlloUI(sessionId){
  controlloBox.innerHTML = `
    <div style="margin-top:4px">
      <div><strong>Session ID:</strong> ${sessionId}</div>
      <div class="actions" style="margin-top:8px">
        <button id="btnControlla" class="btn-ghost">Controlla pagamento</button>
        <a id="btnApriLista" class="btn-ghost" href="${STRIPE_DASHBOARD_BASE}/payments" target="_blank" rel="noopener"
           style="text-decoration:none; display:inline-block; padding:12px; border-radius:10px; border:1px solid #333">
           Apri lista pagamenti Stripe
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
        hint.textContent = 'Dettaglio diretto non disponibile: usa la lista pagamenti e apri l’ultimo.';
        tools.appendChild(hint);
      }
    } catch (err) {
      stato.textContent = 'Errore: ' + (err.message || 'imprevisto');
    }
  };
}

// ====== gestione rientro da Stripe/Klarna (?session_id=...) ======
(function checkSessionIdFromURL(){
  const m = location.search.match(/[?&]session_id=([^&]+)/);
  if (m && m[1]) {
    lastSession.id = decodeURIComponent(m[1]);
    renderControlloUI(lastSession.id);
    const doCheck = async () => { try { await getSessionStatus(lastSession.id); } catch {} };
    doCheck(); setTimeout(doCheck, 5000); setTimeout(doCheck, 15000);
  }
})();

// ====== SUBMIT ======
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  esito.textContent = 'Creo il link...';

  const descrizione = document.getElementById('descrizione').value.trim();
  const importo = document.getElementById('importo').value.trim();
  const telefono = normTelefono(document.getElementById('telefono').value.trim());
  const email = document.getElementById('email').value.trim();

  if (!descrizione || !importo || !telefono) {
    esito.textContent = 'Compila prodotto, prezzo e telefono.';
    return;
  }

  // Pre-apri la finestra per evitare blocco popup (si aggiorna dopo la fetch)
  let pendingWin = null;
  try { pendingWin = window.open('', '_blank'); } catch {}

  try {
    const { url, sessionId } = await creaCheckout(descrizione, importo, email);
    lastSession = { id: sessionId, url };
    lastFormData = { descrizione, importo, telefono, email };
    esito.textContent = 'Link creato. Apro WhatsApp/SMS…';

    // prepara messaggio
    const msg = encodeURIComponent(
      `Ciao! Ecco il link di pagamento per "${descrizione}" (€${importo}). ` +
      `Puoi pagare con Klarna (3 rate) o carta: ${url}`
    );

    // se hai i bottoni post-creazione, mostrali
    if (postCreate) postCreate.style.display = 'flex';
    if (btnWA) btnWA.onclick = () => {
      const wa = `https://api.whatsapp.com/send?phone=${encodeURIComponent(lastFormData.telefono)}&text=${msg}`;
      window.open(wa, '_blank');
    };
    if (btnSMS) btnSMS.onclick = () => {
      const sms = `sms:${encodeURIComponent(lastFormData.telefono)}?body=${msg}`;
      window.open(sms, '_blank');
    };
    if (btnOpen) btnOpen.onclick = () => window.open(url, '_blank');

    // apertura diretta (in base al canale selezionato)
    const canale = document.getElementById('canale') ? document.getElementById('canale').value : 'wa';
    const dest = (canale === 'wa')
      ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(telefono)}&text=${msg}`
      : `sms:${encodeURIComponent(telefono)}?body=${msg}`;

    if (pendingWin && !pendingWin.closed) {
      // reindirizza la finestra pre-aperta
      pendingWin.location.href = dest;
    } else {
      // fallback
      window.open(dest, '_blank');
    }

    // bottone "Copia link"
    if (copia) copia.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        esito.textContent = 'Link copiato negli appunti.';
      } catch {
        esito.textContent = 'Impossibile copiare (permesso negato).';
      }
    };

    renderControlloUI(sessionId);
  } catch (err) {
    // se avevamo aperto una finestra vuota, chiudiamola per non lasciare tab bianche
    try { if (pendingWin && !pendingWin.closed) pendingWin.close(); } catch {}
    esito.textContent = 'Errore: ' + (err.message || 'imprevisto');
  }
});
