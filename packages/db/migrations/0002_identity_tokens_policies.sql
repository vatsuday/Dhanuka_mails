CREATE TABLE "app"."tenant_sending_policies" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'sandbox' NOT NULL,
	"send_mode" text DEFAULT 'sandbox' NOT NULL,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"hourly_limit" integer DEFAULT 20 NOT NULL,
	"max_rate_per_sec" integer DEFAULT 1 NOT NULL,
	"max_contacts" integer DEFAULT 1000 NOT NULL,
	"warmup_day" integer,
	"pause_reason" text,
	"paused_at" timestamp with time zone,
	"reviewed_by_operator_id" uuid,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_sending_policies_tier_check" CHECK ("app"."tenant_sending_policies"."tier" IN ('sandbox', 'new', 'standard', 'trusted')),
	CONSTRAINT "tenant_sending_policies_mode_check" CHECK ("app"."tenant_sending_policies"."send_mode" IN ('sandbox', 'live')),
	CONSTRAINT "tenant_sending_policies_limits_check" CHECK ("app"."tenant_sending_policies"."daily_limit" >= 0 AND "app"."tenant_sending_policies"."hourly_limit" >= 0 AND "app"."tenant_sending_policies"."max_rate_per_sec" >= 0 AND "app"."tenant_sending_policies"."max_contacts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "user_tokens_purpose_check" CHECK ("app"."user_tokens"."purpose" IN ('verify_email', 'reset_password', 'change_email')),
	CONSTRAINT "user_tokens_hash_length" CHECK (octet_length("app"."user_tokens"."token_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "app"."tenant_sending_policies" ADD CONSTRAINT "tenant_sending_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_tokens_user_purpose_idx" ON "app"."user_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "app"."memberships" USING btree ("user_id");