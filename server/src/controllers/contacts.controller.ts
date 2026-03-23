import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResult } from '../utils/pagination';
import { verifyAdminPassword } from '../utils/adminAuth';

// Validate UUID format to avoid Postgres "invalid input syntax for type uuid" 500 errors
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUUID(id: string, label = 'ID'): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} format`, 400);
  }
}

export async function listContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req.query as { page?: string; limit?: string });
    const { search, status, listId, minSendCount, maxSendCount, state, district, block, category, management } = req.query;

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
    if (state) {
      const states = (state as string).split(',').map(s => s.trim()).filter(Boolean);
      whereClause += ` AND c.state = ANY($${paramIndex})`;
      params.push(states);
      paramIndex++;
    }
    if (district) {
      const districts = (district as string).split(',').map(s => s.trim()).filter(Boolean);
      whereClause += ` AND c.district = ANY($${paramIndex})`;
      params.push(districts);
      paramIndex++;
    }
    if (block) {
      const blocks = (block as string).split(',').map(s => s.trim()).filter(Boolean);
      whereClause += ` AND c.block = ANY($${paramIndex})`;
      params.push(blocks);
      paramIndex++;
    }
    if (category) {
      const categories = (category as string).split(',').map(s => s.trim()).filter(Boolean);
      whereClause += ` AND c.category = ANY($${paramIndex})`;
      params.push(categories);
      paramIndex++;
    }
    if (management) {
      const managements = (management as string).split(',').map(s => s.trim()).filter(Boolean);
      whereClause += ` AND c.management = ANY($${paramIndex})`;
      params.push(managements);
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
    validateUUID(id, 'contact ID');

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
    validateUUID(id, 'contact ID');
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
    validateUUID(id, 'contact ID');
    const { adminPassword } = req.body;
    await verifyAdminPassword(adminPassword);

    // Use a transaction to clean up foreign key references before deleting
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check contact exists
      const existing = await client.query('SELECT id FROM contacts WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new AppError('Contact not found', 404);
      }

      // Nullify contact_id in campaign_recipients so historical send data is preserved
      // but the FK constraint no longer blocks deletion
      await client.query(
        'UPDATE campaign_recipients SET contact_id = NULL WHERE contact_id = $1',
        [id]
      );

      // contact_list_members has ON DELETE CASCADE, so no manual cleanup needed

      // Now delete the contact
      await client.query('DELETE FROM contacts WHERE id = $1', [id]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ message: 'Contact deleted' });
  } catch (err) {
    next(err);
  }
}

export async function bulkDeleteContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids, adminPassword } = req.body;
    await verifyAdminPassword(adminPassword);

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('ids must be a non-empty array', 400);
    }
    for (const id of ids) {
      validateUUID(id, 'contact ID');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Nullify contact_id in campaign_recipients for all contacts being deleted
      await client.query(
        'UPDATE campaign_recipients SET contact_id = NULL WHERE contact_id = ANY($1)',
        [ids]
      );

      // contact_list_members has ON DELETE CASCADE
      const result = await client.query('DELETE FROM contacts WHERE id = ANY($1)', [ids]);

      await client.query('COMMIT');
      res.json({ message: `${result.rowCount} contact(s) deleted` });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
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

// Column name mapping: CSV header -> DB column
const COLUMN_MAP: Record<string, string> = {
  email: 'email',
  name: 'name',
  school_name: 'name',
  state: 'state',
  district: 'district',
  block: 'block',
  classes: 'classes',
  category: 'category',
  management: 'management',
  address: 'address',
};

export async function importContactsCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError('CSV file required', 400);
    }

    const { listId } = req.body;
    // Parse optional column mapping overrides from the body (JSON string)
    let columnMapping: Record<string, string> | undefined;
    if (req.body.columnMapping) {
      try {
        columnMapping = JSON.parse(req.body.columnMapping);
      } catch {
        throw new AppError('Invalid columnMapping JSON', 400);
      }
    }

    const csvContent = file.buffer.toString('utf-8');
    const lines = csvContent.split('\n').filter((line) => line.trim());

    if (lines.length < 2) {
      throw new AppError('CSV must have a header row and at least one data row', 400);
    }

    // Parse headers and build mapping
    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
    const mapping: Record<string, number> = {}; // db_column -> csv_index

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      // If user provided custom mapping, use it; otherwise use auto-detect
      if (columnMapping && columnMapping[header]) {
        mapping[columnMapping[header]] = i;
      } else if (COLUMN_MAP[header]) {
        mapping[COLUMN_MAP[header]] = i;
      }
    }

    if (mapping['email'] === undefined) {
      throw new AppError('CSV must have an "email" column (or mapped equivalent)', 400);
    }

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 500;
    const dataRows = lines.slice(1);

    // Process in batches
    for (let batchStart = 0; batchStart < dataRows.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, dataRows.length);
      const batch = dataRows.slice(batchStart, batchEnd);

      const validRows: {
        email: string;
        name: string | null;
        state: string | null;
        district: string | null;
        block: string | null;
        classes: string | null;
        category: string | null;
        management: string | null;
        address: string | null;
      }[] = [];

      for (let i = 0; i < batch.length; i++) {
        const lineNum = batchStart + i + 2; // 1-indexed, skip header
        const cols = parseCSVLine(batch[i]);

        const email = cols[mapping['email']]?.trim();
        if (!email || !isValidEmail(email)) {
          skipped++;
          if (errors.length < 50) {
            errors.push(`Row ${lineNum}: Invalid email "${email || ''}"`);
          }
          continue;
        }

        validRows.push({
          email,
          name: mapping['name'] !== undefined ? cols[mapping['name']]?.trim() || null : null,
          state: mapping['state'] !== undefined ? cols[mapping['state']]?.trim() || null : null,
          district: mapping['district'] !== undefined ? cols[mapping['district']]?.trim() || null : null,
          block: mapping['block'] !== undefined ? cols[mapping['block']]?.trim() || null : null,
          classes: mapping['classes'] !== undefined ? cols[mapping['classes']]?.trim() || null : null,
          category: mapping['category'] !== undefined ? cols[mapping['category']]?.trim() || null : null,
          management: mapping['management'] !== undefined ? cols[mapping['management']]?.trim() || null : null,
          address: mapping['address'] !== undefined ? cols[mapping['address']]?.trim() || null : null,
        });
      }

      if (validRows.length === 0) continue;

      // Batch insert with ON CONFLICT
      const valuesPlaceholders: string[] = [];
      const queryParams: unknown[] = [];
      let paramIdx = 1;

      for (const row of validRows) {
        valuesPlaceholders.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8})`
        );
        queryParams.push(
          row.email,
          row.name,
          row.state,
          row.district,
          row.block,
          row.classes,
          row.category,
          row.management,
          row.address
        );
        paramIdx += 9;
      }

      const insertResult = await pool.query(
        `INSERT INTO contacts (email, name, state, district, block, classes, category, management, address)
         VALUES ${valuesPlaceholders.join(', ')}
         ON CONFLICT (email) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, contacts.name),
           state = COALESCE(EXCLUDED.state, contacts.state),
           district = COALESCE(EXCLUDED.district, contacts.district),
           block = COALESCE(EXCLUDED.block, contacts.block),
           classes = COALESCE(EXCLUDED.classes, contacts.classes),
           category = COALESCE(EXCLUDED.category, contacts.category),
           management = COALESCE(EXCLUDED.management, contacts.management),
           address = COALESCE(EXCLUDED.address, contacts.address),
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS is_new`,
        queryParams
      );

      const newIds: string[] = [];
      for (const row of insertResult.rows) {
        if (row.is_new) {
          imported++;
        } else {
          duplicates++;
        }
        newIds.push(row.id);
      }

      // If listId provided, add all contacts to the list
      if (listId && newIds.length > 0) {
        const listValues: string[] = [];
        const listParams: unknown[] = [];
        let lIdx = 1;
        for (const cId of newIds) {
          listValues.push(`($${lIdx}, $${lIdx + 1})`);
          listParams.push(cId, listId);
          lIdx += 2;
        }
        await pool.query(
          `INSERT INTO contact_list_members (contact_id, list_id) VALUES ${listValues.join(', ')} ON CONFLICT DO NOTHING`,
          listParams
        );
      }
    }

    // Update list count
    if (listId) {
      await pool.query(
        'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contact_list_members WHERE list_id = $1), updated_at = NOW() WHERE id = $1',
        [listId]
      );
    }

    res.json({
      imported,
      duplicates,
      skipped,
      total: dataRows.length,
      errors: errors.slice(0, 20),
      detectedColumns: Object.keys(mapping),
    });
  } catch (err) {
    next(err);
  }
}

