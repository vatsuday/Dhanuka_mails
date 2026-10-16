-- MFA (S2.1). mfa_factors is global (one row per user, no tenant), read and written only by the
-- identity module; the secret is envelope-encrypted by the application before it reaches the database.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.mfa_factors TO app_user;
-- Recovery codes are SHA-256 hashes: exactly 32 bytes each, at most 10.
ALTER TABLE app.mfa_factors ADD CONSTRAINT mfa_factors_recovery_codes_check
  CHECK (cardinality(recovery_codes_hashed) <= 10);
