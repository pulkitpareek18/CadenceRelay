import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResult } from '../utils/pagination';

export async function listContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req.query as { page?: string; limit?: string });
    const { search, status, listId, minSendCount, maxSendCount } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (c.email ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (status) {
      whereClause += ` AND c.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (listId) {
      whereClause += ` AND c.id IN (SELECT contact_id FROM contact_list_members WHERE list_id = $${paramIndex})`;
      params.push(listId);
      paramIndex++;
    }
    if (minSendCount) {
      whereClause += ` AND c.send_count >= $${paramIndex}`;
      params.push(parseInt(minSendCount as string));
      paramIndex++;
    }
    if (maxSendCount) {
      whereClause += ` AND c.send_count <= $${paramIndex}`;
      params.push(parseInt(maxSendCount as string));
      paramIndex++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM contacts c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT c.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', cl.id, 'name', cl.name))
           FROM contact_list_members clm
           JOIN contact_lists cl ON cl.id = clm.list_id
           WHERE clm.contact_id = c.id), '[]'
        ) as lists
       FROM contacts c ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json(buildPaginatedResult(dataResult.rows, total, { page, limit, offset }));
  } catch (err) {
    next(err);
  }
}

export async function getContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', cl.id, 'name', cl.name))
           FROM contact_list_members clm
           JOIN contact_lists cl ON cl.id = clm.list_id
           WHERE clm.contact_id = c.id), '[]'
        ) as lists
       FROM contacts c WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    // Get send history
    const history = await pool.query(
      `SELECT cr.campaign_id, cam.name as campaign_name, cr.status, cr.sent_at, cr.opened_at, cr.clicked_at, cr.bounced_at
       FROM campaign_recipients cr
       JOIN campaigns cam ON cam.id = cr.campaign_id
       WHERE cr.contact_id = $1
       ORDER BY cr.sent_at DESC
       LIMIT 50`,
      [id]
    );

    res.json({ contact: result.rows[0], sendHistory: history.rows });
  } catch (err) {
    next(err);
  }
}

export async function createContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, name, metadata, listIds } = req.body;

    const existing = await pool.query('SELECT id FROM contacts WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new AppError('Contact with this email already exists', 409);
    }

    const result = await pool.query(
      'INSERT INTO contacts (email, name, metadata) VALUES ($1, $2, $3) RETURNING *',
      [email, name || null, metadata || {}]
    );

    const contact = result.rows[0];

    // FIX: Properly expand parameterized VALUES for multiple listIds
    if (listIds && listIds.length > 0) {
      const valuesPlaceholders: string[] = [];
      const queryParams: unknown[] = [];
      let paramIdx = 1;

      for (const listId of listIds) {
        valuesPlaceholders.push(`($${paramIdx}, $${paramIdx + 1})`);
        queryParams.push(contact.id, listId);
        paramIdx += 2;
      }

      await pool.query(
        `INSERT INTO contact_list_members (contact_id, list_id) VALUES ${valuesPlaceholders.join(', ')} ON CONFLICT DO NOTHING`,
        queryParams
      );
      // Update list counts
      await pool.query(
        `UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contact_list_members WHERE list_id = contact_lists.id), updated_at = NOW() WHERE id = ANY($1)`,
        [listIds]
      );
    }

    res.status(201).json({ contact });
  } catch (err) {
    next(err);
  }
}

export async function updateContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { email, name, metadata, status } = req.body;

    // FIX: Pass metadata as a proper JSON object (not stringified) so COALESCE works correctly with the jsonb column
    const result = await pool.query(
      `UPDATE contacts SET
        email = COALESCE($1, email),
        name = COALESCE($2, name),
        metadata = COALESCE($3::jsonb, metadata),
        status = COALESCE($4, status),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [email, name, metadata ? JSON.stringify(metadata) : null, status, id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    res.json({ contact: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function deleteContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM contacts WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    next(err);
  }
}

// FIX: Proper CSV field parsing that handles quoted fields
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// FIX: Proper email validation using a reasonable regex
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function importContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError('CSV file required', 400);
    }

    const { listId } = req.body;
    const csvContent = file.buffer.toString('utf-8');
    const lines = csvContent.split('\n').filter((line) => line.trim());

    if (lines.length < 2) {
      throw new AppError('CSV must have a header row and at least one data row', 400);
    }

    // FIX: Use proper CSV parsing for headers too
    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
    const emailIdx = headers.indexOf('email');
    const nameIdx = headers.indexOf('name');

    if (emailIdx === -1) {
      throw new AppError('CSV must have an "email" column', 400);
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      // FIX: Use proper CSV parsing instead of naive split(',')
      const cols = parseCSVLine(lines[i]);
      const email = cols[emailIdx]?.trim();
      const name = nameIdx >= 0 ? cols[nameIdx]?.trim() || null : null;

      // FIX: Proper email validation instead of just checking for '@'
      if (!email || !isValidEmail(email)) {
        skipped++;
        errors.push(`Row ${i + 1}: Invalid email "${email || ''}"`);
        continue;
      }

      try {
        const result = await pool.query(
          'INSERT INTO contacts (email, name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name), updated_at = NOW() RETURNING id',
          [email, name]
        );

        if (listId && result.rows[0]) {
          await pool.query(
            'INSERT INTO contact_list_members (contact_id, list_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [result.rows[0].id, listId]
          );
        }

        imported++;
      } catch {
        skipped++;
        errors.push(`Row ${i + 1}: Failed to import "${email}"`);
      }
    }

    // Update list count
    if (listId) {
      await pool.query(
        'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contact_list_members WHERE list_id = $1), updated_at = NOW() WHERE id = $1',
        [listId]
      );
    }

    res.json({ imported, skipped, total: lines.length - 1, errors: errors.slice(0, 20) });
  } catch (err) {
    next(err);
  }
}

// FIX: Proper CSV field escaping for values containing quotes or commas
function escapeCSVField(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { listId } = req.query;

    let query = 'SELECT email, name, status, send_count, bounce_count, last_sent_at, created_at FROM contacts';
    const params: unknown[] = [];

    if (listId) {
      query += ' WHERE id IN (SELECT contact_id FROM contact_list_members WHERE list_id = $1)';
      params.push(listId);
    }

    query += ' ORDER BY email';

    const result = await pool.query(query, params);

    const csvHeader = 'email,name,status,send_count,bounce_count,last_sent_at,created_at\n';
    // FIX: Properly escape all fields in CSV output
    const csvRows = result.rows
      .map((r) =>
        [
          escapeCSVField(r.email),
          escapeCSVField(r.name),
          escapeCSVField(r.status),
          r.send_count,
          r.bounce_count,
          r.last_sent_at || '',
          r.created_at,
        ].join(',')
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
    res.send(csvHeader + csvRows);
  } catch (err) {
    next(err);
  }
}
