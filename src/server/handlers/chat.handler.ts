import { CustomWebSocket, Message, RedisBroadcastMessage } from '../types';
import { chatCache } from '../services/redis.service';
import { chatDb } from '../services/db.service';

export const handleConnection = async (ws: CustomWebSocket, req: any): Promise<void> => {
  const realIp = req.headers['x-real-ip'] || req.socket.remoteAddress;
  const fullUrl = new URL(req.url ?? 'localhost', `http://${req.headers.host}`);
  ws.userId = fullUrl.searchParams.get('userId') ?? Date.now().toString();
  ws.isAlive = true;

  console.log('new client connected: ', ws.userId, ', ip: ', realIp);

  const greeting = { status: 'connected', userId: ws.userId };
  ws.send(JSON.stringify(greeting));

  try {
    let historyData: Message[] = await chatCache.getHistory();

    if (historyData.length > 0) {
      console.log('redis: history is taken from redis');
    } else {
      console.log('redis: is empty, taking from pgsql');
      historyData = await chatDb.getLatestHistory();

      if (historyData.length > 0) {
        await chatCache.warmUpHistory(historyData);
        console.log('redis cache warmed up with pgsql data');
      }
    }

    ws.send(JSON.stringify({ type: 'HISTORY', payload: historyData }));
  } catch (error) {
    console.error('error getting history, ', error);
  }
};

export const handleMessage = async (ws: CustomWebSocket, rawData: Buffer): Promise<void> => {
  console.log('got message from: ', ws.userId);
  try {
    const data = rawData.toString();
    const messageData = JSON.parse(data);

    if (messageData.type === 'AUTH') {
      console.log(`Client ${ws.userId} authenticated successfully`);
      return;
    }

    const messageText = messageData.text || '';

    chatDb.saveMessage(ws.userId ?? 'unknown', messageText);

    const broadcastMessage: RedisBroadcastMessage = {
      type: 'MESSAGE',
      from: ws.userId ?? 'unknown',
      text: messageText,
      timestamp: Date.now(),
    };

    await chatCache.saveToHistory(broadcastMessage);
    await chatCache.publishMessage(broadcastMessage);
  } catch (error) {
    console.error('error parsing message', error);
  }
};
