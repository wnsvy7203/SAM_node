import { WebSocketServer, WebSocket } from "ws";

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

function broadcast(obj: unknown) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

wss.on("connection", (ws) => {
  console.log("✅ React client connected");
  ws.send(JSON.stringify({ type: "hello", data: "connected" }));
});

console.log(`🔌 WS listening on ws://localhost:${PORT}`);
export { broadcast };