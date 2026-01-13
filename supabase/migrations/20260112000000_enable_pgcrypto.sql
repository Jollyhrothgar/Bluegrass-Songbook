-- Enable pgcrypto extension for gen_random_bytes function
-- Used by list invite token generation

CREATE EXTENSION IF NOT EXISTS pgcrypto;
