// index.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";
import fs from "fs";

// === Google Sheets Setup ===
const SERVICE_ACCOUNT_FILE = "/etc/secrets/buena-bot-9f2ac8cdc6b3.json"; // Render path
const credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));

const auth = google.auth.fromJSON(credentials);
auth.scopes = ["https://www.googleapis.com/auth/spreadsheets"];
const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // put your actual sheet id
const RANGE = "Sheet1!A:D"; // Assuming columns: Item | Price | Quantity | Total

// === Messenger Bot Setup ===
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const app = express();
app.use(bodyParser.json());

// Messenger webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Messenger event listener
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userMessage = webhookEvent.message.text;
        console.log("📩 User:", userMessage);

        if (userMessage.toLowerCase().startsWith("add")) {
          const responseMsg = await handleAddCommand(userMessage);
          await sendMessage(senderId, responseMsg);
        } else {
          await sendMessage(senderId, "Sorry, I only understand commands like: Add 10 Pandecoco");
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// === Command Parser + Google Sheets Writer ===
async function handleAddCommand(message) {
  // Example: "Add 10 Pandecoco"
  const regex = /add\s+(\d+)\s+(.+)/i;
  const match = message.match(regex);

  if (!match) return "❌ Could not understand your command. Try: Add 10 Pandecoco";

  const quantity = parseInt(match[1], 10);
  const itemName = match[2].trim();

  try {
    // Read existing rows
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];

    // Find if item exists
    let itemRowIndex = rows.findIndex(row => row[0] && row[0].toLowerCase() === itemName.toLowerCase());

    if (itemRowIndex >= 0) {
      // Update quantity
      let currentQty = parseInt(rows[itemRowIndex][2] || "0", 10);
      let price = parseFloat(rows[itemRowIndex][1] || "0");
      let newQty = currentQty + quantity;
      let newTotal = price * newQty;

      rows[itemRowIndex][2] = newQty.toString();
      rows[itemRowIndex][3] = newTotal.toString();

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!A${itemRowIndex + 1}:D${itemRowIndex + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [rows[itemRowIndex]] },
      });

      return `✅ Added ${quantity} ${itemName}. New quantity: ${newQty}`;
    } else {
      // Item not found
      return `❌ Item "${itemName}" not found in spreadsheet.`;
    }
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update spreadsheet.";
  }
}

// === Messenger Send Message ===
async function sendMessage(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text },
    }
  );
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

