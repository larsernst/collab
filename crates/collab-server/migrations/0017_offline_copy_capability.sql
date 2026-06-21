-- Offline copies are privacy-sensitive because they persist server vault data
-- on client devices. Grant the capability only to built-in editor/admin
-- templates by default; viewers remain online/read-only unless explicitly
-- granted `vault.offlineCopy`.
UPDATE permission_templates
SET capabilities = capabilities || ARRAY['vault.offlineCopy']
WHERE is_builtin
  AND name IN ('editor', 'admin')
  AND NOT (capabilities @> ARRAY['vault.offlineCopy']);
