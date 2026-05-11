import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { updateEngagementScore } from '../utils/engagementScore';
import { fireAutomationTrigger } from '../workers/automationProcessor';

// 1x1 transparent GIF pixel
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function trackOpen(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;

    const result = await pool.query(
      'SELECT id, campaign_id, contact_id, email, opened_at FROM campaign_recipients WHERE tracking_token = $1',
      [token]
    );

    if (result.rows.length > 0) {
      const recipient = result.rows[0];

      // FIX: Use a transaction so event insert + counter updates are atomic
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Record event
        await client.query(
          "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type, ip_address, user_agent) VALUES ($1, $2, 'opened', $3, $4)",
          [recipient.id, recipient.campaign_id, req.ip, req.get('user-agent')]
        );

        // Always increment open_count and update last_opened_at
        await client.query(
          "UPDATE campaign_recipients SET open_count = COALESCE(open_count, 0) + 1, last_opened_at = NOW() WHERE id = $1",
          [recipient.id]
        );

        // Update first open timestamp + campaign counter only on first open
        if (!recipient.opened_at) {
          await client.query(
            "UPDATE campaign_recipients SET status = 'opened', opened_at = NOW() WHERE id = $1",
            [recipient.id]
          );
          await client.query(
            'UPDATE campaigns SET open_count = open_count + 1, updated_at = NOW() WHERE id = $1',
            [recipient.campaign_id]
          );
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Update engagement score (fire-and-forget, after transaction commit)
      updateEngagementScore(recipient.email, 'opened');

      // Fire automation trigger (fire-and-forget)
      if (recipient.contact_id) {
        fireAutomationTrigger('email_opened', recipient.contact_id, { campaignId: recipient.campaign_id }).catch(() => {});
      }
    }

    // Always return pixel
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.send(PIXEL);
  } catch (err) {
    logger.error('Track open error', { error: (err as Error).message });
    res.set('Content-Type', 'image/gif');
    res.send(PIXEL);
  }
}

export async function trackClick(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, linkIndex } = req.params;

    // FIX: Validate linkIndex is a valid non-negative integer
    const idx = parseInt(linkIndex);
    if (isNaN(idx) || idx < 0) {
      res.status(400).send('Invalid link index');
      return;
    }

    const result = await pool.query(
      'SELECT id, campaign_id, contact_id, email, link_urls, clicked_at FROM campaign_recipients WHERE tracking_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      res.status(404).send('Link not found');
      return;
    }

    const recipient = result.rows[0];
    const linkUrls = recipient.link_urls || [];

    // FIX: Bounds check on linkIndex
    if (idx >= linkUrls.length) {
      res.status(404).send('Link not found');
      return;
    }

    const originalUrl = linkUrls[idx];

    if (!originalUrl) {
      res.status(404).send('Link not found');
      return;
    }

    // FIX: Use a transaction so event insert + counter updates are atomic
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Record event
      await client.query(
        "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type, metadata, ip_address, user_agent) VALUES ($1, $2, 'clicked', $3, $4, $5)",
        [recipient.id, recipient.campaign_id, JSON.stringify({ url: originalUrl, linkIndex: idx }), req.ip, req.get('user-agent')]
      );

      // Always increment click_count and update last_clicked_at
      await client.query(
        "UPDATE campaign_recipients SET click_count = COALESCE(click_count, 0) + 1, last_clicked_at = NOW() WHERE id = $1",
        [recipient.id]
      );

      // Update first click timestamp + campaign counter only on first click
      if (!recipient.clicked_at) {
        await client.query(
          "UPDATE campaign_recipients SET status = 'clicked', clicked_at = NOW() WHERE id = $1",
          [recipient.id]
        );
        await client.query(
          'UPDATE campaigns SET click_count = click_count + 1, updated_at = NOW() WHERE id = $1',
          [recipient.campaign_id]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Update engagement score (fire-and-forget, after transaction commit)
    updateEngagementScore(recipient.email, 'clicked');

    // Fire automation trigger (fire-and-forget)
    if (recipient.contact_id) {
      fireAutomationTrigger('email_clicked', recipient.contact_id, { campaignId: recipient.campaign_id }).catch(() => {});
    }

    res.redirect(302, originalUrl);
  } catch (err) {
    next(err);
  }
}

export async function unsubscribeGet(req: Request, res: Response): Promise<void> {
  const { token } = req.params;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Unsubscribe</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;">
      <h2>Unsubscribe</h2>
      <p>Click the button below to unsubscribe from our emails.</p>
      <form method="POST" action="/api/v1/t/u/${token}">
        <button type="submit" style="padding:10px 30px;font-size:16px;cursor:pointer;background:#e53e3e;color:white;border:none;border-radius:5px;">
          Unsubscribe
        </button>
      </form>
    </body>
    </html>
  `);
}

// RFC 8058 one-click unsubscribe endpoint.
// Gmail/Yahoo/etc POST here with `Content-Type: application/x-www-form-urlencoded`
// and body `List-Unsubscribe=One-Click`. The response MUST distinguish between
// "real unsubscribe processed" (2xx) and "this token is not valid" (4xx) — if
// we 200 on every input, mailbox providers conclude the endpoint is fake.
export async function unsubscribePost(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, campaign_id, email FROM campaign_recipients WHERE tracking_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      res.status(404).type('text/plain').send('Unknown unsubscribe token');
      return;
    }

    const { id, campaign_id, email } = result.rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query("UPDATE contacts SET status = 'unsubscribed', updated_at = NOW() WHERE email = $1", [email]);

      const updateResult = await client.query(
        "UPDATE campaign_recipients SET status = 'unsubscribed' WHERE id = $1 AND status != 'unsubscribed' RETURNING id",
        [id]
      );

      if (updateResult.rows.length > 0) {
        await client.query(
          "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type) VALUES ($1, $2, 'unsubscribed')",
          [id, campaign_id]
        );

        await client.query(
          'UPDATE campaigns SET unsubscribe_count = unsubscribe_count + 1, updated_at = NOW() WHERE id = $1',
          [campaign_id]
        );
      }

      await client.query(
        'INSERT INTO unsubscribes (email, campaign_id) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
        [email, campaign_id]
      );

      await client.query(
        "INSERT INTO suppression_list (email, reason, added_by) VALUES ($1, 'unsubscribed', 'auto') ON CONFLICT DO NOTHING",
        [email]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    updateEngagementScore(email, 'unsubscribed');

    // Minimal 2xx body — mailbox providers parse the status, not the body.
    res.status(200).type('text/plain').send('Unsubscribed');
  } catch (err) {
    logger.error('Unsubscribe error', { error: (err as Error).message });
    res.status(500).type('text/plain').send('Error processing unsubscribe');
  }
}
