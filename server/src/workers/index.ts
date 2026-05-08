import { config } from '../config';
import { testDatabaseConnection, closeDatabasePool } from '../config/database';
import { testRedisConnection, closeRedisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { startCampaignDispatchWorker, startEmailSendWorker } from './emailWorker';
import { startEventProcessingWorker } from './eventWorker';
import { checkScheduledCampaigns } from './campaignScheduler';
import { syncSesQuotaToSettings } from '../utils/dailyLimits';
import { checkGmailBounces } from './gmailBounceChecker';
import { runEngagementDecay } from './engagementDecay';
import { processAutomationSteps } from './automationProcessor';
import { runAutoSuppression } from './autoSuppression';
import { assertTrackingDomainAtBoot } from '../utils/trackingDomain';

async function startWorker(): Promise<void> {
  logger.info(`Starting worker in ${config.nodeEnv} mode`);

  // Match the API server: refuse to start with a bad tracking domain.
  assertTrackingDomainAtBoot();

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
  const eventWorker = startEventProcessingWorker();

  logger.info('Campaign dispatch worker started');
  logger.info('Email send worker started');
  logger.info('Event processing worker started (SNS bounces/complaints)');

  // Start campaign scheduler (check every 60s)
  const schedulerInterval = setInterval(async () => {
    await checkScheduledCampaigns();
    // Also sync SES quota (internally cached for 1 hour, safe to call every 60s)
    try { await syncSesQuotaToSettings(); } catch (err) {
      logger.warn('SES quota sync error', { error: (err as Error).message });
    }
  }, 60000);
  checkScheduledCampaigns();
  logger.info('Campaign scheduler started (60s interval)');

  // Start Gmail bounce checker (check every 5 minutes)
  const bounceCheckInterval = setInterval(async () => {
    try {
      await checkGmailBounces();
    } catch (err) {
      logger.error('Gmail bounce check error', { error: (err as Error).message });
    }
  }, 5 * 60 * 1000);

  // Run once after 30s delay (give time for DB/settings to initialize)
  setTimeout(async () => {
    try {
      await checkGmailBounces();
    } catch (err) {
      logger.error('Initial Gmail bounce check error', { error: (err as Error).message });
    }
  }, 30000);

  logger.info('Gmail IMAP bounce checker started (5 min interval)');

  // Start engagement decay worker (every 24 hours)
  const engagementDecayInterval = setInterval(async () => {
    try {
      await runEngagementDecay();
    } catch (err) {
      logger.error('Engagement decay error', { error: (err as Error).message });
    }
  }, 24 * 60 * 60 * 1000);

  // Run engagement decay once on startup with 5-minute delay
  setTimeout(async () => {
    try {
      await runEngagementDecay();
    } catch (err) {
      logger.error('Initial engagement decay error', { error: (err as Error).message });
    }
  }, 5 * 60 * 1000);

  logger.info('Engagement decay worker started (24h interval)');

  // Start automation processor (every 5 minutes)
  const automationInterval = setInterval(async () => {
    try {
      await processAutomationSteps();
    } catch (err) {
      logger.error('Automation processor error', { error: (err as Error).message });
    }
  }, 5 * 60 * 1000);

  // Run automation processor once after 45s delay
  setTimeout(async () => {
    try {
      await processAutomationSteps();
    } catch (err) {
      logger.error('Initial automation processor error', { error: (err as Error).message });
    }
  }, 45000);

  logger.info('Automation processor started (5 min interval)');

  // Start auto-suppression worker (every 10 minutes)
  const autoSuppressionInterval = setInterval(async () => {
    try {
      await runAutoSuppression();
    } catch (err) {
      logger.error('Auto-suppression error', { error: (err as Error).message });
    }
  }, 10 * 60 * 1000);

  // Run auto-suppression once after 2 minutes
  setTimeout(async () => {
    try {
      await runAutoSuppression();
    } catch (err) {
      logger.error('Initial auto-suppression error', { error: (err as Error).message });
    }
  }, 2 * 60 * 1000);

  logger.info('Auto-suppression worker started (10 min interval)');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down workers...`);
    clearInterval(schedulerInterval);
    clearInterval(bounceCheckInterval);
    clearInterval(engagementDecayInterval);
    clearInterval(automationInterval);
    clearInterval(autoSuppressionInterval);
    await dispatchWorker.close();
    await sendWorker.close();
    await eventWorker.close();
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
