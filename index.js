// index.js
import express from "express";
import bodyParser from "body-parser";
import { readFileSync } from "fs";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";

// === CONFIG ===

// Read Google service account JSON from the same folder
let serviceAccount;
try {
  serviceAccount = JSON.parse(
    readFileSync("./google_service_account.json", "utf8")
  );
} catch (err) {
  console.error("Failed to read service account JSON:", err);
  process.exit(1);
}

// Initialize Google Auth
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Spreadsheet ID
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // <-- replace with your Sheet ID

// Google Sheets API client
const sheets = google.sheets({ version: "v4", auth });

// === EXPRESS SERVER ===

const app = express();
app.use(bodyParser.json());

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry[0].messaging[0].message.text;
    console.log("Incoming message:", message);

    // Example: write message to Google Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:A", // write to column A
      valueInputOption: "RAW",
      requestBody: {
        values: [[message]],
      },
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