// Preview CSV: returns headers and first N rows for column mapping UI
export async function previewCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError('CSV file required', 400);
    }

    const csvContent = file.buffer.toString('utf-8');
    const lines = csvContent.split('\n').filter((line) => line.trim());

    if (lines.length < 1) {
      throw new AppError('CSV file is empty', 400);
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.trim());

    // Auto-detect column mapping
    const autoMapping: Record<string, string> = {};
    for (const header of headers) {
      const lower = header.toLowerCase();
      if (COLUMN_MAP[lower]) {
        autoMapping[header] = COLUMN_MAP[lower];
      }
    }

    // Get first 10 data rows
    const previewRows: string[][] = [];
    for (let i = 1; i < Math.min(lines.length, 11); i++) {
      previewRows.push(parseCSVLine(lines[i]));
    }

    res.json({
      headers,
      autoMapping,
      previewRows,
      totalRows: lines.length - 1,
    });
  } catch (err) {
    next(err);
  }
}

// Legacy import (keep for backwards compatibility)
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

    let query = 'SELECT email, name, state, district, block, classes, category, management, address, status, send_count, bounce_count, last_sent_at, created_at FROM contacts';
    const params: unknown[] = [];

    if (listId) {
      query += ' WHERE id IN (SELECT contact_id FROM contact_list_members WHERE list_id = $1)';
      params.push(listId);
    }

    query += ' ORDER BY email';

    const result = await pool.query(query, params);

    const csvHeader = 'email,name,state,district,block,classes,category,management,address,status,send_count,bounce_count,last_sent_at,created_at\n';
    // FIX: Properly escape all fields in CSV output
    const csvRows = result.rows
      .map((r) =>
        [
          escapeCSVField(r.email),
          escapeCSVField(r.name),
          escapeCSVField(r.state),
          escapeCSVField(r.district),
          escapeCSVField(r.block),
          escapeCSVField(r.classes),
          escapeCSVField(r.category),
          escapeCSVField(r.management),
          escapeCSVField(r.address),
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

// Filter facets endpoint: returns unique values for filter dropdowns
export async function getContactFilters(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { state, district } = req.query;

    const result: Record<string, string[]> = {};

    // Always return states
    const statesRes = await pool.query(
      "SELECT DISTINCT state FROM contacts WHERE state IS NOT NULL AND state != '' ORDER BY state"
    );
    result.states = statesRes.rows.map((r) => r.state);

    // Districts: optionally filtered by state
    if (state) {
      const states = (state as string).split(',').map(s => s.trim()).filter(Boolean);
      const distRes = await pool.query(
        "SELECT DISTINCT district FROM contacts WHERE district IS NOT NULL AND district != '' AND state = ANY($1) ORDER BY district",
        [states]
      );
      result.districts = distRes.rows.map((r) => r.district);
    } else {
      const distRes = await pool.query(
        "SELECT DISTINCT district FROM contacts WHERE district IS NOT NULL AND district != '' ORDER BY district"
      );
      result.districts = distRes.rows.map((r) => r.district);
    }

    // Blocks: optionally filtered by district
    if (district) {
      const districts = (district as string).split(',').map(s => s.trim()).filter(Boolean);
      const blockRes = await pool.query(
        "SELECT DISTINCT block FROM contacts WHERE block IS NOT NULL AND block != '' AND district = ANY($1) ORDER BY block",
        [districts]
      );
      result.blocks = blockRes.rows.map((r) => r.block);
    } else {
      const blockRes = await pool.query(
        "SELECT DISTINCT block FROM contacts WHERE block IS NOT NULL AND block != '' ORDER BY block"
      );
      result.blocks = blockRes.rows.map((r) => r.block);
    }

    // Categories
    const catRes = await pool.query(
      "SELECT DISTINCT category FROM contacts WHERE category IS NOT NULL AND category != '' ORDER BY category"
    );
    result.categories = catRes.rows.map((r) => r.category);

    // Management types
    const mgmtRes = await pool.query(
      "SELECT DISTINCT management FROM contacts WHERE management IS NOT NULL AND management != '' ORDER BY management"
    );
    result.managements = mgmtRes.rows.map((r) => r.management);

    res.json(result);
  } catch (err) {
    next(err);
  }
}
