CREATE TABLE "app"."mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text DEFAULT 'totp' NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"recovery_codes_hashed" "bytea"[] DEFAULT '{}'::bytea[] NOT NULL,
	"last_used_step" bigint,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_factors_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "mfa_factors_type_check" CHECK ("app"."mfa_factors"."type" = 'totp')
);
--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "require_mfa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;