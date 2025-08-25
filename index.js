const express = require("express");
const bodyParser = require("body-parser");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json", // service account JSON
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const spreadsheetId = "YOUR_SHEET_ID"; // from the Google Sheet URL
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "buena123token"; // 👈 your custom token

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge); // ✅ must return challenge
    } else {
      res.sendStatus(403); // ❌ wrong token
    }
  }
});

// Messenger webhook
app.post("/webhook", async (req, res) => {
    const message = req.body.entry[0].messaging[0].message.text.toLowerCase();

    const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

    if (message.startsWith("add")) {
        const [_, qty, item] = message.split(" ");
        await updateInventory(sheets, item, parseInt(qty), "add");
        res.send("Added!");
    } else if (message.startsWith("sold")) {
        const [_, qty, item] = message.split(" ");
        await updateInventory(sheets, item, parseInt(qty), "subtract");
        res.send("Updated!");
    } else if (message.startsWith("show")) {
        const inventory = await getInventory(sheets);
        res.send(inventory);
    } else {
        res.send("Commands: Add [qty] [item], Sold [qty] [item], Show Inventory");
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

app.listen(3000, () => console.log("Bot running on port 3000"));

