import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResult } from '../utils/pagination';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUUID(id: string, label = 'ID'): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} format`, 400);
  }
}

// Build WHERE clause from smart list filter criteria
function buildSmartFilterWhere(
  criteria: Record<string, unknown>,
  params: unknown[],
  startIdx: number
): { where: string; paramIndex: number } {
  let where = '';
  let paramIndex = startIdx;

  if (criteria.state && Array.isArray(criteria.state) && criteria.state.length > 0) {
    where += ` AND c.state = ANY($${paramIndex})`;
    params.push(criteria.state);
    paramIndex++;
  }
  if (criteria.district && Array.isArray(criteria.district) && criteria.district.length > 0) {
    where += ` AND c.district = ANY($${paramIndex})`;
    params.push(criteria.district);
    paramIndex++;
  }
  if (criteria.block && Array.isArray(criteria.block) && criteria.block.length > 0) {
    where += ` AND c.block = ANY($${paramIndex})`;
    params.push(criteria.block);
    paramIndex++;
  }
  if (criteria.category && Array.isArray(criteria.category) && criteria.category.length > 0) {
    where += ` AND c.category = ANY($${paramIndex})`;
    params.push(criteria.category);
    paramIndex++;
  }
  if (criteria.management && Array.isArray(criteria.management) && criteria.management.length > 0) {
    where += ` AND c.management = ANY($${paramIndex})`;
    params.push(criteria.management);
    paramIndex++;
  }
  // Classes range filter: parse classes like "1-12" and check overlap
  if (criteria.classes_min != null || criteria.classes_max != null) {
    // We filter contacts whose classes range overlaps with [classes_min, classes_max]
    // classes column stores strings like "1-12", "9-12", etc.
    // We use a regex extract + cast approach
    if (criteria.classes_min != null) {
      where += ` AND CASE WHEN c.classes ~ '^[0-9]+-[0-9]+$' THEN CAST(split_part(c.classes, '-', 2) AS integer) >= $${paramIndex} ELSE true END`;
      params.push(criteria.classes_min);
      paramIndex++;
    }
    if (criteria.classes_max != null) {
      where += ` AND CASE WHEN c.classes ~ '^[0-9]+-[0-9]+$' THEN CAST(split_part(c.classes, '-', 1) AS integer) <= $${paramIndex} ELSE true END`;
      params.push(criteria.classes_max);
      paramIndex++;
    }
  }

  return { where, paramIndex };
}

export async function listLists(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT * FROM contact_lists ORDER BY created_at DESC'
    );

    // For smart lists, compute dynamic contact count
    for (const list of result.rows) {
      if (list.is_smart && list.filter_criteria) {
        const params: unknown[] = [];
        const { where } = buildSmartFilterWhere(list.filter_criteria, params, 1);
        const countRes = await pool.query(
          `SELECT COUNT(*) FROM contacts c WHERE c.status = 'active' ${where}`,
          params
        );
        list.contact_count = parseInt(countRes.rows[0].count);
      }
    }

    res.json({ lists: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'list ID');
    const { page, limit, offset } = parsePagination(req.query as { page?: string; limit?: string });

    const listResult = await pool.query('SELECT * FROM contact_lists WHERE id = $1', [id]);
    if (listResult.rows.length === 0) {
      throw new AppError('List not found', 404);
    }

    const list = listResult.rows[0];

    if (list.is_smart && list.filter_criteria) {
      // Smart list: dynamically query contacts matching filters
      const countParams: unknown[] = [];
      const { where, paramIndex: countEndIdx } = buildSmartFilterWhere(list.filter_criteria, countParams, 1);

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM contacts c WHERE c.status = 'active' ${where}`,
        countParams
      );
      const total = parseInt(countResult.rows[0].count);
      list.contact_count = total;

      const dataParams: unknown[] = [...countParams];
      const contactsResult = await pool.query(
        `SELECT c.* FROM contacts c
         WHERE c.status = 'active' ${where}
         ORDER BY c.created_at DESC
         LIMIT $${countEndIdx} OFFSET $${countEndIdx + 1}`,
        [...dataParams, limit, offset]
      );

      res.json({
        list,
        contacts: buildPaginatedResult(contactsResult.rows, total, { page, limit, offset }),
      });
    } else {
      // Regular list: use contact_list_members join
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM contact_list_members WHERE list_id = $1',
        [id]
      );
      const total = parseInt(countResult.rows[0].count);

      const contactsResult = await pool.query(
        `SELECT c.* FROM contacts c
         JOIN contact_list_members clm ON clm.contact_id = c.id
         WHERE clm.list_id = $1
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      res.json({
        list,
        contacts: buildPaginatedResult(contactsResult.rows, total, { page, limit, offset }),
      });
    }
  } catch (err) {
    next(err);
  }
}

export async function createList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description } = req.body;
    const result = await pool.query(
      'INSERT INTO contact_lists (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    res.status(201).json({ list: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function createSmartList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, filterCriteria } = req.body;

    if (!filterCriteria || typeof filterCriteria !== 'object') {
      throw new AppError('filterCriteria is required and must be an object', 400);
    }

    const result = await pool.query(
      'INSERT INTO contact_lists (name, description, is_smart, filter_criteria) VALUES ($1, $2, true, $3) RETURNING *',
      [name, description || null, JSON.stringify(filterCriteria)]
    );

    // Compute initial count
    const list = result.rows[0];
    const countParams: unknown[] = [];
    const { where } = buildSmartFilterWhere(filterCriteria, countParams, 1);
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM contacts c WHERE c.status = 'active' ${where}`,
      countParams
    );
    list.contact_count = parseInt(countRes.rows[0].count);

    res.status(201).json({ list });
  } catch (err) {
    next(err);
  }
}

