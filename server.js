import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs-extra";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const CSV_PATH = "./vendite.csv";

// crea CSV se non esiste
if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, "data,descrizione,importo,telefono,email,url\n");
}

// Endpoint: crea Checkout Session + salva dati CSV
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { descrizione, importoEuro, telefono, email } = req.body;
    if (!descrizione || !importoEuro) return res.status(400).json({ error: "Dati non validi" });

    const unitAmount = Math.round(Number(String(importoEuro).replace(",", ".")) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "it",
      payment_method_types: ["klarna", "card"],
      customer_email: email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: { name: descrizione },
          unit_amount: unitAmount
        }
      }],
      success_url: `${process.env.BASE_URL}/success.html`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`
    });

    const now = new Date().toISOString();
    const csvLine = `"${now}","${descrizione}","${importoEuro}","${telefono}","${email}","${session.url}"\n`;
    fs.appendFileSync(CSV_PATH, csvLine);

    return res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server", details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server avviato su http://localhost:${port}`));
