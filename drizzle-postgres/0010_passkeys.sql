ALTER TABLE login_session ADD COLUMN verified_at timestamp with time zone;
--> statement-breakpoint
CREATE TABLE passkey (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text,
  device_type text NOT NULL,
  backed_up boolean NOT NULL DEFAULT false,
  aaguid text,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  last_used_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX passkey_user_idx ON passkey(user_id, created_at);
--> statement-breakpoint
CREATE TABLE passkey_challenge (
  id text PRIMARY KEY NOT NULL,
  purpose text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  session_id text,
  challenge text NOT NULL,
  expires_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX passkey_challenge_expires_idx ON passkey_challenge(expires_at);
