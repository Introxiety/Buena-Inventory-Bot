// index.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

const app = express();
app.use(bodyParser.json());

// ------------------- CONFIG -------------------
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // Messenger token
const SPREADSHEET_ID = "1Ul8xKfm-gEG2_nyAUsvx1B7mVu9GcjAkPNdW8fHaDTs"; // Google Sheet ID
const VERIFY_TOKEN = "buena123token"; // Webhook verify token

// ------------------- GOOGLE SHEETS AUTH -------------------
const auth = new GoogleAuth({
  keyFile: "buena-bot-954020809440.json", // service account JSON
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// ------------------- ROOT ROUTE -------------------
app.get("/", (req, res) => {
  res.send("✅ Buena Inventory Bot is running.");
});

// ------------------- WEBHOOK VERIFY -------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
});

// ------------------- WEBHOOK POST -------------------
app.post("/webhook", async (req, res) => {
  console.log("📩 Incoming webhook:", JSON.stringify(req.body, null, 2));

  try {
    const body = req.body;

    if (body.object === "page") {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        if (!webhookEvent.message || !webhookEvent.message.text) continue;

        const senderId = webhookEvent.sender.id;
        const message = webhookEvent.message.text.toLowerCase();

        const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

        if (message.startsWith("add")) {
          const [_, qty, ...itemParts] = message.split(" ");
          const item = itemParts.join(" ");
          await updateInventory(sheets, item, parseInt(qty), "add");
          await sendMessage(senderId, `✅ Added ${qty} ${item}`);
        } else if (message.startsWith("sold")) {
          const [_, qty, ...itemParts] = message.split(" ");
          const item = itemParts.join(" ");
          await updateInventory(sheets, item, parseInt(qty), "subtract");
          await sendMessage(senderId, `📉 Sold ${qty} ${item}`);
        } else if (message.startsWith("show")) {
          const inventory = await getInventory(sheets);
          await sendMessage(senderId, `📦 Inventory:\n${inventory}`);
        } else {
          await sendMessage(
            senderId,
            "Commands:\n👉 Add [qty] [item]\n👉 Sold [qty] [item]\n👉 Show"
          );
        }
      }
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.sendStatus(500);
  }
});

// ------------------- HELPERS -------------------
async function updateInventory(sheets, item, qty, action) {
  const range = "Sheet1!A:B";
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].toLowerCase() === item.toLowerCase()) {
      let current = parseInt(rows[i][1] || "0");
      current = action === "add" ? current + qty : current - qty;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!B${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [[current]] },
      });
      return;
    }
  }

  // If item not found, add a new row
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A:B",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[item, qty]] },
  });
}

async function getInventory(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A:B",
  });
  const rows = res.data.values || [];
  return rows.map((r) => `${r[0]}: ${r[1]}`).join("\n");
}

async function sendMessage(senderId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: { text },
      }
    );
  } catch (err) {
    console.error("❌ Send message error:", err.response?.data || err.message);
  }
}

// ------------------- START SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot running on port ${PORT}`));
