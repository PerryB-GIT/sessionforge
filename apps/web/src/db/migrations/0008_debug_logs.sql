CREATE TABLE IF NOT EXISTS "machine_debug_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL REFERENCES "machines"("id") ON DELETE CASCADE,
  "level" text NOT NULL,
  "component" text NOT NULL,
  "message" text NOT NULL,
  "metadata" jsonb,
  "agent_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "machine_debug_logs_machine_id_idx" ON "machine_debug_logs" ("machine_id");
CREATE INDEX IF NOT EXISTS "machine_debug_logs_created_at_idx" ON "machine_debug_logs" ("created_at");
