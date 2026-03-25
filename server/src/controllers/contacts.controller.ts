import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResult } from '../utils/pagination';
import { verifyAdminPassword } from '../utils/adminAuth';
import { cacheThrough, cacheDel } from '../utils/cache';
import fs from 'fs';
import readline from 'readline';

// Validate UUID format to avoid Postgres "invalid input syntax for type uuid" 500 errors
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUUID(id: string, label = 'ID'): void {
  if (!UUID_RE.test(id)) {
    throw new AppError(`Invalid ${label} format`, 400);
  }
}

// Safe column mapping for sorting — prevents SQL injection
const SORT_COLUMN_MAP: Record<string, string> = {
  email: 'c.email',
  name: 'c.name',
  status: 'c.status',
  send_count: 'c.send_count',
  created_at: 'c.created_at',
  state: 'c.state',
  district: 'c.district',
};

export async function listContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req.query as { page?: string; limit?: string });
    const { search, status, listId, minSendCount, maxSendCount, state, district, block, category, management, sortBy, sortDir } = req.query;

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
      // Check if this is a smart list — smart lists use dynamic filter criteria, not contact_list_members
      const listResult = await pool.query('SELECT is_smart, filter_criteria FROM contact_lists WHERE id = $1', [listId]);
      const list = listResult.rows[0];
      if (list?.is_smart && list.filter_criteria) {
        const criteria = list.filter_criteria as Record<string, unknown>;
        if (criteria.state && Array.isArray(criteria.state) && criteria.state.length > 0) {
          whereClause += ` AND c.state = ANY($${paramIndex})`;
          params.push(criteria.state);
          paramIndex++;
        }
        if (criteria.district && Array.isArray(criteria.district) && criteria.district.length > 0) {
          whereClause += ` AND c.district = ANY($${paramIndex})`;
          params.push(criteria.district);
          paramIndex++;
        }
        if (criteria.block && Array.isArray(criteria.block) && criteria.block.length > 0) {
          whereClause += ` AND c.block = ANY($${paramIndex})`;
          params.push(criteria.block);
          paramIndex++;
        }
        if (criteria.category && Array.isArray(criteria.category) && criteria.category.length > 0) {
          whereClause += ` AND c.category = ANY($${paramIndex})`;
          params.push(criteria.category);
          paramIndex++;
        }
        if (criteria.management && Array.isArray(criteria.management) && criteria.management.length > 0) {
          whereClause += ` AND c.management = ANY($${paramIndex})`;
          params.push(criteria.management);
          paramIndex++;
        }
        if (criteria.classes_min != null) {
          whereClause += ` AND CASE WHEN c.classes ~ '^[0-9]+-[0-9]+$' THEN CAST(split_part(c.classes, '-', 2) AS integer) >= $${paramIndex} ELSE true END`;
          params.push(criteria.classes_min);
          paramIndex++;
        }
        if (criteria.classes_max != null) {
          whereClause += ` AND CASE WHEN c.classes ~ '^[0-9]+-[0-9]+$' THEN CAST(split_part(c.classes, '-', 1) AS integer) <= $${paramIndex} ELSE true END`;
          params.push(criteria.classes_max);
          paramIndex++;
        }
      } else {
        // Regular list — use contact_list_members
        whereClause += ` AND c.id IN (SELECT contact_id FROM contact_list_members WHERE list_id = $${paramIndex})`;
        params.push(listId);
        paramIndex++;
      }
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

    // Determine sort order from query params with safe column whitelist
    const sortColumn = (typeof sortBy === 'string' && SORT_COLUMN_MAP[sortBy]) ? SORT_COLUMN_MAP[sortBy] : 'c.created_at';
    const sortDirection = (typeof sortDir === 'string' && sortDir.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

    const dataResult = await pool.query(
      `SELECT c.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', cl.id, 'name', cl.name))
           FROM contact_list_members clm
           JOIN contact_lists cl ON cl.id = clm.list_id
           WHERE clm.contact_id = c.id), '[]'
        ) as lists
       FROM contacts c ${whereClause}
       ORDER BY ${sortColumn} ${sortDirection}
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
  const filePath = req.file?.path;
  try {
    const file = req.file;
    if (!file || !filePath) {
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

    // Fetch custom variable definitions to detect metadata columns
    const cvResult = await pool.query('SELECT key FROM custom_variables ORDER BY sort_order');
    const customVariableKeys = new Set(cvResult.rows.map((r: { key: string }) => r.key));

    // --- Stream-based CSV import for large files (65MB+, 280K+ rows) ---
    // Instead of loading the entire file into memory, we read line-by-line.

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let headers: string[] | null = null;
    const mapping: Record<string, number> = {};
    // Track which CSV column indices map to custom variable keys
    const metadataMapping: Record<string, number> = {};
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let totalRows = 0;
    const errors: string[] = [];

    type ContactRow = {
      email: string;
      name: string | null;
      state: string | null;
      district: string | null;
      block: string | null;
      classes: string | null;
      category: string | null;
      management: string | null;
      address: string | null;
      metadata: Record<string, string>;
    };

    const BATCH_SIZE = 500;
    let batch: ContactRow[] = [];

    // Truncate a string to fit a VARCHAR(N) column
    function truncate(val: string | null, maxLen: number): string | null {
      if (!val) return null;
      return val.length > maxLen ? val.substring(0, maxLen) : val;
    }

    // Helper: flush a batch to the database
    async function flushBatch(rows: ContactRow[]): Promise<void> {
      if (rows.length === 0) return;

      // Deduplicate within batch (PostgreSQL ON CONFLICT can't handle same email twice)
      const seenEmails = new Map<string, number>();
      for (let ri = 0; ri < rows.length; ri++) {
        seenEmails.set(rows[ri].email.toLowerCase(), ri);
      }
      const uniqueRows = [...seenEmails.values()].map(idx => rows[idx]);
      const inBatchDupes = rows.length - uniqueRows.length;
      if (inBatchDupes > 0) duplicates += inBatchDupes;

      const valuesPlaceholders: string[] = [];
      const queryParams: unknown[] = [];
      let paramIdx = 1;

      for (const row of uniqueRows) {
        valuesPlaceholders.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9})`
        );
        queryParams.push(
          truncate(row.email, 320),
          truncate(row.name, 255),
          truncate(row.state, 100),
          truncate(row.district, 100),
          truncate(row.block, 100),
          truncate(row.classes, 255),
          truncate(row.category, 100),
          truncate(row.management, 100),
          row.address, // text — no limit
          Object.keys(row.metadata).length > 0 ? JSON.stringify(row.metadata) : '{}'
        );
        paramIdx += 10;
      }

      try {
        const insertResult = await pool.query(
          `INSERT INTO contacts (email, name, state, district, block, classes, category, management, address, metadata)
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
             metadata = contacts.metadata || EXCLUDED.metadata,
             updated_at = NOW()
           RETURNING id, (xmax = 0) AS is_new`,
          queryParams
        );

        const newIds: string[] = [];
        for (const row of insertResult.rows) {
          if (row.is_new) imported++;
          else duplicates++;
          newIds.push(row.id);
        }

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
      } catch (batchErr) {
        // Log the batch error but continue importing remaining batches
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        if (errors.length < 50) {
          errors.push(`Batch error at rows ~${totalRows - rows.length + 1}-${totalRows}: ${msg}`);
        }
        skipped += uniqueRows.length;
      }
    }

    // Process the file line by line
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (!headers) {
        // First non-empty line = header row
        headers = parseCSVLine(trimmed).map((h) => h.toLowerCase().trim());
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i];
          if (columnMapping && columnMapping[header]) {
            const target = columnMapping[header];
            // Check if mapped target is a custom variable key
            if (customVariableKeys.has(target)) {
              metadataMapping[target] = i;
            } else {
              mapping[target] = i;
            }
          } else if (COLUMN_MAP[header]) {
            mapping[COLUMN_MAP[header]] = i;
          } else if (customVariableKeys.has(header)) {
            // Auto-detect: CSV header matches a custom variable key
            metadataMapping[header] = i;
          }
        }
        if (mapping['email'] === undefined) {
          throw new AppError('CSV must have an "email" column (or mapped equivalent)', 400);
        }
        continue;
      }

      totalRows++;
      const cols = parseCSVLine(trimmed);
      const email = cols[mapping['email']]?.trim();

      if (!email || !isValidEmail(email)) {
        skipped++;
        if (errors.length < 50) {
          errors.push(`Row ${totalRows + 1}: Invalid email "${email || ''}"`);
        }
        continue;
      }

      const getCol = (key: string): string | null => {
        if (mapping[key] === undefined) return null;
        return cols[mapping[key]]?.trim() || null;
      };

      // Build metadata from custom variable columns
      const rowMetadata: Record<string, string> = {};
      for (const [cvKey, colIdx] of Object.entries(metadataMapping)) {
        const val = cols[colIdx]?.trim();
        if (val) rowMetadata[cvKey] = val;
      }

      batch.push({
        email,
        name: getCol('name'),
        state: getCol('state'),
        district: getCol('district'),
        block: getCol('block'),
        classes: getCol('classes'),
        category: getCol('category'),
        management: getCol('management'),
        address: getCol('address'),
        metadata: rowMetadata,
      });

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(batch);
        batch = [];
      }
    }

    // Flush remaining rows
    await flushBatch(batch);

    if (!headers) {
      throw new AppError('CSV must have a header row and at least one data row', 400);
    }

    // Update list count
    if (listId) {
      await pool.query(
        'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contact_list_members WHERE list_id = $1), updated_at = NOW() WHERE id = $1',
        [listId]
      );
    }

    // Invalidate contact filter cache after import
    await cacheDel('contact-filters:*');

    res.json({
      imported,
      duplicates,
      skipped,
      total: totalRows,
      errors: errors.slice(0, 20),
      detectedColumns: Object.keys(mapping),
    });
  } catch (err) {
    next(err);
  } finally {
    // Clean up the uploaded temp file
    if (filePath) {
      fs.unlink(filePath, () => {});
    }
  }
}

