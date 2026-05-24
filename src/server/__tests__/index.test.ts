import { WebSocketServer } from 'ws';
import { chatCache } from '../services/redis.service';
import { handleConnection, handleMessage } from '../handlers/chat.handler';

const mockWssInstance = {
  on: jest.fn(),
  clients: new Set<any>(),
};

jest.mock('ws', () => {
  const mWebSocket = {
    OPEN: 1,
    send: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn(),
    on: jest.fn(),
  };

  return {
    WebSocketServer: jest.fn(() => mockWssInstance),
    WebSocket: mWebSocket,
  };
});

jest.mock('../services/redis.service', () => ({
  chatCache: {
    subscribeToChannel: jest.fn(),
  },
}));

jest.mock('../handlers/chat.handler', () => ({
  handleConnection: jest.fn(),
  handleMessage: jest.fn(),
}));

describe('WebSocket Server Initialization & Events', () => {
  let subscribeCallback: (message: string) => void;

  beforeAll(() => {
    (chatCache.subscribeToChannel as jest.Mock).mockImplementation((cb) => {
      subscribeCallback = cb;
    });

    require('../index');
  });

  beforeEach(() => {
    mockWssInstance.clients.clear();
  });

  describe('Redis Subscription', () => {
    it('should broadcast message to all open clients when receiving a message from Redis', () => {
      const mockClient1 = { readyState: 1, send: jest.fn() };
      const mockClient2 = { readyState: 0, send: jest.fn() };

      mockWssInstance.clients.add(mockClient1);
      mockWssInstance.clients.add(mockClient2);

      const redisMessage = JSON.stringify({ roomId: '123', message: 'hello' });

      subscribeCallback(redisMessage);

      expect(mockClient1.send).toHaveBeenCalledWith(redisMessage);
      expect(mockClient2.send).not.toHaveBeenCalled();
    });

    it('should catch and log error when parsing invalid JSON from Redis', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      subscribeCallback('invalid-json');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'error parsing message from Redis',
        expect.any(SyntaxError),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('WebSocket Connection Handlers', () => {
    let connectionHandler: Function;
    let mockWs: any;
    let mockReq: any;

    beforeEach(() => {
      jest.useFakeTimers();

      const connectionCall = (mockWssInstance.on as jest.Mock).mock.calls.find(
        (call: any) => call[0] === 'connection',
      );
      connectionHandler = connectionCall[1];

      mockWs = {
        on: jest.fn(),
        ping: jest.fn(),
        terminate: jest.fn(),
        readyState: 1,
        isAlive: true,
        userId: 'user_1',
      };
      mockReq = {};
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('should register event listeners and call handleConnection on new connection', async () => {
      await connectionHandler(mockWs, mockReq);

      expect(handleConnection).toHaveBeenCalledWith(mockWs, mockReq);
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should terminate the connection if client does not respond to ping', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await connectionHandler(mockWs, mockReq);

      mockWs.isAlive = false;

      jest.advanceTimersByTime(30000);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "client user_1 didn't send ping, closing a socket",
      );
      expect(mockWs.terminate).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should send ping and set isAlive to false on interval tick if client is alive', async () => {
      await connectionHandler(mockWs, mockReq);

      mockWs.isAlive = true;
      mockWs.readyState = 1;

      jest.advanceTimersByTime(30000);

      expect(mockWs.isAlive).toBe(false);
      expect(mockWs.ping).toHaveBeenCalled();
    });

    it('should set isAlive to true when pong event is received', async () => {
      await connectionHandler(mockWs, mockReq);

      const pongCall = mockWs.on.mock.calls.find((call: any) => call[0] === 'pong');
      const pongHandler = pongCall[1];

      mockWs.isAlive = false;
      pongHandler();

      expect(mockWs.isAlive).toBe(true);
    });

    it('should clear interval when close event is received', async () => {
      await connectionHandler(mockWs, mockReq);

      const closeCall = mockWs.on.mock.calls.find((call: any) => call[0] === 'close');
      const closeHandler = closeCall[1];

      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      closeHandler();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should not send ping if readyState is not OPEN', async () => {
      await connectionHandler(mockWs, mockReq);

      mockWs.isAlive = true;
      mockWs.readyState = 2;

      jest.advanceTimersByTime(30000);

      expect(mockWs.ping).not.toHaveBeenCalled();
    });

    it('should register event listeners, call handleConnection and invoke handleMessage on message event', async () => {
      await connectionHandler(mockWs, mockReq);

      expect(handleConnection).toHaveBeenCalledWith(mockWs, mockReq);
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('pong', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));

      const messageCall = mockWs.on.mock.calls.find((call: any) => call[0] === 'message');
      const messageHandler = messageCall[1];

      const mockBuffer = Buffer.from('test-data');
      messageHandler(mockBuffer);

      expect(handleMessage).toHaveBeenCalledWith(mockWs, mockBuffer);
    });
  });
});
