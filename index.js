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

const SPREADSHEET_ID = "1Ul8xKfm-gEG2_nyAUsvx1B7mVu9GcjAkPNdW8fHaDTs/edit?gid=2044996170#gid=2044996170"; // replace with your sheet ID
const RANGE = "Sheet1!A:D"; // A=Item, B=?, C=Quantity, D=Price

// === Express Setup ===
const app = express();
app.use(bodyParser.json());

// === Messenger Verify Webhook ===
app.get("/", (req, res) => {
  res.send("✅ Buena Bot is running!");
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

        let reply;
        if (/^show request$/i.test(text)) {
          reply = await handleShowRequest();
        } else if (/^add\s+/i.test(text)) {
          reply = await handleAddCommand(text);
        } else if (/^make request$/i.test(text)) {
          reply = await handleMakeRequest();
        } else if (/^total$/i.test(text)) {
          reply = await handleTotal();
        } else if (await isAwaitingRequest(senderId)) {
          reply = await handleMakeRequestInput(senderId, text);
        } else {
          reply = "🤖 Commands: Show Request | Add <item> <qty> | Make Request | Total";
        }

        await sendMessage(senderId, reply);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// === Messenger Send Function ===
async function sendMessage(senderId, text) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
  await axios.post(
    `https://graph.facebook.com/v12.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text },
    }
  );
}

// === Command Handlers ===

// Show Request
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

// Add Command
async function handleAddCommand(text) {
  try {
    const [, itemName, qtyStr] = text.split(/\s+/);
    const qty = parseInt(qtyStr, 10);
    if (!itemName || isNaN(qty)) return "❌ Usage: Add <item> <qty>";

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]?.toLowerCase() === itemName.toLowerCase()) {
        const newQty = (parseInt(rows[i][2] || "0", 10) || 0) + qty;
        rows[i][2] = newQty;

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Sheet1!C${i + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [[newQty]] },
        });

        found = true;
        return `✅ Updated ${itemName} - ${newQty}`;
      }
    }

    if (!found) return `❌ Item "${itemName}" not found.`;
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update.";
  }
}

// Make Request (step 1 → show template)
async function handleMakeRequest() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:A",
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "📋 Enter your request like this:\n";
    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0];
      if (item) msg += `${item} <qty>\n`;
    }

    // mark awaiting request
    awaitingRequestUsers.add("user"); // simple global marker for demo

    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to load items.";
  }
}

// Make Request (step 2 → batch update)
const awaitingRequestUsers = new Set();

async function isAwaitingRequest(senderId) {
  return awaitingRequestUsers.has("user");
}

async function handleMakeRequestInput(senderId, input) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    let rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found in sheet.";

    const updates = {};
    input.split("\n").forEach(line => {
      const [item, qtyStr] = line.trim().split(/\s+/);
      if (item && qtyStr) updates[item.toLowerCase()] = parseInt(qtyStr, 10) || 0;
    });

    // update in memory
    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0]?.toLowerCase();
      if (item && updates[item] !== undefined) {
        rows[i][2] = updates[item];
      }
    }

    // batch update quantities
    const newQuantities = rows.slice(1).map(r => [r[2] || 0]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!C2:C${rows.length}`,
      valueInputOption: "RAW",
      requestBody: { values: newQuantities },
    });

    awaitingRequestUsers.delete("user");

    let msg = "✅ Request updated:\n";
    for (const [item, qty] of Object.entries(updates)) {
      msg += `${item} - ${qty}\n`;
    }

    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update request.";
  }
}

// Total Command
async function handleTotal() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let msg = "📊 Totals:\n";
    let grandTotal = 0;

    for (let i = 1; i < rows.length; i++) {
      const [item, , qty, price] = rows[i];
      const total = (parseInt(qty || "0", 10) || 0) * (parseFloat(price || "0") || 0);
      if (item) {
        msg += `${item} - ${total}\n`;
        grandTotal += total;
      }
    }

    msg += `\nTOTAL - ${grandTotal}`;
    return msg.trim();
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to calculate total.";
  }
}

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

