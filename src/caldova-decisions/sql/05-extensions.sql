\set ON_ERROR_STOP on
-- Current preview worker is bound to postgres. Fail clearly on other databases.
DO $$
BEGIN
    IF current_database() <> current_setting('pg_durable.database') THEN
        RAISE EXCEPTION 'Connect to %, the pg_durable worker database',
            current_setting('pg_durable.database');
    END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_durable;
CREATE EXTENSION IF NOT EXISTS azure_ai;
