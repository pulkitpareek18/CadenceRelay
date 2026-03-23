import { config } from '../config';
import { testDatabaseConnection } from '../config/database';
import { testRedisConnection } from '../config/redis';
import { logger } from '../utils/logger';

async function startWorker(): Promise<void> {
  logger.info(`Starting worker in ${config.nodeEnv} mode`);

  const dbOk = await testDatabaseConnection();
  if (!dbOk) {
    logger.error('Worker: Failed to connect to database. Exiting.');
    process.exit(1);
  }

  const redisOk = await testRedisConnection();
  if (!redisOk) {
    logger.error('Worker: Failed to connect to Redis. Exiting.');
    process.exit(1);
  }

  // TODO: Register BullMQ workers in Sprint 5
  // - emailWorker
  // - campaignScheduler
  // - bounceProcessor

  logger.info('Worker started and waiting for jobs');
}

startWorker().catch((err) => {
  logger.error('Failed to start worker', { error: err.message });
  process.exit(1);
});
