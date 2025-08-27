// index.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";
import fs from "fs";

// === Google Sheets Setup ===
const SERVICE_ACCOUNT_FILE = "/etc/secrets/buena-bot-9f2ac8cdc6b3.json"; // Render path
const credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});
const sheets = google.sheets({ version: "v4", auth });

// === Spreadsheet Setup ===
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // replace with your ID
const RANGE = "Sheet1!A:D"; // Assuming columns: Item | Price | Quantity | Total

// === Express Setup ===
const app = express();
app.use(bodyParser.json());

// === Handle Messenger Webhook ===
app.post("/webhook", async (req, res) => {
  const message = req.body.message?.text;
  let reply = "❌ I didn’t understand that.";

  if (!message) {
    return res.sendStatus(200);
  }

  if (message.startsWith("Add")) {
    reply = await handleAddCommand(message);
  } else if (message === "Show Request") {
    reply = await handleShowRequest();
  } else if (message === "Make Request") {
    reply = await handleMakeRequestTemplate();
  } else if (await isMakeRequestResponse(message)) {
    reply = await handleMakeRequest(message);
  }

  // send reply back to messenger (mocked here)
  console.log("Bot Reply:", reply);
  res.sendStatus(200);
});

// === Add Command (single item) ===
async function handleAddCommand(message) {
  try {
    const parts = message.split(" ");
    if (parts.length < 3) return "❌ Usage: Add <item> <quantity>";

    const itemName = parts[1];
    const quantity = parseInt(parts[2], 10);
    if (isNaN(quantity)) return "❌ Invalid quantity.";

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No inventory found.";

    const itemRowIndex = rows.findIndex(
      (row, idx) => idx > 0 && row[0].toLowerCase() === itemName.toLowerCase()
    );

    if (itemRowIndex < 0) return `❌ Item "${itemName}" not found.`;

    let currentQty = parseInt(rows[itemRowIndex][2] || "0", 10);
    let newQty = currentQty + quantity;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!C${itemRowIndex + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newQty.toString()]] },
    });

    return `✅ Added ${quantity} ${itemName}. New quantity: ${newQty}`;
  } catch (err) {
    console.error("Add Error:", err);
    return "❌ Failed to update item.";
  }
}

// === Show Request (aligned formatting) ===
async function handleShowRequest() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    // Find longest item name for alignment
    let maxLength = 0;
    for (let i = 1; i < rows.length; i++) {
      const [item] = rows[i];
      if (item && item.length > maxLength) maxLength = item.length;
    }

    // Build aligned message
    let msg = "📋 Current Inventory:\n";
    for (let i = 1; i < rows.length; i++) {
      const [item, , qty] = rows[i];
      if (item) {
        const paddedItem = item.padEnd(maxLength + 4, " ");
        msg += `${paddedItem}${qty || 0}\n`;
      }
    }

    return msg.trim();
  } catch (err) {
    console.error("Show Error:", err);
    return "❌ Failed to read inventory.";
  }
}

// === Make Request (step 1: template) ===
async function handleMakeRequestTemplate() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "📝 Please send me the new quantities in this format:\n\n";
    for (let i = 1; i < rows.length; i++) {
      const [item] = rows[i];
      if (item) msg += `${item}\n`;
    }

    return msg.trim();
  } catch (err) {
    console.error("Template Error:", err);
    return "❌ Failed to get item list.";
  }
}

// === Detect if user reply is a Make Request response ===
async function isMakeRequestResponse(message) {
  return message.includes("\n") && message.split("\n")[0].includes(" ");
}

// === Make Request (step 2: update quantities) ===
async function handleMakeRequest(message) {
  try {
    const lines = message.split("\n");
    let updates = [];

    for (let line of lines) {
      const parts = line.trim().split(" ");
      if (parts.length >= 2) {
        const item = parts[0];
        const qty = parseInt(parts[1], 10);
        if (!isNaN(qty)) {
          updates.push({ item, qty });
        }
      }
    }

    if (updates.length === 0) return "❌ No valid items found.";

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];

    let requests = [];
    for (let update of updates) {
      const idx = rows.findIndex(
        (row, i) => i > 0 && row[0].toLowerCase() === update.item.toLowerCase()
      );
      if (idx >= 0) {
        requests.push({
          range: `Sheet1!C${idx + 1}`,
          values: [[update.qty.toString()]],
        });
      }
    }

    if (requests.length === 0) return "❌ No matching items found.";

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: requests,
      },
    });

    // Format confirmation with alignment
    let maxLength = Math.max(...updates.map((u) => u.item.length));
    let confirmation = "✅ Updated quantities:\n";
    for (let u of updates) {
      const paddedItem = u.item.padEnd(maxLength + 4, " ");
      confirmation += `${paddedItem}${u.qty}\n`;
    }

    return confirmation.trim();
  } catch (err) {
    console.error("MakeRequest Error:", err);
    return "❌ Failed to update request.";
  }
}

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server running on port ${PORT}`));
