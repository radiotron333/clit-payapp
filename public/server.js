// server.js
import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();

// --- Config ---
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.warn("ATTENZIONE: STRIPE_SECRET_KEY non impostata. Inseriscila in env vars.");
}
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CSV_PATH = path.resolve("./vendite.csv");
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_DASHBOARD_MODE = process.env.STRIPE_DASHBOARD_MODE === "live" ? "live" : "test"; // 'test' by default

// Ensure CSV exists with header
if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, "data,nickname,descrizione,importo,telefono,email,session_id,session_url\n", { encoding: "utf8" });
}

// Serve file statici
app.use(express.static("public"));

// --- Webhook endpoint: must parse raw body to verify signature ---
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // If no webhook secret set (not recommended for production), parse body
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  // handle the event type(s) you care about
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      // try to expand for more details
      const sessionFull = await stripe.checkout.sessions.retrieve(session.id, { expand: ["payment_intent", "line_items"] });
      const descrizione = sessionFull.line_items?.data?.[0]?.description || sessionFull.metadata?.descrizione || "Prodotto";
      const importo = ((sessionFull.amount_total || sessionFull.amount_subtotal || 0) / 100).toFixed(2);
      const telefono = sessionFull.metadata?.telefono || "";
      const nickname = sessionFull.metadata?.nickname || "";
      const email = sessionFull.customer_email || sessionFull.customer_details?.email || "";

      const now = new Date().toISOString();
      const csvLine = `"\${now}","\${nickname}","\${descrizione}","\${importo}","\${telefono}","\${email}","\${session.id}","\${sessionFull.url || ''}"\n`;
      fs.appendFileSync(CSV_PATH, csvLine, { encoding: "utf8" });

      console.log(`Webhook: registrata session ${session.id} - ${descrizione} - €${importo}`);
    } catch (err) {
      console.error("Errore gestione webhook session.completed:", err);
    }
  }

  // Return a 200 to acknowledge receipt of the event
  res.json({ received: true });
});

// After webhook route, use JSON parser for the rest endpoints
app.use(express.json());
app.use(cors());

// --- Create Checkout Session ---
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { descrizione, importoEuro, telefono, email, nickname } = req.body;
    if (!descrizione || !importoEuro) return res.status(400).json({ error: "Dati non validi (descrizione/importo)" });

    // normalize amount
    const unitAmount = Math.round(Number(String(importoEuro).replace(",", ".")) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "it",
      payment_method_types: ["klarna", "card"],
      customer_email: email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            product_data: { name: descrizione },
            unit_amount: unitAmount
          }
        }
      ],
      metadata: {
        nickname: nickname || "",
        telefono: telefono || "",
        descrizione: descrizione || ""
      },
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`
    });

    // append lightweight record (creation) — utile per ricerca veloce
    const now = new Date().toISOString();
    const csvLine = `"\${now}","\${nickname || ""}","\${descrizione}","\${importoEuro}","\${telefono || ""}","\${email || ""}","\${session.id}","\${session.url}"\n`;
    fs.appendFileSync(CSV_PATH, csvLine, { encoding: "utf8" });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("create-checkout error:", err);
    return res.status(500).json({ error: "Errore server", details: err?.message });
  }
});

// --- Session status endpoint (usato dalla UI) ---
app.get("/api/session-status", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent", "payment_intent.charges", "line_items"] });
    const paymentIntent = session.payment_intent;
    const charge = paymentIntent?.charges?.data?.[0];

    const dashboardPrefix = "dashboard.stripe.com";
    const modePrefix = STRIPE_DASHBOARD_MODE === "live" ? "" : "test/";
    const stripeLink = charge ? `https://${dashboardPrefix}/${modePrefix}payments/${charge.id}` : null;

    return res.json({
      sessionStatus: session.status,                       // 'open' etc.
      paymentStatus: paymentIntent?.status || null,       // 'succeeded' etc.
      amount: ((session.amount_total || session.amount_subtotal || 0) / 100).toFixed(2),
      currency: session.currency || "eur",
      customer_email: session.customer_email || null,
      phone: session.metadata?.telefono || null,
      nickname: session.metadata?.nickname || null,
      chargeId: charge?.id || null,
      stripePaymentLink: stripeLink,
      line_items: session.line_items?.data || []
    });
  } catch (err) {
    console.error("session-status error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- Register payment (manual confirmation by seller) ---
app.post("/api/register-payment", (req, res) => {
  try {
    const token = req.headers["x-admin-token"] || req.body.admin_token;
    if (!ADMIN_TOKEN) return res.status(500).json({ error: "ADMIN_TOKEN not configured on server" });
    if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId, nickname, descrizione, importoEuro, telefono, email } = req.body;
    if (!sessionId || !descrizione || !importoEuro) return res.status(400).json({ error: "Dati incompleti" });

    const now = new Date().toISOString();
    const csvLine = `"\${now}","\${nickname || ""}","\${descrizione}","\${importoEuro}","\${telefono || ""}","\${email || ""}","\${sessionId}","-"\n`;
    fs.appendFileSync(CSV_PATH, csvLine, { encoding: "utf8" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("register-payment error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Optional: download CSV (unprotected; if you want add auth)
// uncomment and protect if needed
/*
app.get("/admin/download-vendite", (req, res) => {
  if (!fs.existsSync(CSV_PATH)) return res.status(404).send("Nessun CSV");
  res.download(CSV_PATH, "vendite.csv");
});
*/

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT} (BASE_URL=${BASE_URL})`);
});
