-- CadenceRelay Database Migration
-- This file is run directly via psql in production

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- admin_users
CREATE TABLE IF NOT EXISTS admin_users (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    username varchar(100) UNIQUE NOT NULL,
    password_hash varchar(255) NOT NULL,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- contacts
CREATE TABLE IF NOT EXISTS contacts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    email varchar(320) NOT NULL,
    name varchar(255),
    metadata jsonb DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'bounced', 'complained', 'unsubscribed')),
    bounce_count integer DEFAULT 0,
    send_count integer DEFAULT 0,
    last_sent_at timestamptz,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email);
CREATE INDEX IF NOT EXISTS contacts_status_idx ON contacts(status);
CREATE INDEX IF NOT EXISTS contacts_send_count_idx ON contacts(send_count);

-- contact_lists
CREATE TABLE IF NOT EXISTS contact_lists (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(255) NOT NULL,
    description text,
    contact_count integer DEFAULT 0,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- contact_list_members
CREATE TABLE IF NOT EXISTS contact_list_members (
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    list_id uuid NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
    added_at timestamptz DEFAULT NOW(),
    PRIMARY KEY (contact_id, list_id)
);
CREATE INDEX IF NOT EXISTS clm_list_id_idx ON contact_list_members(list_id);

-- templates
CREATE TABLE IF NOT EXISTS templates (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(255) NOT NULL,
    subject varchar(998) NOT NULL,
    html_body text NOT NULL,
    text_body text,
    variables jsonb DEFAULT '[]'::jsonb,
    version integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- template_versions
CREATE TABLE IF NOT EXISTS template_versions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version integer NOT NULL,
    subject varchar(998) NOT NULL,
    html_body text NOT NULL,
    text_body text,
    variables jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT NOW()
);

-- campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(255) NOT NULL,
    template_id uuid REFERENCES templates(id),
    list_id uuid REFERENCES contact_lists(id),
    status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','paused','completed','failed')),
    provider varchar(10) NOT NULL DEFAULT 'ses' CHECK (provider IN ('gmail', 'ses')),
    scheduled_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    throttle_per_second integer DEFAULT 5,
    throttle_per_hour integer DEFAULT 5000,
    total_recipients integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    bounce_count integer DEFAULT 0,
    open_count integer DEFAULT 0,
    click_count integer DEFAULT 0,
    complaint_count integer DEFAULT 0,
    unsubscribe_count integer DEFAULT 0,
    attachments jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);

-- campaign_recipients
CREATE TABLE IF NOT EXISTS campaign_recipients (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id uuid REFERENCES contacts(id),
    email varchar(320) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','delivered','bounced','failed','opened','clicked','complained','unsubscribed')),
    provider_message_id varchar(255),
    sent_at timestamptz,
    delivered_at timestamptz,
    opened_at timestamptz,
    clicked_at timestamptz,
    bounced_at timestamptz,
    error_message text,
    tracking_token varchar(64) UNIQUE,
    link_urls jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cr_campaign_id_idx ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS cr_contact_id_idx ON campaign_recipients(contact_id);
CREATE INDEX IF NOT EXISTS cr_status_idx ON campaign_recipients(status);
CREATE INDEX IF NOT EXISTS cr_tracking_token_idx ON campaign_recipients(tracking_token);
CREATE INDEX IF NOT EXISTS cr_provider_msg_idx ON campaign_recipients(provider_message_id);

-- email_events
CREATE TABLE IF NOT EXISTS email_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_recipient_id uuid REFERENCES campaign_recipients(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
    event_type varchar(20) NOT NULL CHECK (event_type IN ('queued','sent','delivered','bounced','opened','clicked','complained','unsubscribed','failed')),
    metadata jsonb DEFAULT '{}'::jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ee_campaign_id_idx ON email_events(campaign_id);
CREATE INDEX IF NOT EXISTS ee_cr_id_idx ON email_events(campaign_recipient_id);
CREATE INDEX IF NOT EXISTS ee_type_idx ON email_events(event_type);
CREATE INDEX IF NOT EXISTS ee_created_idx ON email_events(created_at);

-- settings
CREATE TABLE IF NOT EXISTS settings (
    key varchar(100) PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz DEFAULT NOW()
);
INSERT INTO settings (key, value) VALUES
    ('email_provider', '"ses"'),
    ('gmail_config', '{"host":"smtp.gmail.com","port":587,"user":"","pass":""}'),
    ('ses_config', '{"region":"ap-south-1","accessKeyId":"","secretAccessKey":"","fromEmail":""}'),
    ('throttle_defaults', '{"perSecond":5,"perHour":5000}'),
    ('tracking_domain', '"http://yeb.mail.intellimix.online"')
ON CONFLICT (key) DO NOTHING;

-- School-specific columns on contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state varchar(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS district varchar(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS block varchar(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS classes varchar(50);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS category varchar(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS management varchar(100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address text;

-- Widen classes column to handle longer values
DO $$ BEGIN
  ALTER TABLE contacts ALTER COLUMN classes TYPE varchar(255);
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS contacts_state_idx ON contacts(state);
CREATE INDEX IF NOT EXISTS contacts_district_idx ON contacts(district);
CREATE INDEX IF NOT EXISTS contacts_category_idx ON contacts(category);
CREATE INDEX IF NOT EXISTS contacts_management_idx ON contacts(management);

-- Smart list columns on contact_lists
ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS is_smart boolean DEFAULT false;
ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS filter_criteria jsonb;

-- unsubscribes
CREATE TABLE IF NOT EXISTS unsubscribes (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    email varchar(320) NOT NULL,
    campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
    reason text,
    created_at timestamptz DEFAULT NOW()
);
-- Fix: unique per email+campaign, not just email (allow same email to unsub from multiple campaigns)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'unsub_email_idx') THEN
    DROP INDEX unsub_email_idx;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS unsub_email_campaign_idx ON unsubscribes(email, campaign_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS cr_campaign_status_idx ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS contacts_created_idx ON contacts(created_at);

-- Custom variable definitions
CREATE TABLE IF NOT EXISTS custom_variables (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name varchar(100) NOT NULL,
    key varchar(100) UNIQUE NOT NULL,
    type varchar(20) DEFAULT 'text',
    options jsonb DEFAULT '[]'::jsonb,
    required boolean DEFAULT false,
    default_value varchar(255),
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT NOW()
);
