import bcrypt from 'bcryptjs';
import { pool } from '../../config/database';
import { config } from '../../config';
import { logger } from '../../utils/logger';

async function seedAdmin(): Promise<void> {
  const { username, password } = config.admin;

  const existing = await pool.query('SELECT id FROM admin_users WHERE username = $1', [username]);
  if (existing.rows.length > 0) {
    logger.info('Admin user already exists, skipping seed');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
    [username, passwordHash]
  );

  logger.info(`Admin user '${username}' seeded successfully`);
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Failed to seed admin user', { error: err.message });
    process.exit(1);
  });
