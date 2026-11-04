# MATMS deployment on Coolify

Public address: **https://matms.shintakino.qzz.io**. Initial deployment verification is recorded in the [progress tracker](../context/progress-tracker.md). School acceptance of official forms remains separate from deployment.

## Service and credentials

Coolify project **MATMS**, environment **production**, service **MATMS** (`mt8rqzgbtpkbzedwicy03wnf`) manages the web, API, database, migration, backup and Cloudflare tunnel containers. Use the existing Coolify dashboard on this Ubuntu host. The initial manual provisioning token was revoked. The automatic deployment implementation uses a separate scoped token and requires Coolify's API to remain enabled; its restricted gateway does not expose the dashboard or unrelated API resources.

The initial permanent administrator is `admin@shintakino.qzz.io`. The generated password is in the host's ignored, mode-0600 `.deploy-private/admin.txt`; it is not a temporary password. Use a password manager to retain it. Create individual accounts through **Administration → Users**; do not share the administrator account with staff. No email delivery has been configured, so the login address does not imply a working mailbox.

`.deploy-private/production.json` contains the database credentials, authentication secret and backup encryption key. Restrict it to the operator and escrow these values in a password manager or independent secure storage. Losing both the database volume and this key makes the encrypted backups unusable. These files, tunnel credentials and the source reference workbooks are excluded from Docker build contexts and Git.

## Routing and startup

Cloudflare DNS routes only `matms.shintakino.qzz.io` to the dedicated `matms-shintakino` tunnel (`1f0eb5cf-585b-47dd-a758-1ff491dc789b`). HTTPS terminates at Cloudflare, and the encrypted outbound tunnel reaches the private web container on port 3001. Next.js forwards `/api/auth/*`, `/rpc/*`, controlled imports and official downloads to the private API on port 3000. PostgreSQL has no published host port. Other host applications and the development MATMS database use separate services and volumes.

The production web configuration redirects the canonical hostname's forwarded HTTP requests to HTTPS with status 308, preserving the path/query. It uses Cloudflare's forwarded protocol and leaves private health requests unaffected. The canonical hostname for this redirect is frozen during the web build: changing domains requires rebuilding with the new `MATMS_CANONICAL_ORIGIN`, updating the service environment/DNS and preserving the QR origin redirect/reprint plan.

The final deployment passed public redirect/login checks and 20 authenticated module routes after a Coolify redeployment. The administrator account and bootstrap audit persisted; migrations exited successfully and all long-running health checks passed. See `deploy/public-verification.json` for the final browser results.

Start/restart the **MATMS service in Coolify**. No development server command is needed for the deployed application. On host reboot Docker's restart policies resume the running services. PostgreSQL must become healthy; the migration job must exit successfully; then the API and web readiness checks must pass before the tunnel starts.

Container names use `<component>-mt8rqzgbtpkbzedwicy03wnf`. For example:

```bash
docker ps --filter label=com.docker.compose.project=mt8rqzgbtpkbzedwicy03wnf
docker logs --tail 50 migrate-mt8rqzgbtpkbzedwicy03wnf
docker logs --tail 50 server-mt8rqzgbtpkbzedwicy03wnf
docker logs --tail 50 tunnel-mt8rqzgbtpkbzedwicy03wnf
```

The migration container normally exits with code zero. Never use `down --volumes`, delete production volumes, run the development seed or use `db:push:dev` in this deployment. Inspect environment values only through authorized secret access; avoid dumping container environments into logs or support tickets.

## Releases

The initial manual release used local images `matms-web:20261104-e9263d0c-https`, `matms-server:20261104-e9263d0c` and `matms-postgres:20261104-e9263d0c`. They remain available for compatible rollback. Automated releases use `ghcr.io/shintakino/matms-{web,server,postgres}` with immutable `sha256` digests, linked to one full Git revision. The workflow retains an image manifest and production verification receipt in its Actions artifacts. See the progress tracker for the latest verified activation/run; the original release manifest records the initial deployment.

With automation enabled, use the push-to-deploy instructions below. The following local-build commands remain a manual fallback. A Coolify restart uses its configured image references; it does not rebuild source. Keep previous release images available for rollback. Moving to another host requires those images, secrets and a verified backup.

For a future release, finish the applicable checks, take a backup, choose a new unique tag, and build the three images on the target host. The two build environment files contain build-only values and are mounted as BuildKit secrets; production database passwords and authentication secrets must never be build arguments. Keep `SERVER_URL=http://server:3000` during the web build because Next.js freezes its rewrite destinations.

