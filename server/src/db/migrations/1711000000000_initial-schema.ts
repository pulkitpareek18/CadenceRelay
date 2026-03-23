import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Extensions
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // ============================================================
  // admin_users
  // ============================================================
  pgm.createTable('admin_users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    username: { type: 'varchar(100)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });

  // ============================================================
  // contacts
  // ============================================================
  pgm.createTable('contacts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    email: { type: 'varchar(320)', notNull: true },
    name: { type: 'varchar(255)' },
    metadata: { type: 'jsonb', default: "'{}'" },
    status: {
      type: 'varchar(20)',
      default: "'active'",
      notNull: true,
      check: "status IN ('active', 'bounced', 'complained', 'unsubscribed')",
    },
    bounce_count: { type: 'integer', default: 0 },
    send_count: { type: 'integer', default: 0 },
    last_sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('contacts', 'email', { unique: true });
  pgm.createIndex('contacts', 'status');
  pgm.createIndex('contacts', 'send_count');

  // ============================================================
  // contact_lists
  // ============================================================
  pgm.createTable('contact_lists', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    name: { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    contact_count: { type: 'integer', default: 0 },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('contact_lists', 'name');

  // ============================================================
  // contact_list_members (M:N join)
  // ============================================================
  pgm.createTable('contact_list_members', {
    contact_id: {
      type: 'uuid',
      notNull: true,
      references: 'contacts',
      onDelete: 'CASCADE',
    },
    list_id: {
      type: 'uuid',
      notNull: true,
      references: 'contact_lists',
      onDelete: 'CASCADE',
    },
    added_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.addConstraint('contact_list_members', 'contact_list_members_pkey', {
    primaryKey: ['contact_id', 'list_id'],
  });
  pgm.createIndex('contact_list_members', 'list_id');

  // ============================================================
  // templates
  // ============================================================
  pgm.createTable('templates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    name: { type: 'varchar(255)', notNull: true },
    subject: { type: 'varchar(998)', notNull: true },
    html_body: { type: 'text', notNull: true },
    text_body: { type: 'text' },
    variables: { type: 'jsonb', default: "'[]'" },
    version: { type: 'integer', default: 1 },
    is_active: { type: 'boolean', default: true },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });

  // ============================================================
  // template_versions
  // ============================================================
  pgm.createTable('template_versions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    template_id: { type: 'uuid', notNull: true, references: 'templates', onDelete: 'CASCADE' },
    version: { type: 'integer', notNull: true },
    subject: { type: 'varchar(998)', notNull: true },
    html_body: { type: 'text', notNull: true },
    text_body: { type: 'text' },
    variables: { type: 'jsonb', default: "'[]'" },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('template_versions', 'template_id');

  // ============================================================
  // campaigns
  // ============================================================
  pgm.createTable('campaigns', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    name: { type: 'varchar(255)', notNull: true },
    template_id: { type: 'uuid', references: 'templates' },
    list_id: { type: 'uuid', references: 'contact_lists' },
    status: {
      type: 'varchar(20)',
      default: "'draft'",
      notNull: true,
      check: "status IN ('draft','scheduled','sending','paused','completed','failed')",
    },
    provider: {
      type: 'varchar(10)',
      default: "'ses'",
      notNull: true,
      check: "provider IN ('gmail', 'ses')",
    },
    scheduled_at: { type: 'timestamptz' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    throttle_per_second: { type: 'integer', default: 5 },
    throttle_per_hour: { type: 'integer', default: 5000 },
    total_recipients: { type: 'integer', default: 0 },
    sent_count: { type: 'integer', default: 0 },
    failed_count: { type: 'integer', default: 0 },
    bounce_count: { type: 'integer', default: 0 },
    open_count: { type: 'integer', default: 0 },
    click_count: { type: 'integer', default: 0 },
    complaint_count: { type: 'integer', default: 0 },
    unsubscribe_count: { type: 'integer', default: 0 },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('campaigns', 'status');
  pgm.createIndex('campaigns', 'scheduled_at', {
    where: "status = 'scheduled'",
  });

  // ============================================================
  // campaign_recipients
  // ============================================================
  pgm.createTable('campaign_recipients', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    campaign_id: { type: 'uuid', notNull: true, references: 'campaigns', onDelete: 'CASCADE' },
    contact_id: { type: 'uuid', references: 'contacts' },
    email: { type: 'varchar(320)', notNull: true },
    status: {
      type: 'varchar(20)',
      default: "'pending'",
      notNull: true,
      check: "status IN ('pending','queued','sent','delivered','bounced','failed','opened','clicked','complained','unsubscribed')",
    },
    provider_message_id: { type: 'varchar(255)' },
    sent_at: { type: 'timestamptz' },
    delivered_at: { type: 'timestamptz' },
    opened_at: { type: 'timestamptz' },
    clicked_at: { type: 'timestamptz' },
    bounced_at: { type: 'timestamptz' },
    error_message: { type: 'text' },
    tracking_token: { type: 'varchar(64)', unique: true },
    link_urls: { type: 'jsonb', default: "'[]'" },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('campaign_recipients', 'campaign_id');
  pgm.createIndex('campaign_recipients', 'contact_id');
  pgm.createIndex('campaign_recipients', 'status');
  pgm.createIndex('campaign_recipients', 'tracking_token');
  pgm.createIndex('campaign_recipients', 'provider_message_id');

  // ============================================================
  // email_events
  // ============================================================
  pgm.createTable('email_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    campaign_recipient_id: { type: 'uuid', references: 'campaign_recipients' },
    campaign_id: { type: 'uuid', references: 'campaigns' },
    event_type: {
      type: 'varchar(20)',
      notNull: true,
      check: "event_type IN ('queued','sent','delivered','bounced','opened','clicked','complained','unsubscribed','failed')",
    },
    metadata: { type: 'jsonb', default: "'{}'" },
    ip_address: { type: 'inet' },
    user_agent: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('email_events', 'campaign_id');
  pgm.createIndex('email_events', 'campaign_recipient_id');
  pgm.createIndex('email_events', 'event_type');
  pgm.createIndex('email_events', 'created_at');

  // ============================================================
  // settings
  // ============================================================
  pgm.createTable('settings', {
    key: { type: 'varchar(100)', primaryKey: true },
    value: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });

  // Seed default settings
  pgm.sql(`
    INSERT INTO settings (key, value) VALUES
      ('email_provider', '"ses"'),
      ('gmail_config', '{"host":"smtp.gmail.com","port":587,"user":"","pass":""}'),
      ('ses_config', '{"region":"ap-south-1","accessKeyId":"","secretAccessKey":"","fromEmail":""}'),
      ('throttle_defaults', '{"perSecond":5,"perHour":5000}'),
      ('tracking_domain', '"http://localhost:3001"')
  `);

  // ============================================================
  // unsubscribes
  // ============================================================
  pgm.createTable('unsubscribes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    email: { type: 'varchar(320)', notNull: true },
    campaign_id: { type: 'uuid', references: 'campaigns' },
    reason: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
  });
  pgm.createIndex('unsubscribes', 'email', { unique: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('unsubscribes', { cascade: true });
  pgm.dropTable('settings', { cascade: true });
  pgm.dropTable('email_events', { cascade: true });
  pgm.dropTable('campaign_recipients', { cascade: true });
  pgm.dropTable('campaigns', { cascade: true });
  pgm.dropTable('template_versions', { cascade: true });
  pgm.dropTable('templates', { cascade: true });
  pgm.dropTable('contact_list_members', { cascade: true });
  pgm.dropTable('contact_lists', { cascade: true });
  pgm.dropTable('contacts', { cascade: true });
  pgm.dropTable('admin_users', { cascade: true });
}
