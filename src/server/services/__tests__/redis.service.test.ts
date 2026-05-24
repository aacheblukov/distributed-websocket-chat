import { chatCache, redisPub, redisSub, redisCache } from '../../services/redis.service';

jest.mock('ioredis', () => {
  const mPipeline = {
    rpush: jest.fn().mockReturnThis(),
    ltrim: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const mRedis = {
    lrange: jest.fn(),
    pipeline: jest.fn(() => mPipeline),
    publish: jest.fn(),
    subscribe: jest.fn(),
    on: jest.fn(),
  };

  return jest.fn(() => mRedis);
});

describe('Redis Service (chatCache)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getHistory', () => {
    it('should fetch list elements from redis and parse them as JSON', async () => {
      const mockCachedStrings = [
        JSON.stringify({ from: 'user1', text: 'hi', timestamp: 111 }),
        JSON.stringify({ from: 'user2', text: 'hello', timestamp: 222 }),
      ];

      (redisCache.lrange as jest.Mock).mockResolvedValue(mockCachedStrings);

      const result = await chatCache.getHistory();

      expect(redisCache.lrange).toHaveBeenCalledWith('chat:history:latest', 0, -1);
      expect(result).toEqual([
        { from: 'user1', text: 'hi', timestamp: 111 },
        { from: 'user2', text: 'hello', timestamp: 222 },
      ]);
    });

    it('should return empty array if redis returns empty list', async () => {
      (redisCache.lrange as jest.Mock).mockResolvedValue([]);
      const result = await chatCache.getHistory();
      expect(result).toEqual([]);
    });
  });

  describe('saveToHistory', () => {
    it('should push message and trim history using a transactional pipeline', async () => {
      const mockPipeline = redisCache.pipeline();
      const mockMessage: any = { type: 'MESSAGE', from: 'u1', text: 'test', timestamp: 333 };

      await chatCache.saveToHistory(mockMessage);

      expect(redisCache.pipeline).toHaveBeenCalled();
      expect(mockPipeline.rpush).toHaveBeenCalledWith(
        'chat:history:latest',
        JSON.stringify(mockMessage),
      );
      expect(mockPipeline.ltrim).toHaveBeenCalledWith('chat:history:latest', -50, -1);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('warmUpHistory', () => {
    it('should batch push all historic database records into redis via pipeline', async () => {
      const mockPipeline = redisCache.pipeline();
      const mockHistoryData: any[] = [
        { from: 'u1', text: 'old1', timestamp: 1 },
        { from: 'u2', text: 'old2', timestamp: 2 },
      ];

      await chatCache.warmUpHistory(mockHistoryData);

      expect(redisCache.pipeline).toHaveBeenCalled();
      expect(mockPipeline.rpush).toHaveBeenCalledTimes(2);
      expect(mockPipeline.rpush).toHaveBeenNthCalledWith(
        1,
        'chat:history:latest',
        JSON.stringify(mockHistoryData[0]),
      );
      expect(mockPipeline.rpush).toHaveBeenNthCalledWith(
        2,
        'chat:history:latest',
        JSON.stringify(mockHistoryData[1]),
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('publishMessage', () => {
    it('should publish serialized broadcast payload to redis pub channel', async () => {
      const mockMessage: any = { type: 'MESSAGE', from: 'u3', text: 'pub', timestamp: 444 };

      await chatCache.publishMessage(mockMessage);

      expect(redisPub.publish).toHaveBeenCalledWith(
        'main_chat_channel',
        JSON.stringify(mockMessage),
      );
    });
  });

  describe('subscribeToChannel', () => {
    it('should subscribe to channel and execute callback when channel matches', async () => {
      const mockCallback = jest.fn();
      let registeredEventCallback: (channel: string, message: string) => void = () => {};

      (redisSub.on as jest.Mock).mockImplementation((event, cb) => {
        if (event === 'message') {
          registeredEventCallback = cb;
        }
      });

      await chatCache.subscribeToChannel(mockCallback);

      expect(redisSub.subscribe).toHaveBeenCalledWith('main_chat_channel');
      expect(redisSub.on).toHaveBeenCalledWith('message', expect.any(Function));

      registeredEventCallback('main_chat_channel', 'test-payload');
      expect(mockCallback).toHaveBeenCalledWith('test-payload');
    });

    it('should ignore incoming pub/sub messages from irrelevant channels', async () => {
      const mockCallback = jest.fn();
      let registeredEventCallback: (channel: string, message: string) => void = () => {};

      (redisSub.on as jest.Mock).mockImplementation((event, cb) => {
        if (event === 'message') {
          registeredEventCallback = cb;
        }
      });

      await chatCache.subscribeToChannel(mockCallback);

      registeredEventCallback('wrong_channel', 'test-payload');
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });
});
