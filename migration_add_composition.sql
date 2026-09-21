-- Adds the 'composition' column (used for Spunlace PES/VIS ratio, e.g. "30/70")
-- Safe to run even if the column already exists.
alter table products add column if not exists composition text;
