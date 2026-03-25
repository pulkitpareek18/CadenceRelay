import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUUID(id: string, label = 'ID'): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} format`, 400);
  }
}

/** Convert a display name to a snake_case key */
function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function listVariables(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT * FROM custom_variables ORDER BY sort_order ASC, created_at ASC'
    );
    res.json({ variables: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function createVariable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, key, type, options, required, default_value } = req.body;

    const finalKey = key || toSnakeCase(name);
    if (!finalKey) {
      throw new AppError('Variable name must contain at least one alphanumeric character', 400);
    }

    // Get next sort_order
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM custom_variables');
    const sortOrder = maxOrder.rows[0].next_order;

    const result = await pool.query(
      `INSERT INTO custom_variables (name, key, type, options, required, default_value, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        name,
        finalKey,
        type || 'text',
        JSON.stringify(options || []),
        required || false,
        default_value || null,
        sortOrder,
      ]
    );

    res.status(201).json({ variable: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function updateVariable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'variable ID');
    const { name, key, type, options, required, default_value } = req.body;

    const result = await pool.query(
      `UPDATE custom_variables SET
        name = COALESCE($1, name),
        key = COALESCE($2, key),
        type = COALESCE($3, type),
        options = COALESCE($4::jsonb, options),
        required = COALESCE($5, required),
        default_value = COALESCE($6, default_value)
       WHERE id = $7 RETURNING *`,
      [
        name || null,
        key || null,
        type || null,
        options ? JSON.stringify(options) : null,
        required !== undefined ? required : null,
        default_value !== undefined ? default_value : null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      throw new AppError('Custom variable not found', 404);
    }

    res.json({ variable: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function deleteVariable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'variable ID');

    const result = await pool.query('DELETE FROM custom_variables WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      throw new AppError('Custom variable not found', 404);
    }

    res.json({ message: 'Custom variable deleted' });
  } catch (err) {
    next(err);
  }
}

export async function reorderVariables(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { order } = req.body;

    if (!Array.isArray(order)) {
      throw new AppError('order must be an array of { id, sort_order }', 400);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of order) {
        if (!item.id || typeof item.sort_order !== 'number') continue;
        validateUUID(item.id, 'variable ID');
        await client.query('UPDATE custom_variables SET sort_order = $1 WHERE id = $2', [item.sort_order, item.id]);
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const result = await pool.query('SELECT * FROM custom_variables ORDER BY sort_order ASC, created_at ASC');
    res.json({ variables: result.rows });
  } catch (err) {
    next(err);
  }
}
