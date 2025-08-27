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
// Simple cache for sheet rows
let sheetCache = { rows: [], lastFetch: 0 };
const CACHE_TTL = 5000; // 5 seconds

// Helper: fetch rows with caching
async function getRows() {
  const now = Date.now();
  if (sheetCache.rows.length && now - sheetCache.lastFetch < CACHE_TTL) {
    return sheetCache.rows;
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });
  sheetCache.rows = res.data.values || [];
  sheetCache.lastFetch = now;
  return sheetCache.rows;
}

// Helper: batch update quantities
async function batchUpdateQuantities(updates) {
  const data = Object.entries(updates).map(([rowIndex, newQty]) => ({
    range: `Sheet1!C${parseInt(rowIndex) + 1}`,
    values: [[newQty]],
  }));

  if (!data.length) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });

  // bust cache
  sheetCache = { rows: [], lastFetch: 0 };
}

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

        let responseMsg;
        if (userMessage.toLowerCase().startsWith("add")) {
          responseMsg = await handleAddCommand(userMessage);
        } else if (userMessage.toLowerCase() === "show request") {
          responseMsg = await handleShowRequest();
        } else if (userMessage.toLowerCase() === "make request") {
          responseMsg = await startMakeRequest(senderId);
        } else if (userMessage.toLowerCase() === "total") {
          responseMsg = await handleTotalCommand();
        } else {
          responseMsg =
            "Sorry, I only understand:\n👉 Add 10 Pandecoco\n👉 Show Request\n👉 Make Request\n👉 Total";
        }
        await sendMessage(senderId, responseMsg);
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// === Commands ===
async function handleAddCommand(message) {
  const regex = /add\s+(\d+)\s+(.+)/i;
  const match = message.match(regex);
  if (!match) return "❌ Could not understand. Try: Add 10 Pandecoco";

  const quantity = parseInt(match[1], 10);
  const itemName = match[2].trim().toLowerCase();

  try {
    const rows = await getRows();
    let itemRowIndex = rows.findIndex(
      (row) => row[0] && row[0].toLowerCase() === itemName
    );

    if (itemRowIndex >= 0) {
      let currentQty = parseInt(rows[itemRowIndex][2] || "0", 10);
      let newQty = currentQty + quantity;

      await batchUpdateQuantities({ [itemRowIndex]: newQty });

      return `✅ Added ${quantity} ${itemName}. New quantity: ${newQty}`;
    } else {
      return `❌ Item "${itemName}" not found in inventory.`;
    }
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update spreadsheet.";
  }
}

async function handleShowRequest() {
  try {
    const rows = await getRows();
    if (rows.length <= 1) return "❌ No items found.";

    return (
      "📋 Current Inventory:\n" +
      rows
        .slice(1)
        .map(([item, , qty]) => (item ? `${item} - ${qty || 0}` : ""))
        .filter(Boolean)
        .join("\n")
    );
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to read inventory.";
  }
}

async function handleTotalCommand() {
  try {
    const rows = await getRows();
    if (rows.length <= 1) return "❌ No items found.";

    let grandTotal = 0;
    let msg = "💰 Totals:\n";

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

async function startMakeRequest(senderId) {
  try {
    const rows = await getRows();
    if (rows.length <= 1) return "❌ No items found.";

    userSessions[senderId] = "MAKE_REQUEST";

    return (
      "📝 Please send me new quantities in this format:\n" +
      rows
        .slice(1)
        .map(([item]) => item || "")
        .filter(Boolean)
        .join("\n")
    );
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to load items.";
  }
}

async function handleMakeRequestInput(userMessage) {
  try {
    const updates = {};
    const lines = userMessage
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const qty = parseInt(parts.pop(), 10);
      const item = parts.join(" ").toLowerCase();
      if (item && !isNaN(qty)) updates[item] = qty;
    }

    const rows = await getRows();
    const updateMap = {};

    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0];
      if (item && updates[item.toLowerCase()] !== undefined) {
        updateMap[i] = updates[item.toLowerCase()];
      }
    }

    await batchUpdateQuantities(updateMap);

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
