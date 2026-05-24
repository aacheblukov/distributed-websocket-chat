import { handleConnection, handleMessage } from '../../handlers/chat.handler';
import { chatCache } from '../../services/redis.service';
import { chatDb } from '../../services/db.service';
import { CustomWebSocket } from '../../types';

jest.mock('../../services/redis.service', () => ({
  chatCache: {
    getHistory: jest.fn(),
    warmUpHistory: jest.fn(),
    saveToHistory: jest.fn(),
    publishMessage: jest.fn(),
  },
}));

jest.mock('../../services/db.service', () => ({
  chatDb: {
    getLatestHistory: jest.fn(),
    saveMessage: jest.fn(),
  },
}));

describe('Chat Handler', () => {
  let mockWs: Partial<CustomWebSocket> & { send: jest.Mock };
  let mockReq: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWs = {
      send: jest.fn(),
      userId: undefined,
      isAlive: undefined,
    };

    mockReq = {
      headers: {
        host: 'localhost:8080',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      },
      url: '/ws?userId=user_test_123',
    };
  });

  describe('handleConnection', () => {
    it('should parse userId from URL, send greeting and set isAlive to true', async () => {
      (chatCache.getHistory as jest.Mock).mockResolvedValue([]);
      (chatDb.getLatestHistory as jest.Mock).mockResolvedValue([]);

      await handleConnection(mockWs as any, mockReq);

      expect(mockWs.userId).toBe('user_test_123');
      expect(mockWs.isAlive).toBe(true);
      expect(mockWs.send).toStartWithJson({ status: 'connected', userId: 'user_test_123' });
    });

    it('should fallback to timestamp fallback string if userId query param is missing', async () => {
      mockReq.url = '/ws';
      (chatCache.getHistory as jest.Mock).mockResolvedValue([]);
      (chatDb.getLatestHistory as jest.Mock).mockResolvedValue([]);

      const beforeTime = Date.now();
      await handleConnection(mockWs as any, mockReq);
      const afterTime = Date.now();

      expect(mockWs.userId).toBeDefined();
      const parsedId = Number(mockWs.userId);
      expect(parsedId).toBeGreaterThanOrEqual(beforeTime);
      expect(parsedId).toBeLessThanOrEqual(afterTime);
    });

    it('should load history from Redis if cache is not empty', async () => {
      const mockRedisHistory = [{ from: 'user1', text: 'hello', timestamp: 12345 }];
      (chatCache.getHistory as jest.Mock).mockResolvedValue(mockRedisHistory);

      await handleConnection(mockWs as any, mockReq);

      expect(chatCache.getHistory).toHaveBeenCalled();
      expect(chatDb.getLatestHistory).not.toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'HISTORY', payload: mockRedisHistory }),
      );
    });

    it('should load history from PostgreSQL and warm up Redis cache if Redis is empty', async () => {
      const mockDbHistory = [{ from: 'user2', text: 'from db', timestamp: 54321 }];
      (chatCache.getHistory as jest.Mock).mockResolvedValue([]);
      (chatDb.getLatestHistory as jest.Mock).mockResolvedValue(mockDbHistory);

      await handleConnection(mockWs as any, mockReq);

      expect(chatCache.getHistory).toHaveBeenCalled();
      expect(chatDb.getLatestHistory).toHaveBeenCalled();
      expect(chatCache.warmUpHistory).toHaveBeenCalledWith(mockDbHistory);
      expect(mockWs.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'HISTORY', payload: mockDbHistory }),
      );
    });

    it('should log an error if fetching history fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const testError = new Error('Database connection failed');
      (chatCache.getHistory as jest.Mock).mockRejectedValue(testError);

      await handleConnection(mockWs as any, mockReq);

      expect(consoleErrorSpy).toHaveBeenCalledWith('error getting history, ', testError);
      consoleErrorSpy.mockRestore();
    });

    it('should fallback to localhost if req.url is undefined', async () => {
      delete mockReq.url;

      (chatCache.getHistory as jest.Mock).mockResolvedValue([]);
      (chatDb.getLatestHistory as jest.Mock).mockResolvedValue([]);

      await handleConnection(mockWs as any, mockReq);

      expect(mockWs.userId).toBeDefined();
      expect(isNaN(Number(mockWs.userId))).toBe(false);
    });
  });

  describe('handleMessage', () => {
    beforeEach(() => {
      mockWs.userId = 'user_test_123';
    });

    it('should only log and return early when receiving an AUTH type message', async () => {
      const rawAuthMessage = Buffer.from(JSON.stringify({ type: 'AUTH' }));

      await handleMessage(mockWs as any, rawAuthMessage);

      expect(chatDb.saveMessage).not.toHaveBeenCalled();
      expect(chatCache.saveToHistory).not.toHaveBeenCalled();
      expect(chatCache.publishMessage).not.toHaveBeenCalled();
    });

    it('should save to database, history cache and publish message when type is MESSAGE', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-24T12:00:00Z'));

      const rawData = Buffer.from(JSON.stringify({ type: 'MESSAGE', text: 'hello world' }));

      await handleMessage(mockWs as any, rawData);

      const expectedPayload = {
        type: 'MESSAGE',
        from: 'user_test_123',
        text: 'hello world',
        timestamp: Date.now(), // 1779624000000 ms
      };

      expect(chatDb.saveMessage).toHaveBeenCalledWith('user_test_123', 'hello world');
      expect(chatCache.saveToHistory).toHaveBeenCalledWith(expectedPayload);
      expect(chatCache.publishMessage).toHaveBeenCalledWith(expectedPayload);

      jest.useRealTimers();
    });

    it('should fallback to unknown strings if ws.userId is missing', async () => {
      delete mockWs.userId;
      const rawData = Buffer.from(JSON.stringify({ type: 'MESSAGE', text: 'anonymous text' }));

      await handleMessage(mockWs as any, rawData);

      expect(chatDb.saveMessage).toHaveBeenCalledWith('unknown', 'anonymous text');
      expect(chatCache.saveToHistory).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'unknown', text: 'anonymous text' }),
      );
    });

    it('should catch and log error if incoming message payload is invalid JSON', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const invalidBuffer = Buffer.from('not-a-json');

      await handleMessage(mockWs as any, invalidBuffer);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'error parsing message',
        expect.any(SyntaxError),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  it('should fallback to an empty string if messageData.text is missing', async () => {
    mockWs.userId = 'user_test_123';

    const rawData = Buffer.from(JSON.stringify({ type: 'MESSAGE' }));

    await handleMessage(mockWs as any, rawData);

    expect(chatDb.saveMessage).toHaveBeenCalledWith('user_test_123', '');
    expect(chatCache.saveToHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'user_test_123',
        text: '',
      }),
    );
    expect(chatCache.publishMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'user_test_123',
        text: '',
      }),
    );
  });
});

expect.extend({
  toStartWithJson(receivedMock, expectedJsonStructure) {
    const firstCallArg = JSON.parse(receivedMock.mock.calls[0][0]);
    const pass = this.equals(firstCallArg, expectedJsonStructure);
    if (pass) {
      return {
        message: () => `expected ${JSON.stringify(firstCallArg)} not to match structure`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${JSON.stringify(firstCallArg)} to match structure ${JSON.stringify(expectedJsonStructure)}`,
        pass: false,
      };
    }
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toStartWithJson(expected: object): R;
    }
  }
}
