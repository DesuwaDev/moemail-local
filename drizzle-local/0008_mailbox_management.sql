ALTER TABLE email ADD COLUMN disabled_at integer;
--> statement-breakpoint
ALTER TABLE email ADD COLUMN receive_enabled integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE email ADD COLUMN send_enabled integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE email ADD COLUMN share_enabled integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE admin_audit_log (id text PRIMARY KEY NOT NULL, actor_id text NOT NULL, user_id text, mailbox_id text, action text NOT NULL, target text NOT NULL, created_at integer NOT NULL);
--> statement-breakpoint
CREATE INDEX admin_audit_user_time_idx ON admin_audit_log (user_id, created_at);
