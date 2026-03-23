import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../utils/logger';

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connection established');
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

export async function testRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    logger.info('Redis connection successful');
    return true;
  } catch (error) {
    logger.error('Redis connection failed', { error: (error as Error).message });
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}
