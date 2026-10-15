-- Schema "app" is created by sql/bootstrap.sql (owned by app_migrator), so it is not created here.
CREATE TABLE "app"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text,
	"email_normalized" text,
	"phone_e164" text,
	"first_name" text,
	"last_name" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_status" text,
	"source" text,
	"consent" jsonb,
	"last_engaged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_email_or_phone" CHECK ("app"."contacts"."email_normalized" IS NOT NULL OR "app"."contacts"."phone_e164" IS NOT NULL),
	CONSTRAINT "contacts_display_status_check" CHECK ("app"."contacts"."display_status" IN ('subscribed', 'unsubscribed', 'bounced', 'complained', 'undeliverable')),
	CONSTRAINT "contacts_phone_e164_format" CHECK ("app"."contacts"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user_key" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("app"."memberships"."role" IN ('owner', 'admin', 'marketer', 'developer', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "app"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"data_region" text DEFAULT 'ap-south-1' NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"postal_address" jsonb,
	"gstin" text,
	"ses_tenant_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_status_check" CHECK ("app"."tenants"."status" IN ('pending_review', 'active', 'paused', 'suspended', 'closed')),
	CONSTRAINT "tenants_gstin_format" CHECK ("app"."tenants"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"email_verified_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized_unique" UNIQUE("email_normalized")
);
--> statement-breakpoint
ALTER TABLE "app"."contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_email_key" ON "app"."contacts" USING btree ("tenant_id","email_normalized") WHERE "app"."contacts"."deleted_at" IS NULL AND "app"."contacts"."email_normalized" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_phone_key" ON "app"."contacts" USING btree ("tenant_id","phone_e164") WHERE "app"."contacts"."deleted_at" IS NULL AND "app"."contacts"."phone_e164" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contacts_attributes_gin" ON "app"."contacts" USING gin ("attributes");