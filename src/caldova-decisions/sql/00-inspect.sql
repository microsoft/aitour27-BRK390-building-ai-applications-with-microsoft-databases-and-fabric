\set ON_ERROR_STOP on
SELECT version();
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name IN ('azure_ai', 'pg_durable', 'vector', 'pg_diskann');
SHOW shared_preload_libraries;
SHOW azure.extensions;
SELECT n.nspname AS schema_name, p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('ai', 'model_registry')
ORDER BY 1, 2;
