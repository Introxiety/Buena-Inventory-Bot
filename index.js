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

const SPREADSHEET_ID = "1Ul8xKfm-gEG2_nyAUsvx1B7mVu9GcjAkPNdW8fHaDTs";
const RANGE = "Sheet1!A:D"; // Item | Price | Quantity | Total

// === Messenger Bot Setup ===
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const app = express();
app.use(bodyParser.json());

// Session memory to track "Make Request" step
const userSessions = {};

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

        // If user is in Make Request session
        if (userSessions[senderId] === "MAKE_REQUEST") {
          const responseMsg = await handleMakeRequestInput(userMessage);
          delete userSessions[senderId]; // end session
          await sendMessage(senderId, responseMsg);
          continue;
        }

        if (userMessage.toLowerCase().startsWith("add")) {
          const responseMsg = await handleAddCommand(userMessage);
          await sendMessage(senderId, responseMsg);
        } else if (userMessage.toLowerCase() === "show request") {
          const responseMsg = await handleShowRequest();
          await sendMessage(senderId, responseMsg);
        } else if (userMessage.toLowerCase() === "make request") {
          const responseMsg = await startMakeRequest(senderId);
          await sendMessage(senderId, responseMsg);
        } else if (userMessage.toLowerCase() === "total") {
          const responseMsg = await handleTotalCommand();
          await sendMessage(senderId, responseMsg);
        } else {
          await sendMessage(
            senderId,
            "Sorry, I only understand:\n👉 Add 10 Pandecoco\n👉 Show Request\n👉 Make Request\n👉 Total"
          );
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// === Commands ===

// Add Command
async function handleAddCommand(message) {
  const regex = /add\s+(\d+)\s+(.+)/i;
  const match = message.match(regex);

  if (!match) return "❌ Could not understand. Try: Add 10 Pandecoco";

  const quantity = parseInt(match[1], 10);
  const itemName = match[2].trim();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    let itemRowIndex = rows.findIndex(
      (row) => row[0] && row[0].toLowerCase() === itemName.toLowerCase()
    );

    if (itemRowIndex >= 0) {
      let currentQty = parseInt(rows[itemRowIndex][2] || "0", 10);
      let newQty = currentQty + quantity;

      // Update only the quantity column (C)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!C${itemRowIndex + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newQty]] },
      });

      return `✅ Added ${quantity} ${itemName}. New quantity: ${newQty}`;
    } else {
      return `❌ Item "${itemName}" not found in inventory.`;
    }
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update spreadsheet.";
  }
}

// Show Request (with "-" separator)
async function handleShowRequest() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "📋 Current Inventory:\n";
    for (let i = 1; i < rows.length; i++) {
      const [item, , qty] = rows[i];
      if (item) {
        msg += `${item} - ${qty || 0}\n`;
      }
    }

    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to read inventory.";
  }
}

// Total Command
async function handleTotalCommand() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "💰 Totals:\n";
    let grandTotal = 0;

    for (let i = 1; i < rows.length; i++) {
      const [item, , , total] = rows[i];
      if (item && total) {
        let value = parseFloat(total) || 0;
        grandTotal += value;
        msg += `${item} - ${value}\n`;
      }
    }

    msg += `\nTOTAL = ${grandTotal}`;
    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to calculate totals.";
  }
}

// Start Make Request
async function startMakeRequest(senderId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "📝 Please send me new quantities in this format:\n";
    for (let i = 1; i < rows.length; i++) {
      const [item] = rows[i];
      if (item) msg += `${item}\n`;
    }

    userSessions[senderId] = "MAKE_REQUEST";
    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to load items.";
  }
}

// Handle Make Request Input
async function handleMakeRequestInput(userMessage) {
  try {
    const lines = userMessage.split("\n").map((l) => l.trim()).filter(Boolean);

    const updates = {};
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const qty = parseInt(parts.pop(), 10);
      const item = parts.join(" ");
      if (item && !isNaN(qty)) updates[item.toLowerCase()] = qty;
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });
    const rows = res.data.values || [];

    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0];
      if (item && updates[item.toLowerCase()] !== undefined) {
        const newQty = updates[item.toLowerCase()];
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Sheet1!C${i + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [[newQty]] },
        });
      }
    }

    let confirmMsg = "✅ Updated quantities:\n";
    for (const [item, qty] of Object.entries(updates)) {
      confirmMsg += `${item} = ${qty}\n`;
    }

    return confirmMsg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update request.";
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
