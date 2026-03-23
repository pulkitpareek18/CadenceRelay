import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResult } from '../utils/pagination';
import { campaignDispatchQueue } from '../queues/emailQueue';

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

    const result = await pool.query(
      `INSERT INTO campaigns (name, template_id, list_id, provider, throttle_per_second, throttle_per_hour)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, templateId, listId, provider || 'ses', throttlePerSecond || 5, throttlePerHour || 5000]
    );

    res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function updateCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { name, templateId, listId, provider, throttlePerSecond, throttlePerHour } = req.body;

    const existing = await pool.query('SELECT status FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
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
    const existing = await pool.query('SELECT status FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (existing.rows[0].status !== 'draft') throw new AppError('Can only delete draft campaigns', 400);

    await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    next(err);
  }
}

export async function scheduleCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { scheduledAt } = req.body;

    const existing = await pool.query('SELECT status, template_id, list_id FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Can only schedule draft or already-scheduled campaigns', 400);
    }
    if (!existing.rows[0].template_id || !existing.rows[0].list_id) {
      throw new AppError('Campaign must have a template and list before scheduling', 400);
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

    const existing = await pool.query('SELECT status, template_id, list_id FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Campaign not found', 404);
    if (!['draft', 'scheduled'].includes(existing.rows[0].status)) {
      throw new AppError('Campaign is already sending or completed', 400);
    }
    if (!existing.rows[0].template_id || !existing.rows[0].list_id) {
      throw new AppError('Campaign must have a template and list', 400);
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
    const result = await pool.query(
      "UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1 AND status = 'paused' RETURNING id",
      [id]
    );
    if (result.rows.length === 0) throw new AppError('Campaign not found or not paused', 400);

    await campaignDispatchQueue.add('dispatch', { campaignId: id });
    res.json({ message: 'Campaign resumed' });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
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
