-- Phase 01 infrastructure migration (no business tables).
--
-- citext gives case-insensitive text for email addresses, which the users
-- table needs in Phase 02 (docs/architecture/data-model.md section 2).
-- Enabling it here proves the migration pipeline end to end on a clean
-- database and keeps Phase 02's migration focused on its own tables.
CREATE EXTENSION IF NOT EXISTS citext;
