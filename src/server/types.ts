import { WebSocket } from 'ws';
export interface CustomWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

export interface Message {
  from: string;
  text: string;
  timestamp: number;
}

export interface RedisBroadcastMessage extends Message {
  type: 'AUTH' | 'HISTORY' | 'MESSAGE';
}
