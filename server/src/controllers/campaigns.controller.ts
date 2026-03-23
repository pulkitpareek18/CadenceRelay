import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResult } from '../utils/pagination';
import { campaignDispatchQueue } from '../queues/emailQueue';
import { verifyAdminPassword } from '../utils/adminAuth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUUID(id: string, label = 'ID'): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} format`, 400);
  }
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function listCampaigns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req.query as { page?: string; limit?: string });
    const { status } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      whereClause += ` AND c.status = $${idx}`;
      params.push(status);
      idx++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM campaigns c ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT c.*, t.name as template_name, cl.name as list_name
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       LEFT JOIN contact_lists cl ON cl.id = c.list_id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(buildPaginatedResult(result.rows, total, { page, limit, offset }));
  } catch (err) {
    next(err);
  }
}

export async function getCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');
    const result = await pool.query(
      `SELECT c.*, t.name as template_name, t.subject as template_subject, cl.name as list_name
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       LEFT JOIN contact_lists cl ON cl.id = c.list_id
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) throw new AppError('Campaign not found', 404);
    res.json({ campaign: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, templateId, listId, provider, throttlePerSecond, throttlePerHour } = req.body;

    // Handle file attachments from multer
    const files = (req.files as Express.Multer.File[]) || [];
    const attachments = files.map((file) => {
      // Save file to disk with unique name
      const ext = path.extname(file.originalname);
      const storedName = `${Date.now()}-${Math.random().toString(36).substring(2)}${ext}`;
      const storedPath = path.join(UPLOAD_DIR, storedName);
      fs.writeFileSync(storedPath, file.buffer);

      return {
        filename: file.originalname,
        storagePath: storedPath,
        size: file.size,
        contentType: file.mimetype,
      };
    });

    const result = await pool.query(
      `INSERT INTO campaigns (name, template_id, list_id, provider, throttle_per_second, throttle_per_hour, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, templateId, listId, provider || 'ses', throttlePerSecond || 5, throttlePerHour || 5000, JSON.stringify(attachments)]
    );

    res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function updateCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');
    const { name, templateId, listId, provider, throttlePerSecond, throttlePerHour } = req.body;

    const existing = await pool.query('SELECT status FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    // FIX: Already correct - only allow editing draft/scheduled campaigns
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Can only edit draft or scheduled campaigns', 400);
    }

    const result = await pool.query(
      `UPDATE campaigns SET
        name = COALESCE($1, name),
        template_id = COALESCE($2, template_id),
        list_id = COALESCE($3, list_id),
        provider = COALESCE($4, provider),
        throttle_per_second = COALESCE($5, throttle_per_second),
        throttle_per_hour = COALESCE($6, throttle_per_hour),
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name, templateId, listId, provider, throttlePerSecond, throttlePerHour, id]
    );

    res.json({ campaign: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function deleteCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');
    const { adminPassword } = req.body;
    await verifyAdminPassword(adminPassword);

    const existing = await pool.query('SELECT id, attachments FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);

    // Clean up attachment files from disk
    const attachments = existing.rows[0].attachments || [];
    for (const att of attachments) {
      if (att.storagePath && fs.existsSync(att.storagePath)) {
        fs.unlinkSync(att.storagePath);
      }
    }

    // Manually delete child records (email_events & unsubscribes lack ON DELETE CASCADE)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM unsubscribes WHERE campaign_id = $1', [id]);
      await client.query('DELETE FROM email_events WHERE campaign_id = $1', [id]);
      await client.query('DELETE FROM campaign_recipients WHERE campaign_id = $1', [id]);
      await client.query('DELETE FROM campaigns WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    next(err);
  }
}

export async function bulkDeleteCampaigns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids, adminPassword } = req.body;
    await verifyAdminPassword(adminPassword);

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('ids must be a non-empty array', 400);
    }
    for (const id of ids) {
      validateUUID(id, 'campaign ID');
    }

    // Clean up attachment files from disk
    const campaigns = await pool.query('SELECT id, attachments FROM campaigns WHERE id = ANY($1)', [ids]);
    for (const campaign of campaigns.rows) {
      const attachments = campaign.attachments || [];
      for (const att of attachments) {
        if (att.storagePath && fs.existsSync(att.storagePath)) {
          fs.unlinkSync(att.storagePath);
        }
      }
    }

    // Manually delete child records (email_events & unsubscribes lack ON DELETE CASCADE)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM unsubscribes WHERE campaign_id = ANY($1)', [ids]);
      await client.query('DELETE FROM email_events WHERE campaign_id = ANY($1)', [ids]);
      await client.query('DELETE FROM campaign_recipients WHERE campaign_id = ANY($1)', [ids]);
      const result = await client.query('DELETE FROM campaigns WHERE id = ANY($1)', [ids]);
      await client.query('COMMIT');
      res.json({ message: `${result.rowCount} campaign(s) deleted` });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function scheduleCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');
    const { scheduledAt } = req.body;

    // FIX: Validate scheduledAt is in the future
    if (!scheduledAt) {
      throw new AppError('scheduledAt is required', 400);
    }
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      throw new AppError('scheduledAt must be a valid date', 400);
    }
    if (scheduledDate <= new Date()) {
      throw new AppError('scheduledAt must be in the future', 400);
    }

    const existing = await pool.query('SELECT status, template_id, list_id FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Can only schedule draft or already-scheduled campaigns', 400);
    }
    if (!existing.rows[0].template_id || !existing.rows[0].list_id) {
      throw new AppError('Campaign must have a template and list before scheduling', 400);
    }

    // FIX: Validate template and list still exist
    const templateCheck = await pool.query('SELECT id FROM templates WHERE id = $1 AND is_active = true', [existing.rows[0].template_id]);
    if (templateCheck.rows.length === 0) {
      throw new AppError('The assigned template no longer exists or has been deactivated', 400);
    }
    const listCheck = await pool.query('SELECT id FROM contact_lists WHERE id = $1', [existing.rows[0].list_id]);
    if (listCheck.rows.length === 0) {
      throw new AppError('The assigned contact list no longer exists', 400);
    }

    await pool.query(
      'UPDATE campaigns SET status = $1, scheduled_at = $2, updated_at = NOW() WHERE id = $3',
      ['scheduled', scheduledAt, id]
    );

    res.json({ message: 'Campaign scheduled', scheduledAt });
  } catch (err) {
    next(err);
  }
}

export async function sendCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');

    const existing = await pool.query('SELECT status, template_id, list_id FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Campaign is already sending or completed', 400);
    }
    if (!existing.rows[0].template_id || !existing.rows[0].list_id) {
      throw new AppError('Campaign must have a template and list', 400);
    }

    // FIX: Validate template and list still exist before sending
    const templateCheck = await pool.query('SELECT id FROM templates WHERE id = $1 AND is_active = true', [existing.rows[0].template_id]);
    if (templateCheck.rows.length === 0) {
      throw new AppError('The assigned template no longer exists or has been deactivated', 400);
    }
    const listCheck = await pool.query('SELECT id FROM contact_lists WHERE id = $1', [existing.rows[0].list_id]);
    if (listCheck.rows.length === 0) {
      throw new AppError('The assigned contact list no longer exists', 400);
    }

    await pool.query(
      "UPDATE campaigns SET status = 'sending', started_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );

    await campaignDispatchQueue.add('dispatch', { campaignId: id });

    res.json({ message: 'Campaign sending started' });
  } catch (err) {
    next(err);
  }
}

export async function pauseCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');
    const result = await pool.query(
      "UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1 AND status = 'sending' RETURNING id",
      [id]
    );
    if (result.rows.length === 0) throw new AppError('Campaign not found or not currently sending', 400);
    res.json({ message: 'Campaign paused' });
  } catch (err) {
    next(err);
  }
}

export async function resumeCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');

    // FIX: Validate template and list still exist before resuming
    const existing = await pool.query('SELECT template_id, list_id FROM campaigns WHERE id = $1 AND status = $2', [id, 'paused']);
    if (existing.rows.length === 0) throw new AppError('Campaign not found or not paused', 400);

    const templateCheck = await pool.query('SELECT id FROM templates WHERE id = $1 AND is_active = true', [existing.rows[0].template_id]);
    if (templateCheck.rows.length === 0) {
      throw new AppError('The assigned template no longer exists or has been deactivated', 400);
    }
    const listCheck = await pool.query('SELECT id FROM contact_lists WHERE id = $1', [existing.rows[0].list_id]);
    if (listCheck.rows.length === 0) {
      throw new AppError('The assigned contact list no longer exists', 400);
    }

    await pool.query(
      "UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1",
      [id]
    );

    await campaignDispatchQueue.add('dispatch', { campaignId: id });
    res.json({ message: 'Campaign resumed' });
  } catch (err) {
    next(err);
  }
}

export async function addAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');

    const existing = await pool.query('SELECT status, attachments FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Can only add attachments to draft or scheduled campaigns', 400);
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) throw new AppError('No files uploaded', 400);

    const currentAttachments = existing.rows[0].attachments || [];

    const newAttachments = files.map((file) => {
      const ext = path.extname(file.originalname);
      const storedName = `${Date.now()}-${Math.random().toString(36).substring(2)}${ext}`;
      const storedPath = path.join(UPLOAD_DIR, storedName);
      fs.writeFileSync(storedPath, file.buffer);

      return {
        filename: file.originalname,
        storagePath: storedPath,
        size: file.size,
        contentType: file.mimetype,
      };
    });

    const allAttachments = [...currentAttachments, ...newAttachments];

    await pool.query(
      'UPDATE campaigns SET attachments = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(allAttachments), id]
    );

    res.json({ attachments: allAttachments });
  } catch (err) {
    next(err);
  }
}

export async function removeAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, index } = req.params;
    validateUUID(id, 'campaign ID');
    const idx = parseInt(index);

    const existing = await pool.query('SELECT status, attachments FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Can only remove attachments from draft or scheduled campaigns', 400);
    }

    const attachments = existing.rows[0].attachments || [];
    if (isNaN(idx) || idx < 0 || idx >= attachments.length) {
      throw new AppError('Invalid attachment index', 400);
    }

    // Delete file from disk
    const removed = attachments[idx];
    if (removed.storagePath && fs.existsSync(removed.storagePath)) {
      fs.unlinkSync(removed.storagePath);
    }

    attachments.splice(idx, 1);

    await pool.query(
      'UPDATE campaigns SET attachments = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(attachments), id]
    );

    res.json({ attachments, removed: removed.filename });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'campaign ID');
    const { page, limit, offset } = parsePagination(req.query as { page?: string; limit?: string });
    const { status } = req.query;

    let whereClause = 'WHERE cr.campaign_id = $1';
    const params: unknown[] = [id];
    let idx = 2;

    if (status) {
      whereClause += ` AND cr.status = $${idx}`;
      params.push(status);
      idx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM campaign_recipients cr ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT cr.* FROM campaign_recipients cr ${whereClause}
       ORDER BY cr.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(buildPaginatedResult(result.rows, total, { page, limit, offset }));
  } catch (err) {
    next(err);
  }
}
