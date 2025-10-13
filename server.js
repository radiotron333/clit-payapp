import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Config base
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const FRONTEND_SUCCESS_URL = process.env.FRONTEND_SUCCESS_URL; 
// es: https://www.prosolar.it/prosolarpay.html

// ====== CREAZIONE CHECKOUT ======
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { descrizione, importoEuro, email, telefono, nickname } = req.body;

    if (!descrizione || !importoEuro || isNaN(Number(importoEuro))) {
      return res.status(400).json({ error: "Dati non validi" });
    }

    const unitAmount = Math.round(
      Number(String(importoEuro).replace(",", ".")) * 100
    );

    const successTarget = FRONTEND_SUCCESS_URL || `${BASE_URL}/success.html`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "it",
      payment_method_types: ["klarna", "card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            product_data: { name: descrizione },
            unit_amount: unitAmount,
          },
        },
      ],
      success_url: `${successTarget}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,
      customer_email: email || undefined,
      metadata: {
        nickname: nickname || "",
        telefono: telefono || "",
        descrizione: descrizione || "",
      },
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Errore server", details: err?.message });
  }
});

// ====== STATO SESSIONE ======
app.get("/api/session-status", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "session_id mancante" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.charges.data"],
    });

    const paymentIntent = session.payment_intent;
    const charge =
      paymentIntent?.charges?.data && paymentIntent.charges.data.length
        ? paymentIntent.charges.data[0]
        : null;

    return res.json({
      sessionStatus: session.status,
      paymentStatus: paymentIntent?.status || null,
      amount: (session.amount_total || 0) / 100,
      currency: session.currency || "eur",
      chargeId: charge?.id || null,
      customer_email: session.customer_details?.email || session.customer_email || null,
      nickname: session.metadata?.nickname || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Errore server", details: err?.message });
  }
});

// ====== HEALTHCHECK ======
app.get("/health", (_req, res) => res.json({ ok: true }));

// ====== AVVIO SERVER ======
app.listen(PORT, () => {
  console.log(
    `✅ Server avviato sulla porta ${PORT} (BASE_URL=${BASE_URL}, FRONTEND_SUCCESS_URL=${FRONTEND_SUCCESS_URL || "n/a"})`
  );
});
