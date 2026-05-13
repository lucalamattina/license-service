# Drops and recreates the dev database, then re-applies migrations.
# Usage: powershell -File scripts\db-reset.ps1
$ErrorActionPreference = 'Stop'

docker exec license-service-postgres psql -U license_service -d postgres -c "DROP DATABASE IF EXISTS license_service;"
docker exec license-service-postgres psql -U license_service -d postgres -c "CREATE DATABASE license_service;"
npm run db:migrate
