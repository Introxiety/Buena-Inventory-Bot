import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "buena123token"; // same one you set in Meta
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // set in Render Environment

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Webhook for receiving messages
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      const event = entry.messaging[0];
      const senderId = event.sender.id;

      if (event.message && event.message.text) {
        const text = event.message.text.toLowerCase();
        console.log("Received message:", text);

        if (text.includes("add") && text.includes("pandecoco")) {
          await sendMessage(senderId, "✅ Added pandecoco to inventory!");
        } else {
          await sendMessage(senderId, "Sorry, I only understand 'Add pandecoco' right now.");
        }
      }
    });
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// Function to send message
async function sendMessage(senderId, responseText) {
  await fetch(`https://graph.facebook.com/v16.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text: responseText },
    }),
  });
}

// Start server
app.listen(10000, () => console.log("Server is running on port 10000"));