// Preview CSV: returns headers and first N rows for column mapping UI
export async function previewCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new AppError('CSV file required', 400);
    }

    // Fetch custom variable definitions to auto-detect metadata columns
    const cvResult = await pool.query('SELECT key FROM custom_variables ORDER BY sort_order');
    const customVariableKeys = new Set(cvResult.rows.map((r: { key: string }) => r.key));

    // Read only the first 64KB for preview (works for any file size)
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    const csvContent = buf.slice(0, bytesRead).toString('utf-8');
    const lines = csvContent.split(/\r?\n/).filter((line) => line.trim());

    if (lines.length < 1) {
      throw new AppError('CSV file is empty', 400);
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.trim());

    const autoMapping: Record<string, string> = {};
    for (const header of headers) {
      const lower = header.toLowerCase();
      if (COLUMN_MAP[lower]) {
        autoMapping[header] = COLUMN_MAP[lower];
      } else if (customVariableKeys.has(lower)) {
        autoMapping[header] = lower;
      }
    }

    const previewRows: string[][] = [];
    for (let i = 1; i < Math.min(lines.length, 11); i++) {
      previewRows.push(parseCSVLine(lines[i]));
    }

    // Estimate total rows from file size
    const stat = fs.statSync(filePath);
    let totalRows: number;
    if (stat.size <= 64 * 1024) {
      totalRows = lines.length - 1;
    } else {
      const sampleBytes = Buffer.byteLength(lines.slice(0, 11).join('\n'), 'utf-8');
      const avgBytesPerLine = sampleBytes / Math.min(lines.length, 11);
      totalRows = Math.round(stat.size / avgBytesPerLine) - 1;
    }

    res.json({ headers, autoMapping, previewRows, totalRows });
  } catch (err) {
    next(err);
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
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
    // Support both disk storage (file.path) and memory storage (file.buffer)
    const csvContent = file.path
      ? fs.readFileSync(file.path, 'utf-8')
      : (file.buffer as Buffer).toString('utf-8');
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

    // Invalidate contact filter cache after import
    await cacheDel('contact-filters:*');

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
    const cacheKey = `contact-filters:${state || ''}:${district || ''}`;

    const result = await cacheThrough<Record<string, string[]>>(cacheKey, async () => {
      const filters: Record<string, string[]> = {};

      // Always return states
      const statesRes = await pool.query(
        "SELECT DISTINCT state FROM contacts WHERE state IS NOT NULL AND state != '' ORDER BY state"
      );
      filters.states = statesRes.rows.map((r) => r.state);

      // Districts: optionally filtered by state
      if (state) {
        const states = (state as string).split(',').map(s => s.trim()).filter(Boolean);
        const distRes = await pool.query(
          "SELECT DISTINCT district FROM contacts WHERE district IS NOT NULL AND district != '' AND state = ANY($1) ORDER BY district",
          [states]
        );
        filters.districts = distRes.rows.map((r) => r.district);
      } else {
        const distRes = await pool.query(
          "SELECT DISTINCT district FROM contacts WHERE district IS NOT NULL AND district != '' ORDER BY district"
        );
        filters.districts = distRes.rows.map((r) => r.district);
      }

      // Blocks: optionally filtered by district
      if (district) {
        const districts = (district as string).split(',').map(s => s.trim()).filter(Boolean);
        const blockRes = await pool.query(
          "SELECT DISTINCT block FROM contacts WHERE block IS NOT NULL AND block != '' AND district = ANY($1) ORDER BY block",
          [districts]
        );
        filters.blocks = blockRes.rows.map((r) => r.block);
      } else {
        const blockRes = await pool.query(
          "SELECT DISTINCT block FROM contacts WHERE block IS NOT NULL AND block != '' ORDER BY block"
        );
        filters.blocks = blockRes.rows.map((r) => r.block);
      }

      // Categories
      const catRes = await pool.query(
        "SELECT DISTINCT category FROM contacts WHERE category IS NOT NULL AND category != '' ORDER BY category"
      );
      filters.categories = catRes.rows.map((r) => r.category);

      // Management types
      const mgmtRes = await pool.query(
        "SELECT DISTINCT management FROM contacts WHERE management IS NOT NULL AND management != '' ORDER BY management"
      );
      filters.managements = mgmtRes.rows.map((r) => r.management);

      return filters;
    }, 300); // Cache for 5 minutes

    res.json(result);
  } catch (err) {
    next(err);
  }
}