```bash
docker build -f apps/server/Dockerfile --secret id=web_env,src=.deploy-private/build-web.env --secret id=server_env,src=.deploy-private/build-server.env -t matms-server:NEW_RELEASE .
docker build -f apps/web/Dockerfile --secret id=web_env,src=.deploy-private/build-web.env --secret id=server_env,src=.deploy-private/build-server.env --build-arg SERVER_URL=http://server:3000 -t matms-web:NEW_RELEASE .
docker build -f deploy/postgres.Dockerfile -t matms-postgres:NEW_RELEASE .
```

Update the relevant image references in Coolify, including `migrate` for the server image and `predeploy-backup`/`backup` for the PostgreSQL image. Save and deploy while retaining environment values and volumes. The automated template takes an encrypted one-shot backup before reviewed Drizzle migrations; the API waits for successful migration completion. Check backup/migration exit status, long-running health checks, public login, protected routes and one applicable authorized workflow. The runtime database account cannot perform migrations.

For rollback, first check that the previous application image supports the current database schema and writes. If it does, select the previous image tags and redeploy. Do not run automatic down migrations or restore over production to reverse an application-only change. A database recovery needs a maintenance window and an explicit decision about writes after the chosen backup.

## Applying changes and availability

The workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) implements checked automatic releases. When repository variable `MATMS_DEPLOY_ENABLED` is `true`, pushing to GitHub `main` runs isolated checks, builds three images on GitHub-hosted runners, then deploys through Coolify. Pull requests run checks without production secrets or deployment. Failed checks/builds leave production unchanged. A newer `main` commit supersedes an older queued candidate; deployment itself is never canceled halfway through a migration/restart. A normal release preserves the existing database, administrator, authentication secret and volumes.

1. Develop and test the change, review any migration for compatibility, then commit and push to `main`. From this workspace's local `master` branch, the explicit command is `git push git@github.com:shintakino/MATMS.git HEAD:main`.
2. Watch **GitHub → MATMS → Actions → Verify and deploy MATMS**. The check job runs all strict types, PostgreSQL integration tests and seeded fictional Chromium workflows. Private workbook comparisons are explicitly skipped in CI because school source files are not published.
3. Only successful checks may publish the immutable image set. Only successful builds may enter the main-only `production` environment and use its Coolify token. CI sends no production database/authentication/cloudflared credentials to image builders.
4. The deploy job verifies current storage, supplies a short-lived package-read token, updates only the MATMS Service, pulls all candidate images before container replacement, and waits for matching web/API Git revisions and healthy services. The pre-migration backup must succeed before migrations/API startup. Health/revision probes and storage checks must pass twice before the release is recorded as verified.
5. Check the `production-deployment` artifact for the revision/image digests and receipt. If deployment fails, inspect Coolify logs. Select a compatible prior image set for application rollback; never automatically restore or downgrade the production database.

## Automatic deployment configuration

Activation and actual Actions-run evidence are recorded in the progress tracker. The required repository variables are `MATMS_DEPLOY_ENABLED`, `MATMS_ORIGIN`, `COOLIFY_URL`, `COOLIFY_SERVICE_UUID` and `COOLIFY_SERVER_UUID`. `MATMS_ORIGIN` is shared with the image build so canonical redirects/QR configuration agree with deployment. The `production` environment permits branch `main` and holds secret `COOLIFY_TOKEN`. The workflow's built-in short-lived `GITHUB_TOKEN` publishes images and supplies registry authentication; no permanent GitHub registry credential is stored in the repository.

The dedicated gateway service `MATMS Deployment Gateway` (`bckcz3zbvmtxuv1ghvrvypn2`) uses tunnel `0b473a5f-7ef3-41b2-a9a6-b6c9265da346` at `https://matms-deploy.shintakino.qzz.io`. Its [ingress configuration](../deploy/automation/cloudflared.yml) permits only the fixed MATMS Service's base/status, restart and storage routes, plus this server's registry-login route. Other paths return 404; permitted paths still require Coolify authentication. The token has `read`, `write`, `deploy` abilities for the existing Coolify team, without `root` or sensitive-read abilities. As with deployment source access, protect this credential as privileged; the ingress boundary is what excludes unrelated resource URLs externally.

Host-only recovery metadata and the token expiry date are in ignored mode-0600 `.deploy-private/automation.json`; tunnel credentials are in `.deploy-private/automation-tunnel.json`. Rotate the automation token before its recorded one-year expiry and update the GitHub environment secret. Infrastructure/bootstrap changes to the gateway are operator-managed independently of app releases. Restore its existing service/image/configuration rather than publishing the full Coolify dashboard.

Pause deployment without stopping CI by setting repository variable `MATMS_DEPLOY_ENABLED` to `false`; re-enable it only after required configuration is verified. **Run workflow** on branch `main` checks/builds/deploys the current revision again. Cached digest images permit ordinary local restarts after the job token expires. A manual forced registry pull needs fresh registry authentication; prefer rerunning the workflow. Keep Docker cleanup from removing all known-good rollback images.

