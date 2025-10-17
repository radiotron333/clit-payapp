import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());                   // consente le chiamate da webbalo.com
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const PORT = process.env.PORT || 3000;

// URL di base del backend su Render (es. https://clit-pay.onrender.com)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Dove vuoi che Stripe rimandi DOPO il pagamento (la TUA pagina su webbalo)
const FRONTEND_SUCCESS_URL =
  process.env.FRONTEND_SUCCESS_URL ||
  "https://www.webbalo.com/clit/clitpay.html";

// Crea sessione Checkout
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { descrizione, importoEuro, email } = req.body;
    if (!descrizione || !importoEuro || isNaN(Number(importoEuro))) {
      return res.status(400).json({ error: "Dati non validi" });
    }
    const unitAmount = Math.round(Number(String(importoEuro).replace(",", ".")) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "it",
      payment_method_types: ["klarna", "card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: { name: descrizione },
          unit_amount: unitAmount
        }
      }],
      success_url: `${FRONTEND_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,   // opzionale: puoi lasciarla qui
      customer_email: email || undefined
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server", details: err?.message });
  }
});

// Stato sessione per pulsante "Controlla pagamento"
app.get("/api/session-status", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "session_id mancante" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.charges.data"]
    });
    const pi = session.payment_intent;
    const charge = pi?.charges?.data?.[0] || null;

    res.json({
      sessionStatus: session.status,
      paymentStatus: pi?.status || null,
      amount: (session.amount_total || 0) / 100,
      currency: session.currency || "eur",
      chargeId: charge?.id || null,
      customer_email: session.customer_details?.email || session.customer_email || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server", details: err?.message });
  }
});

// health (facile da testare)
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server on ${PORT} (BASE_URL=${BASE_URL}, FRONTEND_SUCCESS_URL=${FRONTEND_SUCCESS_URL})`);
});
