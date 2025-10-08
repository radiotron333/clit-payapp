# Prosolar PayApp (Stripe Checkout + Webhook + PDF receipts)

Questo progetto crea link di pagamento Stripe (Klarna / card), salva una riga in `vendite.csv`,
genera una ricevuta PDF al completamento del pagamento (via webhook) e invia la ricevuta
sia al venditore che al cliente (se ha inserito email) via SMTP.

## File principali
- `server.js` - server Express con endpoint `/api/create-checkout` e `/webhook`
- `public/pagamenti.html` - pagina da inserire sul sito (frontend)
- `public/success.html`, `public/cancel.html`
- `vendite.csv` - file creato dinamicamente (attenzione: su Render è effimero)
- `public/receipts/<sessionId>.pdf` - ricevute generate

## Setup locale / deploy (Render)
1. `npm install`
2. Copia `.env.example` in `.env` e riempi le variabili:
   - `STRIPE_SECRET_KEY` (sk_test_...)
   - `STRIPE_WEBHOOK_SECRET` (whsec_... dal Dashboard)
   - `BASE_URL` (es. https://prosolar-pay.onrender.com)
   - SMTP_* e SELLER_EMAIL
3. `node server.js`

### Render
- Crea Web Service collegato a questo repo
- Build command: `npm install`
- Start command: `node server.js`
- Configura le Environment Variables su Render esattamente come `.env.example`

## Stripe Webhook
Aggiungi endpoint su Stripe: `https://<tuo-service>.onrender.com/webhook`
Seleziona l'evento `checkout.session.completed`. Copia il signing secret in `STRIPE_WEBHOOK_SECRET`.

## Note
- Su Render il filesystem è non persistente: per storicizzare i dati si consiglia DB (Postgres) o Google Sheets.
- Per invio automatico via WhatsApp servono servizi terzi (Twilio / Meta Cloud API).

---
Se vuoi, posso generare i comandi git per commit/push e guidarti nel deploy su Render.
