CREATE TABLE "app"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role_check" CHECK ("app"."invitations"."role" IN ('admin', 'marketer', 'developer', 'viewer')),
	CONSTRAINT "invitations_token_hash_length" CHECK (octet_length("app"."invitations"."token_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_tenant_email_pending_key" ON "app"."invitations" USING btree ("tenant_id","email_normalized") WHERE "app"."invitations"."accepted_at" IS NULL AND "app"."invitations"."revoked_at" IS NULL;