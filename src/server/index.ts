import { WebSocketServer, WebSocket } from 'ws';
import { CustomWebSocket, RedisBroadcastMessage } from './types';
import { chatCache } from './services/redis.service';
import { handleConnection, handleMessage } from './handlers/chat.handler';

const WS_PORT = process.env.port || 8080;
const wss = new WebSocketServer({ port: Number(WS_PORT) });

console.log(`wss open, port is: ${WS_PORT}`);

chatCache.subscribeToChannel((message) => {
  try {
    const parsedMessage: RedisBroadcastMessage = JSON.parse(message);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(parsedMessage));
      }
    });
  } catch (error) {
    console.error('error parsing message from Redis', error);
  }
});

wss.on('connection', async (ws: CustomWebSocket, req) => {
  await handleConnection(ws, req);

  ws.on('message', (rawData: Buffer) => handleMessage(ws, rawData));

  const pingInterval = setInterval(() => {
    if (ws.isAlive === false) {
      console.log(`client ${ws.userId} didn't send ping, closing a socket`);
      ws.terminate();
      return clearInterval(pingInterval);
    }
    ws.isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 5000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    console.log('client disconnected: ', ws.userId);
    clearInterval(pingInterval);
  });
});
