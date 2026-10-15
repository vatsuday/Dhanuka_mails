import { Redis } from 'ioredis';

/**
 * A Valkey connection for BullMQ. BullMQ requires `maxRetriesPerRequest: null` so blocking commands
 * wait through reconnects instead of failing. The caller owns it and must `quit()` it after closing
 * every Queue and Worker that uses it.
 */
export function queueConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
