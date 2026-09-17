CREATE TABLE "message_attachment" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL REFERENCES "message"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "content_id" text,
  "size" integer NOT NULL,
  "data" bytea NOT NULL
);
--> statement-breakpoint
CREATE INDEX "message_attachment_message_id_idx" ON "message_attachment" ("message_id");
--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "notification_mode" text NOT NULL DEFAULT 'full';
--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "max_content_bytes" integer NOT NULL DEFAULT 2048;
--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "last_delivery_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "last_delivery_error" text;
