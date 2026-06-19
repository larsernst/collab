# Upgrade and Failed-Migration Recovery

Collab server migrations are forward-only. Do not rely on down migrations for
production recovery. A rollback means restoring the verified backup created
immediately before the upgrade.

## Before upgrading

1. Make sure the current deployment is healthy:

   ```bash
   docker compose ps
   curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/health/ready
   ```

2. Run the upgrade preflight:

   ```bash
   pnpm server:upgrade:preflight
   ```

   This creates a full PostgreSQL + blob backup, verifies its checksums, captures
   the current `_sqlx_migrations` table, and writes a report under
   `server-data/upgrade-preflight/`.

3. Copy the reported backup name somewhere outside the deployment host if the
   upgrade involves host maintenance.

## Upgrade

1. Pull or build the new image.
2. Start the stack:

   ```bash
   docker compose up -d --build
   ```

3. Watch startup:

   ```bash
   docker compose logs -f collab-server
   ```

4. Confirm readiness:

   ```bash
   curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/health/ready
   ```

5. Sign in to `/admin/` and check the dashboard warnings, recent audit events,
   hosted vault inventory, and backups page.

## If migration or startup fails

If the new container exits with a migration error, do not keep restarting it in
a loop. Restore the pre-upgrade backup named by the preflight report:

```bash
COLLAB_RESTORE_CONFIRM=restore pnpm server:restore collab-backup-YYYYMMDDTHHMMSSZ
```

The restore helper stops app services, verifies checksums, restores PostgreSQL,
replaces blob storage, keeps a blob safety archive, and restarts services unless
`COLLAB_RESTORE_NO_RESTART=1` is set.

After restore:

```bash
docker compose ps
curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/health/ready
```

Then inspect `/admin/` before attempting another upgrade.

## If the server starts but behaves incorrectly

Treat this as a failed upgrade if hosted vault reads/writes, login, admin access,
or live collaboration are broken:

1. Stop traffic at the reverse proxy if the server is public.
2. Keep the failed container logs:

   ```bash
   docker compose logs collab-server > server-data/upgrade-preflight/failed-upgrade.log
   ```

3. Restore the pre-upgrade backup with `pnpm server:restore`.
4. Open an issue or keep the failed logs and preflight report with the backup
   name, old version, new version, and migration error.

## Compatibility notes

- Never downgrade onto a database that has already accepted newer migrations.
- Never edit `_sqlx_migrations` manually.
- Always restore PostgreSQL and blob storage together.
- Keep at least one verified off-host backup before changing server images,
  migration files, PostgreSQL major versions, retention policies, or blob
  storage layout.
