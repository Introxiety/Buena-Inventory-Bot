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

const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // replace with your sheet id
const RANGE = "Sheet1!A:C"; // item | price | qty | total (col D)

// === Express Setup ===
const app = express();
app.use(bodyParser.json());

// === Messenger Verify ===
app.get("/", (req, res) => {
  res.send("✅ Buena Bot is running");
});

// === Messenger Webhook ===
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      if (event.message && event.message.text) {
        const senderId = event.sender.id;
        const text = event.message.text.trim();

        const response = await handleMessage(text);
        await callSendAPI(senderId, response);
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// === Handle Message ===
async function handleMessage(text) {
  const command = text.split(" ")[0].toLowerCase();
  let response = "❌ Unknown command.";

  if (command === "add") {
    response = await handleAddCommand(text);
  } else if (command === "show" && text.toLowerCase().includes("request")) {
    response = await handleShowRequest();
  } else if (command === "make" && text.toLowerCase().includes("request")) {
    response = await handleMakeRequest();
  } else if (command === "total") {
    response = await handleTotalRequest();
  }

  return response;
}

// === ADD Command ===
async function handleAddCommand(text) {
  const parts = text.split(" ");
  if (parts.length < 3) return "⚠️ Usage: Add ItemName Quantity";

  const itemName = parts[1];
  const qtyToAdd = parseInt(parts[2], 10);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0].toLowerCase() === itemName.toLowerCase()) {
        let currentQty = parseInt(rows[i][2] || "0", 10);
        let newQty = currentQty + qtyToAdd;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Sheet1!C${i + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [[newQty]] },
        });
        return `✅ Updated ${itemName}: ${currentQty} → ${newQty}`;
      }
    }
    return `❌ Item "${itemName}" not found.`;
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update sheet.";
  }
}

// === SHOW REQUEST ===
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
      if (item) msg += `${item} - ${qty || 0}\n`;
    }

    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to read inventory.";
  }
}

// === MAKE REQUEST ===
async function handleMakeRequest() {
  try {
    // get item list first
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "📝 Please reply with your request in this format:\n\n";
    for (let i = 1; i < rows.length; i++) {
      const [item] = rows[i];
      if (item) msg += `${item} <quantity>\n`;
    }
    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to fetch item list.";
  }
}

// === TOTAL COMMAND ===
async function handleTotalRequest() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:D", // col D is total (price*qty)
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "💰 Sales Total:\n";
    let grandTotal = 0;

    for (let i = 1; i < rows.length; i++) {
      const [item, , , total] = rows[i];
      if (item && total) {
        const num = parseFloat(total) || 0;
        msg += `${item} - ${num}\n`;
        grandTotal += num;
      }
    }

    msg += `\nTOTAL = ${grandTotal}`;
    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to calculate totals.";
  }
}

// === Send API ===
async function callSendAPI(senderId, message) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
  await axios.post(
    `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text: message },
    }
  );
}

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
