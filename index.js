// index.js

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

// --- Replace with your actual Spreadsheet ID ---
const spreadsheetId = "YOUR_SPREADSHEET_ID";

// --- Google Auth ---
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // <-- make sure you uploaded this
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// ✅ Messenger Webhook Verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "buena123token"; // use the same verify token you set in Meta

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// ✅ Messenger Webhook (Handles messages)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "page") {
      body.entry.forEach(async (entry) => {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;

        if (webhookEvent.message && webhookEvent.message.text) {
          const message = webhookEvent.message.text.toLowerCase();
          console.log("📩 Received:", message);

          const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

          if (message.startsWith("add")) {
            const [_, qty, item] = message.split(" ");
            await updateInventory(sheets, item, parseInt(qty), "add");
            sendMessage(senderId, `✅ Added ${qty} ${item}`);
          } else if (message.startsWith("sold")) {
            const [_, qty, item] = message.split(" ");
            await updateInventory(sheets, item, parseInt(qty), "subtract");
            sendMessage(senderId, `📉 Sold ${qty} ${item}`);
          } else if (message.startsWith("show")) {
            const inventory = await getInventory(sheets);
            sendMessage(senderId, `📦 Inventory:\n${inventory}`);
          } else {
            sendMessage(
              senderId,
              "Commands:\n- Add [qty] [item]\n- Sold [qty] [item]\n- Show inventory"
            );
          }
        }
      });

      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    console.error("❌ Error in webhook:", err);
    res.sendStatus(500);
  }
});

// --- Send Message to User ---
function sendMessage(senderId, responseText) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // keep this in Render env vars

  axios
    .post(
      `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderId },
        message: { text: responseText },
      }
    )
    .then(() => console.log("📤 Sent:", responseText))
    .catch((err) => console.error("❌ Error sending message:", err.response?.data || err.message));
}

// --- Update Inventory in Google Sheets ---
async function updateInventory(sheets, item, qty, action) {
  const range = "Sheet1!A:B";
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].toLowerCase() === item.toLowerCase()) {
      let current = parseInt(rows[i][1]);
      current = action === "add" ? current + qty : current - qty;
      rows[i][1] = current.toString();

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!B${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [[current]] },
      });
      return;
    }
  }
}

// --- Get Inventory from Google Sheets ---
async function getInventory(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A:B",
  });
  const rows = res.data.values;
  return rows.map((r) => `${r[0]}: ${r[1]}`).join("\n");
}

// --- Start Server ---
app.listen(3000, () => console.log("🚀 Bot running on port 3000"));
