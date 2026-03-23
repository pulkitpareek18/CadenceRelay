import { config } from '../config';
import { testDatabaseConnection, closeDatabasePool } from '../config/database';
import { testRedisConnection, closeRedisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { startCampaignDispatchWorker, startEmailSendWorker } from './emailWorker';
import { checkScheduledCampaigns } from './campaignScheduler';

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

  // Start BullMQ workers
  const dispatchWorker = startCampaignDispatchWorker();
  const sendWorker = startEmailSendWorker();

  logger.info('Campaign dispatch worker started');
  logger.info('Email send worker started');

  // Start campaign scheduler (check every 60s)
  const schedulerInterval = setInterval(checkScheduledCampaigns, 60000);
  // Run once immediately
  checkScheduledCampaigns();

  logger.info('Campaign scheduler started (60s interval)');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down workers...`);
    clearInterval(schedulerInterval);
    await dispatchWorker.close();
    await sendWorker.close();
    await closeDatabasePool();
    await closeRedisConnection();
    logger.info('Workers shut down complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startWorker().catch((err) => {
  logger.error('Failed to start worker', { error: err.message });
  process.exit(1);
});
