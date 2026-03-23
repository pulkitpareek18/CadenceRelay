import { createApp } from './app';
import { config } from './config';
import { testDatabaseConnection, closeDatabasePool } from './config/database';
import { testRedisConnection, closeRedisConnection } from './config/redis';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  logger.info(`Starting server in ${config.nodeEnv} mode`);

  // Test connections
  const dbOk = await testDatabaseConnection();
  if (!dbOk) {
    logger.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  const redisOk = await testRedisConnection();
  if (!redisOk) {
    logger.error('Failed to connect to Redis. Exiting.');
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await closeDatabasePool();
      await closeRedisConnection();
      logger.info('Server shut down complete');
      process.exit(0);
    });

    // Force shutdown after 30s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
