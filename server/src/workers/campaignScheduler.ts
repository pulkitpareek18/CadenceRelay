import { pool } from '../config/database';
import { campaignDispatchQueue } from '../queues/emailQueue';
import { logger } from '../utils/logger';

export async function checkScheduledCampaigns(): Promise<void> {
  try {
    const result = await pool.query(
      "SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= NOW()"
    );

    for (const row of result.rows) {
      logger.info(`Triggering scheduled campaign ${row.id}`);
      await pool.query(
        "UPDATE campaigns SET status = 'sending', started_at = NOW(), updated_at = NOW() WHERE id = $1",
        [row.id]
      );
      await campaignDispatchQueue.add('dispatch', { campaignId: row.id });
    }

    if (result.rows.length > 0) {
      logger.info(`Triggered ${result.rows.length} scheduled campaigns`);
    }
  } catch (error) {
    logger.error('Scheduler error', { error: (error as Error).message });
  }
}
