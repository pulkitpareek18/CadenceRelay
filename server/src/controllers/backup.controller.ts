import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { verifyAdminPassword } from '../utils/adminAuth';
import { logger } from '../utils/logger';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

/**
 * Tables exported in dependency order (parents first, children last)
 * On import, we restore in this same order to satisfy foreign keys.
 */
export const BACKUP_TABLES: string[] = [
  'admin_users',
  'settings',
  'projects',
  'campaign_labels',
  'custom_variables',
  'email_accounts',
  'suppression_list',
  'suppressed_domains',
  'contacts',
  'contact_lists',
  'contact_list_members',
  'templates',
  'template_versions',
  'campaigns',
  'campaign_recipients',
  'email_events',
  'unsubscribes',
  'automations',
  'automation_steps',
  'automation_enrollments',
];

const BACKUP_VERSION = 1;
const STREAM_BATCH_SIZE = 1000;

/**
 * GET /backup/export — streams a ZIP backup of the entire database + uploads
 */
export async function exportBackup(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `cadencerelay-backup-${timestamp}.crelay`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      logger.error('Backup archive error', { error: err.message });
      next(err);
    });
    archive.pipe(res);

    // 1. Metadata file
    const meta = {
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      tables: BACKUP_TABLES,
      app: 'cadencerelay',
    };
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });

    // 2. Export each table to its own JSON file
    for (const table of BACKUP_TABLES) {
      const exists = await pool.query(
        `SELECT to_regclass($1) AS exists`,
        [`public.${table}`]
      );
      if (!exists.rows[0]?.exists) {
        logger.warn(`Backup: skipping non-existent table ${table}`);
        continue;
      }

      // Stream rows in batches to avoid memory blowup on huge tables
      let offset = 0;
      const allRows: Record<string, unknown>[] = [];
      while (true) {
        const batch = await pool.query(`SELECT * FROM ${table} LIMIT $1 OFFSET $2`, [STREAM_BATCH_SIZE, offset]);
        if (batch.rows.length === 0) break;
        for (const row of batch.rows) allRows.push(row);
        if (batch.rows.length < STREAM_BATCH_SIZE) break;
        offset += STREAM_BATCH_SIZE;
      }

      archive.append(JSON.stringify(allRows), { name: `data/${table}.json` });
      logger.info(`Backup: exported ${allRows.length} rows from ${table}`);
    }

    // 3. Add uploads directory if it exists
    if (fs.existsSync(UPLOAD_DIR)) {
      archive.directory(UPLOAD_DIR, 'uploads');
    }

    await archive.finalize();
    logger.info(`Backup export completed: ${filename}`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /backup/import — restores from an uploaded .crelay (ZIP) file
 * WIPES all existing data first. Requires admin password confirmation.
 */
export async function importBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
  let tempDir: string | null = null;
  try {
    const adminPassword = (req.body?.adminPassword || req.headers['x-admin-password']) as string;
    await verifyAdminPassword(adminPassword);

    const file = (req.file as Express.Multer.File | undefined);
    if (!file || !file.buffer) {
      throw new AppError('Backup file is required (multipart field "backup")', 400);
    }

    // Extract ZIP to temp dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crelay-restore-'));
    const tempZipPath = path.join(tempDir, 'backup.zip');
    fs.writeFileSync(tempZipPath, file.buffer);

    await fs.createReadStream(tempZipPath)
      .pipe(unzipper.Extract({ path: tempDir }))
      .promise();

    // Validate metadata
    const metaPath = path.join(tempDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new AppError('Invalid backup file: missing meta.json', 400);
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.app !== 'cadencerelay') {
      throw new AppError('Invalid backup file: not a CadenceRelay backup', 400);
    }
    if (typeof meta.version !== 'number' || meta.version > BACKUP_VERSION) {
      throw new AppError(`Backup version ${meta.version} is not supported (max ${BACKUP_VERSION})`, 400);
    }

    const restoredCounts: Record<string, number> = {};

    // Restore in a single transaction with FK checks deferred where possible
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Wipe in REVERSE order (children first, then parents)
      const reversed = [...BACKUP_TABLES].reverse();
      for (const table of reversed) {
        const exists = await client.query(`SELECT to_regclass($1) AS exists`, [`public.${table}`]);
        if (!exists.rows[0]?.exists) continue;
        await client.query(`DELETE FROM ${table}`);
      }

      // Restore in dependency order
      for (const table of BACKUP_TABLES) {
        const dataPath = path.join(tempDir, 'data', `${table}.json`);
        if (!fs.existsSync(dataPath)) continue;

        const exists = await client.query(`SELECT to_regclass($1) AS exists`, [`public.${table}`]);
        if (!exists.rows[0]?.exists) continue;

        let rows: Record<string, unknown>[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

        // Strip tracking_domain from a settings restore when the operator has
        // pinned TRACKING_DOMAIN via env. Restoring someone else's tracking host
        // into a live DB silently mis-targets every subsequent campaign send.
        if (table === 'settings' && process.env.TRACKING_DOMAIN) {
          const before = rows.length;
          rows = rows.filter((r) => r.key !== 'tracking_domain');
          if (rows.length !== before) {
            logger.warn('Backup restore: dropped tracking_domain row from settings to preserve env-pinned TRACKING_DOMAIN', {
              envTrackingDomain: process.env.TRACKING_DOMAIN,
            });
          }
        }

        if (rows.length === 0) {
          restoredCounts[table] = 0;
          continue;
        }

        // Get column names from the first row
        const columns = Object.keys(rows[0]);
        const colList = columns.map((c) => `"${c}"`).join(', ');

        // Introspect column types so we know which need JSON serialization.
        // jsonb/json: stringify every non-null value regardless of JS type
        //   (a JSON string like "on" would otherwise be sent as bare `on` and fail).
        const typeRes = await client.query<{ column_name: string; data_type: string }>(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1`,
          [table]
        );
        const jsonCols = new Set(
          typeRes.rows.filter((r) => r.data_type === 'jsonb' || r.data_type === 'json').map((r) => r.column_name)
        );

        // Insert in batches of 500
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const row of chunk) {
            const rowPlaceholders: string[] = [];
            for (const col of columns) {
              const v = row[col];
              if (v === undefined || v === null) {
                values.push(null);
              } else if (jsonCols.has(col)) {
                // Always JSON.stringify for jsonb/json columns — covers strings,
                // numbers, booleans, arrays, and objects uniformly.
                values.push(JSON.stringify(v));
              } else if (typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
                // Defensive: any other object/array on a non-json column gets stringified
                // (shouldn't happen for our schema, but better than a crash).
                values.push(JSON.stringify(v));
              } else {
                values.push(v);
              }
              rowPlaceholders.push(`$${idx++}`);
            }
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
          }
          await client.query(
            `INSERT INTO ${table} (${colList}) VALUES ${placeholders.join(', ')}`,
            values
          );
        }
        restoredCounts[table] = rows.length;
        logger.info(`Restore: imported ${rows.length} rows into ${table}`);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Restore uploads
    const uploadsBackupDir = path.join(tempDir, 'uploads');
    if (fs.existsSync(uploadsBackupDir)) {
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      // Wipe existing uploads
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        const fp = path.join(UPLOAD_DIR, f);
        try { fs.rmSync(fp, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      // Copy backup uploads
      copyRecursive(uploadsBackupDir, UPLOAD_DIR);
    }

    logger.info('Backup restore completed', { restoredCounts });
    res.json({ message: 'Backup restored successfully', restored: restoredCounts });
  } catch (err) {
    next(err);
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}
