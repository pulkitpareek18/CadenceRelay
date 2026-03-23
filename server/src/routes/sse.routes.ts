import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { pool } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/sse/campaign/:id
 * SSE endpoint that streams campaign send progress every 2 seconds.
 */
router.get('/campaign/:id', authenticate, async (req: Request, res: Response) => {
  const campaignId = req.params.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  let closed = false;

  const sendProgress = async () => {
    if (closed) return;

    try {
      // Get campaign status
      const campaignResult = await pool.query(
        'SELECT status, total_recipients, sent_count, failed_count, open_count FROM campaigns WHERE id = $1',
        [campaignId]
      );

      if (campaignResult.rows.length === 0) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Campaign not found' })}\n\n`);
        res.end();
        return;
      }

      const campaign = campaignResult.rows[0];

      // Get the most recently processed recipient email for "current" indicator
      const lastRecipient = await pool.query(
        `SELECT c.email FROM campaign_recipients cr
         JOIN contacts c ON c.id = cr.contact_id
         WHERE cr.campaign_id = $1 AND cr.status != 'pending'
         ORDER BY cr.sent_at DESC NULLS LAST LIMIT 1`,
        [campaignId]
      );

      const progress = {
        type: 'progress',
        sent: Number(campaign.sent_count) || 0,
        failed: Number(campaign.failed_count) || 0,
        opened: Number(campaign.open_count) || 0,
        total: Number(campaign.total_recipients) || 0,
        status: campaign.status,
        currentEmail: lastRecipient.rows[0]?.email || null,
      };

      res.write(`data: ${JSON.stringify(progress)}\n\n`);

      // Stop streaming if campaign is in a terminal state
      if (['completed', 'failed', 'draft', 'paused'].includes(campaign.status)) {
        res.write(`data: ${JSON.stringify({ type: 'done', status: campaign.status })}\n\n`);
        res.end();
        return;
      }
    } catch (err) {
      logger.error('SSE campaign progress error', { error: (err as Error).message, campaignId });
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to fetch progress' })}\n\n`);
      }
    }
  };

  // Send initial progress immediately
  await sendProgress();

  // Poll every 2 seconds
  const interval = setInterval(sendProgress, 2000);

  // Clean up on client disconnect
  req.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
});

/**
 * GET /api/v1/sse/import/:jobId
 * SSE endpoint that streams CSV import progress from Redis.
 */
router.get('/import/:jobId', authenticate, async (req: Request, res: Response) => {
  const { jobId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  let closed = false;

  const sendProgress = async () => {
    if (closed) return;

    try {
      const raw = await redis.get(`import:progress:${jobId}`);
      if (!raw) {
        res.write(`data: ${JSON.stringify({ type: 'waiting' })}\n\n`);
        return;
      }

      const progress = JSON.parse(raw);
      res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);

      // Stop streaming when import is done
      if (progress.status === 'completed' || progress.status === 'failed') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: progress.status })}\n\n`);
        // Clean up Redis key after a delay
        setTimeout(() => {
          redis.del(`import:progress:${jobId}`).catch(() => {});
        }, 30000);
        res.end();
        return;
      }
    } catch (err) {
      logger.error('SSE import progress error', { error: (err as Error).message, jobId });
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to fetch import progress' })}\n\n`);
      }
    }
  };

  await sendProgress();
  const interval = setInterval(sendProgress, 1000);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
});

export default router;
