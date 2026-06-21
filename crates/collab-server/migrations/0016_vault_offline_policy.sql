ALTER TABLE hosted_vaults
  ADD COLUMN require_offline_copy BOOLEAN NOT NULL DEFAULT FALSE;
