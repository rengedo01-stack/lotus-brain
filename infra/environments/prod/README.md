# Production foundation Terraform root

Initialize this root only after bootstrap state has been migrated to the protected
GCS bucket. Copy `backend.gcs.hcl.example` to the ignored `backend.gcs.hcl` and use
the same bucket with the `prod` prefix:

```sh
terraform init -backend-config=backend.gcs.hcl
```

## Cloud Run runtime foundation

C54 defines, but does not deploy, the production runtime resources in
`asia-northeast1`:

- a Web `google_cloud_run_v2_service`;
- an API `google_cloud_run_v2_service`; and
- a one-task `google_cloud_run_v2_job` for Prisma migrations.

The API and migration Job use Direct VPC egress through the existing app
subnet with `PRIVATE_RANGES_ONLY`. Web has no VPC attachment. All services use
`INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, so a future external Application Load
Balancer is the public entry point. C54 does not create that load balancer,
serverless NEGs, certificates, DNS, a worker, or Cloud NAT.

### Initial image and release ownership

The first real apply must happen only after the release owner has built and
pushed both production images and supplied immutable `@sha256:` digests:

```text
build/push Web and API-family images
→ obtain immutable digests
→ Terraform apply
```

Terraform owns the service/job configuration, identities, scaling, network,
secret references, and ingress. It ignores only each container image field
after creation; the release process owns later digest rollouts. Placeholder
images and mutable tags are not accepted.

### Runtime inputs and secret versions

The approved Web origin, WebAuthn RP name/ID, and non-secret SMTP settings are
required Terraform inputs. The same Web origin is used for `CORS_ORIGIN` and
`WEBAUTHN_ORIGIN`. The final Web image must be built with
`NEXT_PUBLIC_API_BASE_URL="https://brain.<domain>/api/v1"`; it is a build-time,
not Cloud Run runtime, setting.

`DATABASE_URL`, `SMTP_USER`, and `SMTP_PASSWORD` remain operator-managed
Secret Manager values. Terraform creates no secret values. Instead, it accepts
numeric, existing secret-version references for Cloud Run environment-variable
injection. Rotating a secret is:

```text
operator creates a new Secret Manager version
→ reviewed production tfvars version update
→ Terraform apply creates a revision using that pinned version
```

### Migration gate

Terraform defines the migration Job only; it never executes it. A release must
use this order:

```text
API-family image rollout to migration Job
→ execute migration Job
→ confirm success
→ API image rollout
→ Web image rollout
```

The Job uses one task, one parallel worker, zero automatic retries, a 900-second
timeout, the migration service account, Direct VPC, and
`pnpm exec prisma migrate deploy --config ./prisma.config.ts`. On failure, stop
the new API/Web rollout; do not run an automatic down migration.

### Apply blockers and boundaries

The production domain and SMTP provider do not block this code or its review.
They do block actual production API/Web deployment: no fake origins, SMTP
configuration, image digests, or secret versions may be used. Cloud Run default
URLs remain enabled for now; C56 will add the external load balancer, certificate
and external-DNS handoff. C55 will add the notification worker and Cloud NAT.

C54 performs no real GCP plan/apply, image push, secret version creation, or
deployment workflow configuration.

## C55 notification worker and Cloud NAT

C55 adds one Cloud Run Worker Pool for the existing notification outbox puller. It runs the existing immutable API-family image with
`node dist/notification.worker.js`, uses the existing dedicated worker service
account and numeric Secret Manager versions, and keeps exactly one manually
scaled instance. The worker has no HTTP endpoint, public URL, invoker binding,
VM, Scheduler, or VPC connector.

The worker uses Direct VPC egress on the existing worker subnet. Its egress is `ALL_TRAFFIC` because SMTP delivery needs Public NAT. A dedicated regional Cloud
Router and Public Cloud NAT gateway accept traffic from that worker subnet only;
the application subnet is not a NAT source. The gateway uses one Terraform-managed
Premium static external IP, making the SMTP allowlist value stable without
exposing an inbound endpoint. NAT error logging is enabled, while flow logging is
not collected by default.

The worker retains the repository's graceful SIGTERM handling. C55 does not add an HTTP or gRPC health probe because the existing pull worker has no probe
endpoint; adding one would require an application change. Cloud Run gives an
instance a finite SIGTERM grace period, so an operator must verify SMTP provider
delivery and shutdown behavior before any real deployment.

C55 performs no real GCP plan/apply, image push, secret version creation, SMTP configuration, or deployment workflow configuration.

`prod.auto.tfvars.example` is a committed shape-only example. Real production
tfvars are local and never contain application secret values.

## C50 resources

This root enables the approved APIs, creates dedicated runtime identities, a custom
VPC with application and worker subnets, Private Services Access range, a Tokyo
Docker Artifact Registry repository, and Secret Manager containers plus
least-privilege per-secret access bindings. The GitHub WIF release identity is
created by the bootstrap root and is granted only Artifact Registry upload access.

## C52 Cloud SQL foundation

C52 adds one `POSTGRES_17` Enterprise Cloud SQL instance named from the system and
environment (`lotus-brain-production-postgres`) and the `lotus_brain` application
database. It reuses the C50 custom VPC and its existing Private Services Access
range; it does not create a new VPC, subnet, or PSA range.

The instance is Regional HA in `asia-northeast1`, uses the fixed
`db-custom-2-7680` tier, has 20 GiB PD SSD storage that can grow up to 100 GiB,
and has no public IPv4 address or authorized networks. Cloud SQL selects the
primary and standby zones. The server accepts encrypted connections only
(`ENCRYPTED_ONLY`).

Automated backups retain 14 backups, while point-in-time recovery keeps seven days
of transaction logs. These are separate protections: PITR is not a replacement for
the daily automated backup. Backup location and the weekly maintenance window are
operator-owned decisions, so `cloud_sql_backup_location`,
`cloud_sql_maintenance_day`, and `cloud_sql_maintenance_hour` must be supplied in
the real production tfvars. The maintenance day and hour are UTC; the committed
example is only a shape, not a production decision.

The database is protected three ways: Terraform `deletion_protection`, Cloud SQL
API `deletion_protection_enabled`, and Terraform `prevent_destroy`. Backups are
retained on deletion, and a 14-day final backup is required. `lotus_brain` uses the
`ABANDON` deletion policy so removing its Terraform binding does not drop the
database. A destructive operation requires an explicit owner decision, confirmation
of backup and PITR health, confirmation of the final backup, a reviewed PR that
removes all three protections, and a separate reviewed apply.

Regional HA protects zonal and instance failures; it is not cross-region disaster
recovery. C52 intentionally adds no replica, cross-region DR, Query Insights,
database flags, CMEK, Cloud SQL IAM database authentication, or Cloud SQL Client
IAM role. Direct private TCP from the VPC does not need `roles/cloudsql.client`;
re-evaluate that role if a Cloud SQL Auth Proxy or connector is introduced.

### Database user and secret handoff

Terraform manages neither database users or passwords nor Secret Manager secret
versions. After a reviewed Cloud SQL apply, an operator must use an approved
private operator path (for example, an IAP-mediated temporary admin VM inside the
VPC or a Cloud SQL Auth Proxy). Permanent public SQL access is not permitted.

1. Confirm Cloud SQL is ready and record its private IP.
2. Create `lotus_brain_app` with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
   NOREPLICATION`, and make it the owner of `lotus_brain`.
3. Generate a strong password outside Terraform, URL-encode it, and form
   `postgresql://<user>:<encoded-password>@<private-ip>:5432/lotus_brain?schema=public&sslmode=require`.
4. Add that value as a version of the existing `lotus-brain-production-database-url`
   Secret Manager container only after the private connection and migration path are
   validated.

The initial runtime and migration identity is the same `lotus_brain_app` database
user; reassess separate migration credentials with the Cloud Run migration Job.
`sslmode=require` enforces transport encryption but does not complete CA or server
identity verification. Private DNS, CA distribution, and `verify-full` are deferred
to the Cloud Run connection design.

## Deferred to C53 and later

Cloud Run Web/API, migration Job, worker, Cloud NAT, load balancer, certificates,
DNS, monitoring, application deployment, and all real Cloud SQL operations remain
out of scope. No secret version or secret value is managed here.

No C52 command may run a real-project plan, apply, destroy, or resource-creation
command.