## Availability during updates

Building images keeps the existing site running, subject to the host having enough resources. The current full Service deployment recreates containers, including the tunnel and database, so it has a brief service interruption during replacement/readiness. It is **not a zero-downtime deployment**. Coolify's application-level rolling updates do not apply to this Compose Service; health checks alone do not remove that interruption. See the [official rolling-update limits](https://coolify.io/docs/applications/deployments/rolling-updates).

To support updates without interrupting user requests, the next deployment change should use two application versions behind a persistent reverse proxy:

1. Keep PostgreSQL, backups, the tunnel and the reverse proxy running independently of application releases. Keep the same public hostname and database volume.
2. Build and start a second, matching web/API pair on a private network while the current pair still serves requests. Its web rewrite must target its own API. Use the same authentication secret and persistent database, and verify sign-in and authorized workflows through the candidate pair.
3. Run only reviewed, backward-compatible migrations while both versions may access the database. Add new columns/tables first, move application usage in a later release, and remove old schema only after the older version has drained. Destructive or locking migrations can still need a maintenance window.
4. Switch the persistent proxy to the healthy candidate pair, let requests to the previous pair finish, and retain that pair briefly for a routing rollback. Verify page/assets, sessions, writes, import/export operations and background cleanup across the transition; overlapping instances need coordinated limits/background work.
5. Rehearse the switch under continuous requests and representative signed-in traffic before claiming uninterrupted updates. This design is documented here as the next step; it is **not implemented or verified** in the currently deployed Service.

This avoids routine application replacement outages when implemented and tested. A reboot, database upgrade or failure of this single Ubuntu host still interrupts the application; host-level availability requires another server and a separate database failover plan.

## Encrypted backups

The backup service performs a PostgreSQL custom-format dump daily, encrypts it with AES-256/PBKDF2 using `MATMS_BACKUP_KEY`, records a SHA-256 checksum, and keeps 30 days in its separate backup volume. It retries failures every five minutes. Its health check fails when no recent encrypted dump exists. A separate volume protects against accidental database-volume loss; **both volumes are on the same host**. Off-host delivery and external alert notifications are not configured. Copy encrypted backups and checksums to an independently secured destination and retain the key separately before relying on host-loss recovery.

Force and inspect a backup:

```bash
docker exec backup-mt8rqzgbtpkbzedwicy03wnf /usr/local/bin/matms-backup.sh once
docker exec backup-mt8rqzgbtpkbzedwicy03wnf ls -lh /backups
```

Use `docker cp` to copy the selected `.dump.enc` and `.sha256` out of the backup container into a restricted directory. Verify the checksum in that directory. Supply the escrowed key through a restricted environment file, not a command argument. Decryption uses:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:MATMS_BACKUP_KEY -in SELECTED.dump.enc -out restored.dump
```

Treat `restored.dump` as confidential plaintext; keep it only in restricted temporary storage and remove it after the restore. The dump includes account hashes, immutable audit/ledger/history, count/profile/report snapshots, and database-held import/export artifacts. Raw staged uploads and report bytes retain their application expiry policies; restoring a dump does not renew them.

## Recovery rehearsal

The first rehearsal on 2026-11-04 restored the encrypted post-bootstrap backup in **35.52 seconds**. All **40 public tables** matched their pre-backup fingerprints, and an isolated API authenticated the restored permanent Administrator with secure cookie settings. Temporary recovery containers were removed. The [restore result](../deploy/restore-verification.json), [public browser checks](../deploy/public-verification.json) and [image/service manifest](../deploy/release-manifest.json) retain the evidence without secrets.

Restore into a new isolated PostgreSQL database/container, never the live database. Use the same PostgreSQL major version, preserve the original backup, and restore with `pg_restore --exit-on-error --no-owner --no-acl`. Recreate the non-owner application role and apply the grants in `deploy/migrate.sh` to the restored database. Run a private API container against it using the matching release image and original authentication secret; keep all its ports unpublished.

Verify administrator sign-in and role, schema/migration state, exact table contents against the selected snapshot, record lookup, both inventory balances against their chronological ledgers, and custody/audit history. Reproduce a historical official report when such a report exists. Record duration and results. Remove only the explicitly created rehearsal containers/database once verified. Repeat quarterly and after material storage or migration changes. A rehearsal of the initially clean database cannot prove recovery of populated school inventory or historical forms; repeat it after approved pilot records exist.

For an actual incident, stop writes, preserve the failed database volume, restore into a new volume, verify it privately, and switch the service only after selecting the acceptable recovery point. Preserve the Cloudflare origin and authentication secret so existing printed labels remain valid. Recheck administrator access and restricted-record authorization before reopening.
