// Front-end statico su prosolaritalia.it — Backend API su Render
const API_BASE = 'https://prosolar-pay.onrender.com';

const form = document.getElementById('payForm');
const esito = document.getElementById('esito');
const copia = document.getElementById('copia');

function normTelefono(t){
  return String(t).replace(/\s+/g,'').replace(/^00/, '+');
}

async function creaCheckout(descrizione, importoEuro, email){
  const res = await fetch(API_BASE + '/api/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ descrizione, importoEuro, email })
  });
  let data;
  try { data = await res.json(); }
  catch { throw new Error('Risposta non valida dal server (non JSON).'); }
  if (!res.ok) throw new Error(data.error || data.details || 'Errore server');
  return data;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  esito.textContent = 'Creo il link...';

  const descrizione = document.getElementById('descrizione').value.trim();
  const importo = document.getElementById('importo').value.trim();
  const telefono = normTelefono(document.getElementById('telefono').value.trim());
  const email = document.getElementById('email').value.trim();
  const canale = document.getElementById('canale').value;

  if(!descrizione || !importo || !telefono){
    esito.textContent = 'Compila descrizione, importo e telefono.';
    return;
  }

  try {
    const { url } = await creaCheckout(descrizione, importo, email);
    esito.innerHTML = 'Link creato. <a href="' + url + '" target="_blank" rel="noopener">Apri Checkout</a>';

    const msg = encodeURIComponent('Ciao! Ecco il link di pagamento per "' + descrizione + '" (€' + importo + '). ' + url);

    if (canale === 'wa') {
      window.open('https://api.whatsapp.com/send?phone=' + encodeURIComponent(telefono) + '&text=' + msg, '_blank');
    } else {
      window.open('sms:' + telefono + '?body=' + msg, '_blank');
    }

    copia.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        esito.textContent = 'Link copiato negli appunti.';
      } catch {
        esito.textContent = 'Impossibile copiare automaticamente; copia manualmente dall\'anteprima.';
      }
    };
  } catch (err) {
    esito.textContent = 'Errore: ' + err.message;
  }
});
