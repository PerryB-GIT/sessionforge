ALTER TABLE sessions ADD COLUMN IF NOT EXISTS adoptable boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS adopted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS adopted_at timestamp with time zone;
