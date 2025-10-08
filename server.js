import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();

// Serve static first
app.use(express.static("public"));

// Stripe init
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Directories
const PUBLIC_DIR = path.resolve("./public");
const RECEIPTS_DIR = path.join(PUBLIC_DIR, "receipts");
await fs.ensureDir(RECEIPTS_DIR);

// CSV vendite (non persistente su alcuni host)
const CSV_PATH = "./vendite.csv";
if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, "data,nickname,descrizione,importo,telefono,email,session_id,session_url\n");
}

// Nodemailer
const smtpTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Helper PDF
async function createReceiptPdf({ sessionId, descrizione, importoEuro, nickname, telefono, email, paymentDate, paymentMethod }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", async () => {
        const pdfBuffer = Buffer.concat(chunks);
        const outPath = path.join(RECEIPTS_DIR, `${sessionId}.pdf`);
        await fs.writeFile(outPath, pdfBuffer);
        resolve({ pdfBuffer, outPath });
      });

      doc.fontSize(18).text("Prosolar Italia - Ricevuta di pagamento", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Data: ${paymentDate || new Date().toISOString()}`);
      doc.text(`ID sessione: ${sessionId}`);
      if (nickname) doc.text(`Cliente (nickname): ${nickname}`);
      if (email) doc.text(`Email cliente: ${email}`);
      if (telefono) doc.text(`Telefono cliente: ${telefono}`);
      doc.moveDown();
      doc.fontSize(14).text("Dettagli ordine");
      doc.moveDown(0.4);
      doc.fontSize(12).text(`Prodotto / Descrizione: ${descrizione}`);
      doc.text(`Importo: € ${importoEuro}`);
      if (paymentMethod) doc.text(`Metodo di pagamento: ${paymentMethod}`);
      doc.moveDown();
      doc.text("Grazie per aver acquistato con Prosolar Italia.", { italics: true });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// --- Webhook endpoint (must use raw body) ---
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      // retrieve expanded session to get payment_intent and line_items
      const sessionFull = await stripe.checkout.sessions.retrieve(session.id, { expand: ["payment_intent","line_items"] });
      const paymentIntent = sessionFull.payment_intent;
      const paymentMethod = paymentIntent?.payment_method_types?.[0] || (paymentIntent?.charges?.data?.[0]?.payment_method_details?.type);
      const paymentDate = new Date((paymentIntent?.created || Date.now()) * 1000).toISOString();

      // Try to get description and amount
      let descrizione = "";
      try { descrizione = sessionFull.line_items?.data?.[0]?.description || sessionFull.metadata?.descrizione || "Prodotto"; } catch(e){ descrizione = "Prodotto"; }
      const importoEuro = ((sessionFull.amount_total || sessionFull.amount_subtotal) / 100).toFixed(2);
      const customerEmail = sessionFull.customer_email || sessionFull.customer_details?.email || "";
      const telefono = sessionFull.metadata?.telefono || "";
      const nickname = sessionFull.metadata?.nickname || "";

      // create PDF
      const { pdfBuffer, outPath } = await createReceiptPdf({
        sessionId: session.id,
        descrizione,
        importoEuro,
        nickname,
        telefono,
        email: customerEmail,
        paymentDate,
        paymentMethod
      });

      const sellerEmail = process.env.SELLER_EMAIL;
      const subject = `Ricevuta pagamento - Prosolar Italia - ${descrizione} - ${importoEuro}€`;
      const text = `Pagamento ricevuto per ${descrizione} (${importoEuro}€).\nID sessione: ${session.id}`;
      const attachments = [{ filename: `${session.id}.pdf`, content: pdfBuffer }];

      // send seller email
      if (sellerEmail && process.env.SMTP_USER) {
        await smtpTransport.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: sellerEmail,
          subject,
          text,
          attachments
        });
        console.log("Email inviata al venditore:", sellerEmail);
      }

      // send to customer
      if (customerEmail && process.env.SMTP_USER) {
        await smtpTransport.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: customerEmail,
          subject: `Ricevuta Prosolar Italia - ${descrizione}`,
          text: `Grazie per il pagamento. In allegato la ricevuta.\n\n${text}`,
          attachments
        });
        console.log("Email inviata al cliente:", customerEmail);
      }

    } catch (err) {
      console.error("Errore nel webhook handling:", err);
    }
  }

  res.status(200).json({ received: true });
});

app.use(express.json());
app.use(cors());

app.post("/api/create-checkout", async (req, res) => {
  try {
    const { descrizione, importoEuro, telefono, email, nickname } = req.body;
    if (!descrizione || !importoEuro) return res.status(400).json({ error: "Dati non validi" });

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
      success_url: `${process.env.BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel.html`
    });

    const now = new Date().toISOString();
    const csvLine = `"${now}","${nickname || ""}","${descrizione}","${importoEuro}","${telefono || ""}","${email || ""}","${session.id}","${session.url}"\n`;
    fs.appendFileSync(CSV_PATH, csvLine);

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Errore server", details: err?.message });
  }
});

app.get("/admin/download-vendite", (req, res) => {
  if (!fs.existsSync(CSV_PATH)) return res.status(404).send("Nessun CSV");
  res.download(CSV_PATH, "vendite.csv");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server avviato su http://localhost:${port}`));