export async function updateList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'list ID');
    const { name, description, filterCriteria } = req.body;

    let result;
    if (filterCriteria !== undefined) {
      result = await pool.query(
        'UPDATE contact_lists SET name = COALESCE($1, name), description = COALESCE($2, description), filter_criteria = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
        [name, description, filterCriteria ? JSON.stringify(filterCriteria) : null, id]
      );
    } else {
      result = await pool.query(
        'UPDATE contact_lists SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = NOW() WHERE id = $3 RETURNING *',
        [name, description, id]
      );
    }

    if (result.rows.length === 0) {
      throw new AppError('List not found', 404);
    }

    res.json({ list: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function deleteList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'list ID');

    // Use a transaction to handle FK constraints from campaigns.list_id
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT id FROM contact_lists WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new AppError('List not found', 404);
      }

      // Check if any non-draft campaigns reference this list
      const activeCampaigns = await client.query(
        "SELECT id, name, status FROM campaigns WHERE list_id = $1 AND status NOT IN ('draft')",
        [id]
      );
      if (activeCampaigns.rows.length > 0) {
        await client.query('ROLLBACK');
        throw new AppError(
          `Cannot delete list: ${activeCampaigns.rows.length} campaign(s) are using this list (${activeCampaigns.rows.map((c: { name: string }) => c.name).join(', ')})`,
          409
        );
      }

      // Nullify list_id in draft campaigns so the FK doesn't block deletion
      await client.query(
        "UPDATE campaigns SET list_id = NULL, updated_at = NOW() WHERE list_id = $1 AND status = 'draft'",
        [id]
      );

      // contact_list_members has ON DELETE CASCADE, so no manual cleanup needed
      await client.query('DELETE FROM contact_lists WHERE id = $1', [id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ message: 'List deleted' });
  } catch (err) {
    next(err);
  }
}

export async function addContactsToList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'list ID');
    const { contactIds } = req.body;

    if (!contactIds || contactIds.length === 0) {
      throw new AppError('contactIds required', 400);
    }

    // FIX: Properly build parameterized VALUES for multiple contactIds
    // Each row needs its own pair of params: (contact_id, list_id)
    const valuesPlaceholders: string[] = [];
    const queryParams: unknown[] = [];
    let paramIdx = 1;

    for (const contactId of contactIds) {
      valuesPlaceholders.push(`($${paramIdx}, $${paramIdx + 1})`);
      queryParams.push(contactId, id);
      paramIdx += 2;
    }

    await pool.query(
      `INSERT INTO contact_list_members (contact_id, list_id) VALUES ${valuesPlaceholders.join(', ')} ON CONFLICT DO NOTHING`,
      queryParams
    );

    await pool.query(
      'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contact_list_members WHERE list_id = $1), updated_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({ message: `Added ${contactIds.length} contacts to list` });
  } catch (err) {
    next(err);
  }
}

export async function removeContactsFromList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    validateUUID(id, 'list ID');
    const { contactIds } = req.body;

    if (!contactIds || contactIds.length === 0) {
      throw new AppError('contactIds required', 400);
    }

    await pool.query(
      'DELETE FROM contact_list_members WHERE list_id = $1 AND contact_id = ANY($2)',
      [id, contactIds]
    );

    await pool.query(
      'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contact_list_members WHERE list_id = $1), updated_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({ message: `Removed ${contactIds.length} contacts from list` });
  } catch (err) {
    next(err);
  }
}
