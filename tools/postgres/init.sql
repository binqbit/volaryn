-- Disposable local credentials. Hosted deployments provision their own role and DATABASE_URL.
SELECT 'CREATE ROLE volaryn LOGIN PASSWORD ''volaryn-local'' NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'volaryn')
\gexec
SELECT 'CREATE DATABASE volaryn OWNER volaryn'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'volaryn')
\gexec
REVOKE ALL ON DATABASE volaryn FROM PUBLIC;
