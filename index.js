import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

// ----- CONFIG -----
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE"; // replace with your sheet ID
const SHEET_NAME = "Sheet1"; // replace with your sheet name

// ----- READ SECRET FILE -----
const SERVICE_ACCOUNT_PATH = "/etc/secrets/google_service_account.json";

let serviceAccount;
try {
  const jsonString = fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8");
  serviceAccount = JSON.parse(jsonString);
} catch (err) {
  console.error("Failed to read service account JSON:", err);
  process.exit(1);
}

// ----- GOOGLE AUTH -----
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ----- EXPRESS APP -----
const app = express();
app.use(bodyParser.json());

// ----- VERIFY WEBHOOK (optional, for Messenger) -----
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "your_verify_token";

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

// ----- HANDLE INCOMING MESSAGES -----
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "page") {
      body.entry.forEach(async (entry) => {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;
        const messageText = webhookEvent.message.text;

        console.log(`Received message from ${senderId}: ${messageText}`);

        // Write to Google Sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A:B`,
          valueInputOption: "RAW",
          requestBody: {
            values: [[new Date().toISOString(), messageText]],
          },
        });
      });

      res.status(200).send("EVENT_RECEIVED");
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.sendStatus(500);
  }
});

// ----- START SERVER -----
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
