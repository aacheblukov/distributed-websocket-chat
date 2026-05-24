import Redis from 'ioredis';
import { Message, RedisBroadcastMessage } from '../types';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const CHAT_CHANNEL = 'main_chat_channel';
const REDIS_HISTORY_KEY = 'chat:history:latest';

export const redisPub = new Redis({ host: REDIS_HOST });
export const redisSub = new Redis({ host: REDIS_HOST });
export const redisCache = new Redis({ host: REDIS_HOST });

export const chatCache = {
  async getHistory(): Promise<Message[]> {
    const cachedMessages = await redisCache.lrange(REDIS_HISTORY_KEY, 0, -1);
    return cachedMessages.map((msg) => JSON.parse(msg));
  },

  async saveToHistory(message: RedisBroadcastMessage): Promise<void> {
    const pipeline = redisCache.pipeline();
    pipeline.rpush(REDIS_HISTORY_KEY, JSON.stringify(message));
    pipeline.ltrim(REDIS_HISTORY_KEY, -50, -1);
    await pipeline.exec();
  },

  async warmUpHistory(historyData: Message[]): Promise<void> {
    const pipeline = redisCache.pipeline();
    historyData.forEach((msg) => {
      pipeline.rpush(REDIS_HISTORY_KEY, JSON.stringify(msg));
    });
    await pipeline.exec();
  },

  async publishMessage(message: RedisBroadcastMessage): Promise<void> {
    await redisPub.publish(CHAT_CHANNEL, JSON.stringify(message));
  },

  async subscribeToChannel(onMessage: (message: string) => void): Promise<void> {
    await redisSub.subscribe(CHAT_CHANNEL);
    redisSub.on('message', (channel, message) => {
      if (channel === CHAT_CHANNEL) {
        onMessage(message);
      }
    });
  },
};
