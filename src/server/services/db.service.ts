import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Message } from '../types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export const chatDb = {
  async saveMessage(userId: string, text: string): Promise<void> {
    try {
      await prisma.message.create({
        data: {
          userId,
          text,
        },
      });
    } catch (error) {
      console.error('prisma: error inserting message', error);
    }
  },

  async getLatestHistory(limit = 50): Promise<Message[]> {
    const messages = await prisma.message.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return messages.reverse().map((msg) => ({
      from: msg.userId,
      text: msg.text,
      timestamp: msg.createdAt.getTime(),
    }));
  },
};
