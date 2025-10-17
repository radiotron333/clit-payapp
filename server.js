import express from "express";
import cors from "cors";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const {
  STRIPE_SECRET_KEY,
  FRONTEND_SUCCESS_URL = "https://www.webbalo.com/clit/clitpay.html",
} = process.env;

if (!STRIPE_SECRET_KEY) {
  console.warn("ATTENZIONE: STRIPE_SECRET_KEY non impostata");
}

const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_test_dummy");

const allowed = ["https://webbalo.com", "https://www.webbalo.com"];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);

// Health check
app.get("/", (_, res) => res.send("ok"));
app.get("/healthz", (_, res) => res.send("ok"));

// Serve il file client
app.get("/pagamenti.js", (req, res) => {
  res.sendFile(path.join(__dirname, "pagamenti.js"));
});

// Endpoint per creare link pagamento
app.post("/create-link", async (req, res) => {
  try {
    const { descrizione, amount_eur } = req.body;
    if (!amount_eur || !descrizione) {
      return res.status(400).json({ error: "Dati mancanti" });
    }
    const unit_amount = Math.round(Number(amount_eur) * 100);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount,
            product_data: { name: descrizione },
          },
          quantity: 1,
        },
      ],
      success_url: FRONTEND_SUCCESS_URL + "?esito=ok",
      cancel_url: FRONTEND_SUCCESS_URL + "?esito=ko",
      payment_method_types: ["card", "klarna"]
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("clit-payapp up on :" + port));