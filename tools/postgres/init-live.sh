#!/bin/sh
set -eu
# The server starts as the administrator; the application receives only its own role.
VOLARYN_DATABASE_PASSWORD=$(cat /run/secrets/database_password)
export VOLARYN_DATABASE_PASSWORD
psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv application_password VOLARYN_DATABASE_PASSWORD
CREATE ROLE volaryn LOGIN PASSWORD :'application_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE volaryn OWNER volaryn;
REVOKE ALL ON DATABASE volaryn FROM PUBLIC;
SQL
unset VOLARYN_DATABASE_PASSWORD
