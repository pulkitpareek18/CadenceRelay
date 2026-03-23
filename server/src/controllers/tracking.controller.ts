import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

// 1x1 transparent GIF pixel
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function trackOpen(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;

    const result = await pool.query(
      'SELECT id, campaign_id, opened_at FROM campaign_recipients WHERE tracking_token = $1',
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

        // Update first open timestamp
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
      'SELECT id, campaign_id, link_urls, clicked_at FROM campaign_recipients WHERE tracking_token = $1',
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

      // Update first click timestamp
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

export async function unsubscribePost(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, campaign_id, email FROM campaign_recipients WHERE tracking_token = $1',
      [token]
    );

    if (result.rows.length > 0) {
      const { id, campaign_id, email } = result.rows[0];

      // Update contact status
      await pool.query("UPDATE contacts SET status = 'unsubscribed', updated_at = NOW() WHERE email = $1", [email]);

      // Update recipient
      await pool.query("UPDATE campaign_recipients SET status = 'unsubscribed' WHERE id = $1", [id]);

      // Record event
      await pool.query(
        "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type) VALUES ($1, $2, 'unsubscribed')",
        [id, campaign_id]
      );

      // Update campaign counter
      await pool.query(
        'UPDATE campaigns SET unsubscribe_count = unsubscribe_count + 1, updated_at = NOW() WHERE id = $1',
        [campaign_id]
      );

      // Add to unsubscribes table
      await pool.query(
        'INSERT INTO unsubscribes (email, campaign_id) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
        [email, campaign_id]
      );
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2>You have been unsubscribed</h2>
        <p>You will no longer receive emails from us.</p>
      </body>
      </html>
    `);
  } catch (err) {
    logger.error('Unsubscribe error', { error: (err as Error).message });
    res.status(500).send('Error processing unsubscribe');
  }
}
