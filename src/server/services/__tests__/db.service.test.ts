import { chatDb, prisma } from '../../services/db.service';

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      end: jest.fn(),
    })),
  };
});

jest.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: jest.fn(),
  };
});

jest.mock('@prisma/client', () => {
  const mPrismaClient = {
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
  return {
    PrismaClient: jest.fn(() => mPrismaClient),
  };
});

describe('DB Service (chatDb)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveMessage', () => {
    it('should successfully insert a message via prisma', async () => {
      (prisma.message.create as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 'user_123',
        text: 'hello',
        createdAt: new Date(),
      });

      await chatDb.saveMessage('user_123', 'hello');

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_123',
          text: 'hello',
        },
      });
    });

    it('should catch and log error if prisma insertion fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockError = new Error('Database connection failure');

      (prisma.message.create as jest.Mock).mockRejectedValue(mockError);

      await chatDb.saveMessage('user_123', 'hello');

      expect(consoleErrorSpy).toHaveBeenCalledWith('prisma: error inserting message', mockError);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('getLatestHistory', () => {
    it('should fetch, reverse, and format messages correctly', async () => {
      const mockDate1 = new Date('2026-05-24T10:00:00Z');
      const mockDate2 = new Date('2026-05-24T10:01:00Z');

      const mockDbMessages = [
        { id: 2, userId: 'user_b', text: 'second', createdAt: mockDate2 },
        { id: 1, userId: 'user_a', text: 'first', createdAt: mockDate1 },
      ];

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockDbMessages);

      const result = await chatDb.getLatestHistory(2);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        take: 2,
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toEqual([
        {
          from: 'user_a',
          text: 'first',
          timestamp: mockDate1.getTime(),
        },
        {
          from: 'user_b',
          text: 'second',
          timestamp: mockDate2.getTime(),
        },
      ]);
    });

    it('should use default limit value of 50 if none provided', async () => {
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await chatDb.getLatestHistory();

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
