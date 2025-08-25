import express from "express";
import bodyParser from "body-parser";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

// Google Sheets setup
const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Replace with your actual spreadsheet ID
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE";

// Helper function to add a row to the spreadsheet
async function addRowToSheet(item, quantity) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:B", // adjust your sheet name & range
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[item, quantity]],
      },
    });
    console.log("Row added:", response.data);
  } catch (error) {
    console.error("Error adding row:", error);
  }
}

// Webhook endpoint (example for Messenger webhook)
app.post("/webhook", async (req, res) => {
  const messagingEvents = req.body.entry?.[0]?.messaging || [];
  
  for (const event of messagingEvents) {
    if (event.message && event.message.text) {
      const text = event.message.text;
      console.log("Incoming message:", text);

      // Example: parse messages like "Add 10 Pandecoco"
      const match = text.match(/Add (\d+) (.+)/i);
      if (match) {
        const quantity = match[1];
        const item = match[2];
        await addRowToSheet(item, quantity);
      }
    }
  }

  res.sendStatus(200);
});

// Basic route for testing
app.get("/", (req, res) => {
  res.send("Bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
