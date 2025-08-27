// index.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";
import fs from "fs";

// === Google Sheets Setup ===
const SERVICE_ACCOUNT_FILE = "/etc/secrets/buena-bot-9f2ac8cdc6b3.json"; // Render path
const credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf-8"));
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE"; 
const RANGE = "Sheet1!A:C"; // assuming A=Item, B=Price, C=Quantity

// === Messenger Setup ===
const PAGE_ACCESS_TOKEN = "YOUR_PAGE_ACCESS_TOKEN_HERE";
const VERIFY_TOKEN = "YOUR_VERIFY_TOKEN_HERE";

// === Session Store ===
const sessions = {}; // { senderId: { mode: "make_request" } }

// === Express App ===
const app = express();
app.use(bodyParser.json());

// === Send Message Helper ===
async function sendMessage(senderId, text) {
  await axios.post(
    `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: senderId },
      message: { text },
    }
  );
}

// === Handle Add Command ===
async function handleAddCommand(message) {
  try {
    const parts = message.split(" ");
    const quantity = parseInt(parts[1], 10);
    const itemName = parts.slice(2).join(" ");

    if (isNaN(quantity) || !itemName) {
      return "❌ Format: Add <quantity> <item>";
    }

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

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!C${itemRowIndex + 1}`, // update only Quantity col
        valueInputOption: "RAW",
        requestBody: { values: [[newQty.toString()]] },
      });

      return `✅ Added ${quantity} ${itemName}. New quantity: ${newQty}`;
    } else {
      return `❌ Item "${itemName}" not found in spreadsheet.`;
    }
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to update Google Sheets.";
  }
}

// === Handle Show Request ===
async function handleShowRequest() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No data found.";

    let responseLines = [];
    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0];
      const qty = rows[i][2] || 0;
      if (item) responseLines.push(`${item} ${qty}`);
    }

    return responseLines.join("\n");
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to fetch requests.";
  }
}

// === Handle Make Request Template ===
async function handleMakeRequestTemplate() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "❌ No items found.";

    let responseLines = [];
    for (let i = 1; i < rows.length; i++) {
      const item = rows[i][0];
      if (item) responseLines.push(item);
    }

    return responseLines.join("\n");
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to fetch items.";
  }
}

// === Handle Make Request Save ===
async function handleMakeRequestSave(message) {
  try {
    const lines = message.split("\n").map((l) => l.trim()).filter((l) => l);
    let updates = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      const qty = parseInt(parts.pop(), 10);
      const itemName = parts.join(" ");

      if (!itemName || isNaN(qty)) continue;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: RANGE,
      });
      const rows = res.data.values || [];

      let itemRowIndex = rows.findIndex(
        (row) => row[0] && row[0].toLowerCase() === itemName.toLowerCase()
      );

      if (itemRowIndex >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Sheet1!C${itemRowIndex + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [[qty.toString()]] },
        });
        updates.push(`${itemName} → ${qty}`);
      } else {
        updates.push(`❌ Item "${itemName}" not found`);
      }
    }

    if (updates.length === 0) return "❌ No valid items provided.";
    return `✅ Request saved:\n${updates.join("\n")}`;
  } catch (err) {
    console.error("Google Sheets Error:", err);
    return "❌ Failed to save request.";
  }
}

// === Webhook Verification ===
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// === Webhook Receiver ===
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userMessage = webhookEvent.message.text.trim();

        if (userMessage.toLowerCase().startsWith("add")) {
          const responseMsg = await handleAddCommand(userMessage);
          await sendMessage(senderId, responseMsg);

        } else if (userMessage.toLowerCase() === "show request") {
          const responseMsg = await handleShowRequest();
          await sendMessage(senderId, responseMsg);

        } else if (userMessage.toLowerCase() === "make request") {
          sessions[senderId] = { mode: "make_request" };
          const responseMsg = await handleMakeRequestTemplate();
          await sendMessage(
            senderId,
            "Give me the list of items with quantities like:\nPandecoco 10\nCheesebread 30\nSpanish 50"
          );
          await sendMessage(senderId, responseMsg);

        } else if (sessions[senderId] && sessions[senderId].mode === "make_request") {
          const responseMsg = await handleMakeRequestSave(userMessage);
          delete sessions[senderId]; // clear session
          await sendMessage(senderId, responseMsg);

        } else {
          await sendMessage(
            senderId,
            "❌ Commands I understand:\n- Add 10 Pandecoco\n- Show Request\n- Make Request"
          );
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
