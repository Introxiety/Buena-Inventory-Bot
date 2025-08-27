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

const SPREADSHEET_ID = "1Ul8xKfm-gEG2_nyAUsvx1B7mVu9GcjAkPNdW8fHaDTs"; // your sheet id
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
        const userMessage = webhookEvent.message.text.trim();
        console.log("📩 User:", userMessage);

        if (userMessage.toLowerCase().startsWith("add")) {
          const responseMsg = await handleAddCommand(userMessage);
          await sendMessage(senderId, responseMsg);

        } else if (userMessage.toLowerCase() === "show request") {
          const responseMsg = await handleShowRequest();
          await sendMessage(senderId, responseMsg);

        } else {
          await sendMessage(senderId, "❌ I only understand commands like:\n- Add 10 Pandecoco\n- Show Request");
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
      // Update quantity only
      let currentQty = parseInt(rows[itemRowIndex][2] || "0", 10);
      let newQty = currentQty + quantity;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!C${itemRowIndex + 1}`, // only the Quantity column
        valueInputOption: "RAW",
        requestBody: { values: [[newQty.toString()]] },
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

// === Show Request Handler ===
async function handleShowRequest() {
  try {
    // Read from sheet (A = Item, C = Quantity)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:C",
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No data found in the sheet.";

    // Skip header row (index 0)
    let responseLines = [];
    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0];
      const qty = rows[i][2] || "0";
      if (item) {
        responseLines.push(`${item} ${qty}`);
      }
    }

    return responseLines.join("\n"); // Combine into one message
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to fetch data from spreadsheet.";
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
