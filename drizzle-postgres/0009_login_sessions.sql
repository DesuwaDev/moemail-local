CREATE TABLE login_session (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_version integer NOT NULL,
  provider text NOT NULL,
  user_agent text NOT NULL,
  first_ip text,
  last_ip text,
  login_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL,
  last_seen_at timestamp with time zone NOT NULL,
  last_active_at timestamp with time zone,
  active_seconds integer NOT NULL DEFAULT 0,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX login_session_user_seen_idx ON login_session(user_id, last_seen_at);
--> statement-breakpoint
CREATE INDEX login_session_expires_idx ON login_session(expires_at);
