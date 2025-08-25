const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json", // service account JSON
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const spreadsheetId = "YOUR_SHEET_ID"; // from Google Sheet
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // 👈 add in Render env

// Root route (to fix "Cannot GET /")
app.get("/", (req, res) => {
    res.send("✅ Messenger Inventory Bot is running!");
});

// Messenger verify webhook
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "buena123token"; // 👈 your custom token

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Send message function
async function sendMessage(senderId, text) {
    const url = `https://graph.facebook.com/v12.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            recipient: { id: senderId },
            message: { text }
        })
    });
}

// Messenger webhook (messages)
app.post("/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "page") {
        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const senderId = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const message = webhook_event.message.text.toLowerCase();
                const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

                if (message.startsWith("add")) {
                    const [_, qty, item] = message.split(" ");
                    await updateInventory(sheets, item, parseInt(qty), "add");
                    await sendMessage(senderId, `✅ Added ${qty} ${item}`);
                } else if (message.startsWith("sold")) {
                    const [_, qty, item] = message.split(" ");
                    await updateInventory(sheets, item, parseInt(qty), "subtract");
                    await sendMessage(senderId, `📉 Sold ${qty} ${item}`);
                } else if (message.startsWith("show")) {
                    const inventory = await getInventory(sheets);
                    await sendMessage(senderId, `📦 Inventory:\n${inventory}`);
                } else {
                    await sendMessage(senderId, "Commands: Add [qty] [item], Sold [qty] [item], Show Inventory");
                }
            }
        }
        res.status(200).send("EVENT_RECEIVED");
    } else {
        res.sendStatus(404);
    }
});

// Helper: Update inventory
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

// Helper: Show inventory
async function getInventory(sheets) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Sheet1!A:B",
    });
    const rows = res.data.values;
    return rows.map(r => `${r[0]}: ${r[1]}`).join("\n");
}

app.listen(3000, () => console.log("🚀 Bot running on port 3000"));
