// ========= CONFIG =========
const API_BASE = 'https://prosolar-pay.onrender.com';

// Imposta qui il tuo Account ID per puntare alla tua dashboard (non è un segreto).
// In TEST: la dashboard usa '/test' nel percorso.
// In LIVE: togli '/test' dai link.
const STRIPE_ACCOUNT_ID = 'acct_1S8IMaEwqxaMEDv2';
const STRIPE_DASHBOARD_BASE = https://dashboard.stripe.com/${STRIPE_ACCOUNT_ID}/test; // live: rimuovi /test

// ========= RIFERIMENTI UI =========
const form = document.getElementById('payForm');
const esito = document.getElementById('esito');
const copia = document.getElementById('copia');

// Se non esiste, crea l'area controllo sotto al form
let controlloBox = document.getElementById('controllo');
if (!controlloBox) {
  controlloBox = document.createElement('div');
  controlloBox.id = 'controllo';
  controlloBox.className = 'note';
  form.insertAdjacentElement('afterend', controlloBox);
}
let lastSessionId = null;

// ========= FUNZIONI =========
function normTelefono(t){
  let s = String(t || '').trim().replace(/\s+/g,'').replace(/^00/,'+');
  if (/^3\d{8,9}$/.test(s)) s = '+39' + s; // aggiunge +39 se manca
  return s;
}

async function creaCheckout(descrizione, importoEuro, email){
  const res = await fetch(${API_BASE}/api/create-checkout, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ descrizione, importoEuro, email })
  });
  let data;
  try { data = await res.json(); }
  catch {
    const txt = await res.text().catch(()=> '');
    throw new Error(Risposta non valida dall'API (${res.status}). ${txt?.slice(0,140)});
  }
  if (!res.ok) throw new Error(data.error || data.details || 'Errore server API');
  return data; // { url, sessionId }
}

async function getSessionStatus(sessionId){
  const res = await fetch(${API_BASE}/api/session-status?session_id=${encodeURIComponent(sessionId)});
  let data;
  try { data = await res.json(); }
  catch {
    const txt = await res.text().catch(()=> '');
    throw new Error(Risposta non valida dal server (${res.status}). ${txt?.slice(0,140)});
  }
  if (!res.ok) throw new Error(data.error || 'Errore session-status');
  return data; // { sessionStatus, paymentStatus, amount, currency, chargeId, stripePaymentLink, ... }
}

function renderControlloUI(sessionId){
  const paymentsListUrl = ${STRIPE_DASHBOARD_BASE}/payments; // lista pagamenti account
  controlloBox.innerHTML = `
    <div style="margin-top:10px">
      <div><strong>Session ID:</strong> ${sessionId}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px">
        <button id="btnControlla" type="button">Controlla pagamento</button>
        <a id="btnApriLista" class="btn" href="${paymentsListUrl}" target="_blank" rel="noopener"
           style="text-decoration:none; padding:10px; border:1px solid #333; border-radius:10px;">
           Apri pagamenti Stripe
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

      // Link diretto al dettaglio pagamento (se disponibile)
      if (data.stripePaymentLink) {
        const a = document.createElement('a');
        a.href = data.stripePaymentLink;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Apri dettaglio pagamento su Stripe';
        a.style.cssText = 'display:inline-block;margin-top:6px;text-decoration:none;padding:10px;border:1px solid #333;border-radius:10px;';
        tools.appendChild(a);
      } else {
        // fallback: apri lista pagamenti; l’ultimo in cima è quello appena pagato
        const a = document.createElement('a');
        a.href = ${STRIPE_DASHBOARD_BASE}/payments;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Apri lista pagamenti su Stripe';
        a.style.cssText = 'display:inline-block;margin-top:6px;text-decoration:none;padding:10px;border:1px solid #333;border-radius:10px;';
        tools.appendChild(a);
      }
    } catch (err) {
      stato.textContent = 'Errore: ' + (err.message || 'imprevisto');
    }
  };
}

// ========= HANDLER FORM =========
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  esito.textContent = 'Creo il link...';

  const descrizione = document.getElementById('descrizione').value.trim();
  const importo = document.getElementById('importo').value.trim();
  const telefono = normTelefono(document.getElementById('telefono').value.trim());
  const email = document.getElementById('email').value.trim();
  const canale = document.getElementById('canale').value;

  if (!descrizione || !importo || !telefono) {
    esito.textContent = 'Compila prodotto, prezzo e telefono.';
    return;
  }

  try {
    const { url, sessionId } = await creaCheckout(descrizione, importo, email);
    lastSessionId = sessionId;
    esito.textContent = 'Link creato. Apro WhatsApp/SMS…';

    const msg = encodeURIComponent(
      `Ciao! Ecco il link di pagamento per "${descrizione}" (€${importo}). ` +
      Puoi pagare con Klarna (3 rate) o carta: ${url}
    );

    if (canale === 'wa') {
      window.open(https://api.whatsapp.com/send?phone=${encodeURIComponent(telefono)}&text=${msg}, '_blank');
    } else {
      const smsUrl = sms:${encodeURIComponent(telefono)}?body=${msg};
      window.open(smsUrl, '_blank');
    }

    // bottone "Copia link"
    copia.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        esito.textContent = 'Link copiato negli appunti.';
      } catch {
        esito.textContent = 'Impossibile copiare negli appunti (permesso negato).';
      }
    };

    // area di controllo
    renderControlloUI(sessionId);
  } catch (err) {
    esito.textContent = 'Errore: ' + (err.message || 'imprevisto');
  }
})