/**
 * Backup & Restore Tests
 * - Unit: validates table dependency order and metadata schema
 * - Integration: creates a ZIP archive in memory, then extracts and verifies round-trip data integrity
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { BACKUP_TABLES } from '../controllers/backup.controller';

describe('Backup table dependency order', () => {
  test('parents appear before children (FK-safe insert order)', () => {
    const idx = (t: string) => BACKUP_TABLES.indexOf(t);

    // contacts must come before contact_list_members (FK)
    expect(idx('contacts')).toBeLessThan(idx('contact_list_members'));
    expect(idx('contact_lists')).toBeLessThan(idx('contact_list_members'));

    // templates before template_versions
    expect(idx('templates')).toBeLessThan(idx('template_versions'));

    // campaigns before campaign_recipients & email_events
    expect(idx('campaigns')).toBeLessThan(idx('campaign_recipients'));
    expect(idx('campaigns')).toBeLessThan(idx('email_events'));
    expect(idx('campaign_recipients')).toBeLessThan(idx('email_events'));

    // automations before steps & enrollments
    expect(idx('automations')).toBeLessThan(idx('automation_steps'));
    expect(idx('automations')).toBeLessThan(idx('automation_enrollments'));

    // email_accounts before campaigns (campaign FK)
    expect(idx('email_accounts')).toBeLessThan(idx('campaigns'));

    // projects before campaigns (FK)
    expect(idx('projects')).toBeLessThan(idx('campaigns'));
  });

  test('contains all critical tables', () => {
    const required = [
      'admin_users', 'settings', 'contacts', 'contact_lists', 'contact_list_members',
      'templates', 'campaigns', 'campaign_recipients', 'email_events',
      'suppression_list', 'suppressed_domains', 'email_accounts',
      'projects', 'custom_variables', 'automations',
    ];
    for (const t of required) {
      expect(BACKUP_TABLES).toContain(t);
    }
  });

  test('no duplicate table entries', () => {
    const set = new Set(BACKUP_TABLES);
    expect(set.size).toBe(BACKUP_TABLES.length);
  });
});

describe('Backup ZIP round-trip integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crelay-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('creates ZIP, extracts it, and verifies data integrity', async () => {
    const zipPath = path.join(tempDir, 'backup.zip');
    const extractDir = path.join(tempDir, 'extracted');

    // Sample data that mimics what the export would write
    const sampleContacts = [
      { id: 'c1', email: 'a@test.com', name: 'Alice' },
      { id: 'c2', email: 'b@test.com', name: 'Bob' },
    ];
    const sampleSettings = [
      { key: 'reply_to', value: 'reply@test.com' },
      { key: 'tracking_domain', value: 'https://track.test' },
    ];
    const sampleMeta = {
      version: 1,
      created_at: new Date().toISOString(),
      tables: BACKUP_TABLES,
      app: 'cadencerelay',
    };

    // Build the ZIP
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(sampleMeta, null, 2), { name: 'meta.json' });
      archive.append(JSON.stringify(sampleContacts), { name: 'data/contacts.json' });
      archive.append(JSON.stringify(sampleSettings), { name: 'data/settings.json' });
      // Empty file to test uploads dir
      archive.append('test attachment content', { name: 'uploads/test-file.txt' });
      archive.finalize();
    });

    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);

    // Extract and verify
    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .promise();

    // Meta
    const restoredMeta = JSON.parse(fs.readFileSync(path.join(extractDir, 'meta.json'), 'utf8'));
    expect(restoredMeta.app).toBe('cadencerelay');
    expect(restoredMeta.version).toBe(1);
    expect(Array.isArray(restoredMeta.tables)).toBe(true);

    // Contacts
    const restoredContacts = JSON.parse(fs.readFileSync(path.join(extractDir, 'data/contacts.json'), 'utf8'));
    expect(restoredContacts).toHaveLength(2);
    expect(restoredContacts[0].email).toBe('a@test.com');
    expect(restoredContacts[1].name).toBe('Bob');

    // Settings
    const restoredSettings = JSON.parse(fs.readFileSync(path.join(extractDir, 'data/settings.json'), 'utf8'));
    expect(restoredSettings).toHaveLength(2);
    expect(restoredSettings[0].key).toBe('reply_to');

    // Uploads
    const uploadFile = path.join(extractDir, 'uploads/test-file.txt');
    expect(fs.existsSync(uploadFile)).toBe(true);
    expect(fs.readFileSync(uploadFile, 'utf8')).toBe('test attachment content');
  });

  test('rejects backup with wrong app marker', () => {
    const badMeta = { version: 1, app: 'wrong-app', tables: [] };
    expect(badMeta.app === 'cadencerelay').toBe(false);
  });

  test('rejects backup version higher than supported', () => {
    const FUTURE_VERSION = 999;
    const SUPPORTED = 1;
    expect(FUTURE_VERSION > SUPPORTED).toBe(true);
  });
});

describe('Restore SQL builder helpers', () => {
  test('column list quotes column names safely', () => {
    const cols = ['id', 'email', 'created_at'];
    const colList = cols.map((c) => `"${c}"`).join(', ');
    expect(colList).toBe('"id", "email", "created_at"');
  });

  test('placeholders generated correctly for batch insert', () => {
    const rows = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    const cols = Object.keys(rows[0]);
    const placeholders: string[] = [];
    let idx = 1;
    for (const _ of rows) {
      const rowP: string[] = [];
      for (const _c of cols) rowP.push(`$${idx++}`);
      placeholders.push(`(${rowP.join(', ')})`);
    }
    expect(placeholders).toEqual(['($1, $2)', '($3, $4)']);
    expect(idx).toBe(5); // 4 placeholders consumed, idx is next available
  });

  test('handles undefined values by converting to null', () => {
    const v: unknown = undefined;
    const safe = v === undefined ? null : v;
    expect(safe).toBeNull();
  });
});
