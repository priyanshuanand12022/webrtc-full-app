import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";

const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("✅ WebRTC signaling server is running."));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = {}; // roomId => Set of sockets
const users = new Map(); // socket => { room, username }

wss.on("connection", (ws) => {
  console.log("🔗 New WebSocket connection");

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error("Invalid JSON:", e);
      return;
    }

    const { type, room, username, to, ...payload } = data;

    if (type === "join") {
      if (!rooms[room]) rooms[room] = new Set();
      rooms[room].add(ws);
      users.set(ws, { room, username });
      console.log(`👤 ${username} joined room ${room}`);

      // Notify other peers
      rooms[room].forEach((peer) => {
        if (peer !== ws && peer.readyState === 1) {
          peer.send(JSON.stringify({ type: "ready", from: username, room }));
        }
      });
    }

    // Forward offers, answers, candidates, chat, typing, etc.
    else if (["offer", "answer", "candidate", "chat", "typing", "raise-hand"].includes(type)) {
      const sender = users.get(ws);
      if (!sender) return;

      // If targeted message
      if (to) {
        [...rooms[sender.room] || []].forEach((peer) => {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ type, from: sender.username, room: sender.room, ...payload }));
          }
        });
      } else {
        // Broadcast to all others
        [...rooms[sender.room] || []].forEach((peer) => {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ type, from: sender.username, room: sender.room, ...payload }));
          }
        });
      }
    }
  });

  ws.on("close", () => {
    const info = users.get(ws);
    if (info) {
      rooms[info.room]?.delete(ws);
      users.delete(ws);
      console.log(`❌ ${info.username} left room ${info.room}`);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Signaling server running on ${PORT}`));
