/*
# Create admin_config table for admin password storage

## Overview
Stores the admin password in the database so the edge function can verify
admin login without relying on environment variables that can't be set
from this environment.

## Changes
1. New table `admin_config` with a single row containing the admin password.
2. RLS enabled — no policies, so only the service role can read/write.
*/

CREATE TABLE IF NOT EXISTS admin_config (
  id integer PRIMARY KEY DEFAULT 1,
  admin_password text NOT NULL DEFAULT 'admin123',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

-- Insert default password if not exists
INSERT INTO admin_config (id, admin_password)
VALUES (1, 'admin123')
ON CONFLICT (id) DO NOTHING;