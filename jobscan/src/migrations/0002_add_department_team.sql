-- Add department and team columns to jobs table
ALTER TABLE jobs ADD COLUMN department TEXT;
ALTER TABLE jobs ADD COLUMN team TEXT;
