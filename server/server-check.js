import WebSocket from "ws";

const SIGNALING_SERVER = "wss://webrtc-server-vial.onrender.com/";
const ROOM_ID = "testroom";
const USER1 = "peerA";
const USER2 = "peerB";

function setupPeer(name) {
  const ws = new WebSocket(SIGNALING_SERVER);

  ws.on("open", () => {
    console.log(`✅ ${name} connected`);
    ws.send(JSON.stringify({ type: "join", room: ROOM_ID, username: name }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "ready", room: ROOM_ID, username: name }));
    }, 500);
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());
    console.log(`📩 ${name} received:`, data);
  });

  ws.on("close", () => console.log(`🔌 ${name} disconnected`));
  ws.on("error", (err) => console.error(`❌ ${name} error:`, err.message));

  return ws;
}

// Run both fake peers
setupPeer(USER1);
setupPeer(USER2);
