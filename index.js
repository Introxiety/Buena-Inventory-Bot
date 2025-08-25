// index.js
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";
import fs from "fs";

// Path to your Render Secret file
const SERVICE_ACCOUNT_FILE = "/etc/secrets/buena-bot-1d5ec73d6dc9.json";

// Read and parse the service account JSON
let serviceAccount;
try {
  const fileContent = fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8");
  serviceAccount = JSON.parse(fileContent);
} catch (error) {
  console.error("Failed to read service account JSON:", error);
  process.exit(1); // Stop execution if JSON cannot be read
}

// Create Google Auth client using the parsed credentials
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Initialize Google Sheets API client
const sheets = google.sheets({ version: "v4", auth });

// Example function: read data from a spreadsheet
async function readSheet(spreadsheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    console.log("Sheet data:", response.data.values);
    return response.data.values;
  } catch (err) {
    console.error("Error reading spreadsheet:", err);
  }
}

// Example usage
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE"; // Replace with your actual spreadsheet ID
const RANGE = "Sheet1!A1:C10"; // Change range as needed

readSheet(SPREADSHEET_ID, RANGE);
