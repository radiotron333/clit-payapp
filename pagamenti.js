(async function () {
  const form = document.getElementById("payForm");
  const esito = document.getElementById("esito");
  const post = document.getElementById("postCreate");
  const btnWA = document.getElementById("sendWA");
  const btnSMS = document.getElementById("sendSMS");
  const btnOpen = document.getElementById("openNow");
  const btnCopy = document.getElementById("copia");

  let paymentUrl = "";

  function normPhone(num) {
    return (num || "").replace(/\D/g, "");
  }

  function msg(descrizione, importo, url) {
    const t = `CLIT Boutique\n${descrizione}\nTotale: € ${importo}\nPaga qui:\n${url}`;
    return encodeURIComponent(t);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    esito.textContent = "Creo il link…";

    const descrizione = document.getElementById("descrizione").value.trim();
    const importo = document.getElementById("importo").value;
    const telefono = document.getElementById("telefono").value;
    const canale = document.getElementById("canale").value;

    try {
      const r = await fetch("https://clit-pay.onrender.com/create-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descrizione, amount_eur: importo })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore creazione link");

      paymentUrl = data.url;
      esito.innerHTML = `Link creato: <a href="${paymentUrl}" target="_blank">${paymentUrl}</a>`;
      post.style.display = "flex";

      const n = normPhone(telefono);
      const text = msg(descrizione, importo, paymentUrl);

      if (canale === "wa") {
        window.open(`https://wa.me/${n}?text=${text}`, "_blank");
      } else {
        window.open(`sms:${n}?&body=${text}`, "_self");
      }
    } catch (err) {
      console.error(err);
      esito.textContent = "Errore: " + err.message;
    }
  });

  btnWA?.addEventListener("click", () => {
    const n = normPhone(document.getElementById("telefono").value);
    const text = msg(
      document.getElementById("descrizione").value,
      document.getElementById("importo").value,
      paymentUrl
    );
    window.open(`https://wa.me/${n}?text=${text}`, "_blank");
  });

  btnSMS?.addEventListener("click", () => {
    const n = normPhone(document.getElementById("telefono").value);
    const text = msg(
      document.getElementById("descrizione").value,
      document.getElementById("importo").value,
      paymentUrl
    );
    window.open(`sms:${n}?&body=${text}`, "_self");
  });

  btnOpen?.addEventListener("click", () => window.open(paymentUrl, "_blank"));

  btnCopy?.addEventListener("click", async () => {
    if (!paymentUrl) return;
    await navigator.clipboard.writeText(paymentUrl);
    esito.textContent = "Link copiato negli appunti.";
  });
})();