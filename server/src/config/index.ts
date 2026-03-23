import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'test'
  ? '.env.test'
  : process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development';

dotenv.config({ path: path.resolve(__dirname, '../../../', envFile) });

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  database: {
    url: process.env.DATABASE_URL || 'postgresql://bulk_email_user:password@localhost:5432/bulk_email',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '20', 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
    accessExpiry: '15m',
    refreshExpiry: '7d',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin',
  },

  tracking: {
    domain: process.env.TRACKING_DOMAIN || 'http://localhost:3001',
  },
} as const;
