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

## C57 external HTTPS load balancer and DNS handoff

C57 defines, but does not deploy, one Global External Application Load Balancer
for the existing Web and API Cloud Run services. It reserves one protected
Premium IPv4 address, creates separate `asia-northeast1` serverless NEGs and
global backend services for Web and API, and routes the production hostname as
follows:

| Request path | Backend |
| --- | --- |
| `/`, `/login`, `/inventory` | Web |
| `/api/v1`, `/api/v1/health`, `/api/v1/...` | API |

The load balancer preserves the `/api/v1` prefix; it performs no path rewrite.
The HTTP frontend only returns a permanent HTTPS redirect, preserving host, path,
and query. It never forwards HTTP traffic to an application backend.

The hostname is derived from the existing `production_web_base_url` input. For
example, `https://brain.example.com` derives `brain.example.com`; no second
hostname variable or placeholder domain is introduced. Web/API retain
`INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, `invoker_iam_disabled = true`, and
their existing application authentication. C57 neither adds an `allUsers`
binding nor uses the Preview default-`run.app` URL disable setting.

### TLS and external DNS handoff

Certificate Manager uses a global Google-managed certificate for exactly the
derived production hostname, with `PER_PROJECT_RECORD` DNS authorization and a
certificate map hostname entry. Terraform does not manage the external DNS
provider and never creates an A, AAAA, CNAME, or Cloud DNS resource.

After a reviewed real apply, the DNS owner uses these non-secret outputs:

- `certificate_dns_authorization_cname_name`
- `certificate_dns_authorization_cname_type`
- `certificate_dns_authorization_cname_target`
- `load_balancer_ipv4`

The required cutover sequence is:

```text
Terraform apply
→ read the authorization CNAME outputs
→ create the exact CNAME with the external DNS provider
→ verify public DNS propagation
→ verify the Certificate Manager certificate is ACTIVE
→ pre-cutover test against the LB IP with the production Host/SNI
→ point the production hostname A record at load_balancer_ipv4
→ run HTTPS, API, login, and WebAuthn smoke checks
```

Do not create the production A record before the certificate is `ACTIVE`. The
authorization CNAME must remain in DNS for certificate renewal, and must be the
only record at its exact owner name: conflicting CNAME or TXT records can prevent
issuance or renewal. C57 does not create IPv6; the DNS owner must check for an
existing AAAA record before cutover and remove or update it under the approved
DNS change procedure. The DNS owner may reduce TTL before cutover, but Terraform
does not prescribe or manage TTL.

Before changing the A record, test the active certificate and routing without
changing public production DNS:

```sh
curl --resolve brain.example.com:443:LB_IPV4 https://brain.example.com/
curl --resolve brain.example.com:443:LB_IPV4 https://brain.example.com/api/v1/health
curl --resolve brain.example.com:80:LB_IPV4 -I 'http://brain.example.com/login?next=%2Finventory'
```

Replace the example hostname and `LB_IPV4` with approved operator values. Verify
that the last command redirects to the same host, path, and query over HTTPS.

For an initial go-live there is no previous A-record destination to restore.
If cutover must stop, first roll back the reviewed load-balancer configuration or
the Cloud Run revision, then remove or change the new A record only under the
approved DNS procedure. For a future migration with an existing endpoint,
restoring the previous A record is the DNS rollback.

### Security and apply boundaries

Serverless NEG backends intentionally have no Compute health check or
health-check firewall rule. C57 also omits Cloud CDN, Cloud Armor, custom SSL
policy, explicit HTTP/3/QUIC policy, and expanded load-balancer request logging;
those operational controls belong to C58.

No runtime or release service account receives load-balancer, NEG, or Certificate
Manager permissions. A real Terraform apply needs an owner-approved infrastructure
apply identity with narrowly scoped Compute Load Balancing/NEG and Certificate
Manager permissions. Do not use Owner or Editor, and do not add a human identity
to Terraform. The existing image rollout identity remains separate from this
prerequisite.

The global load-balancer IPv4 has Terraform `prevent_destroy` because production
DNS will reference it. Certificate and map resources do not receive blanket
deletion protection, so normal certificate maintenance remains possible.

C57 performs no GCP plan/apply/destroy, certificate issuance, DNS registration,
secret operation, image rollout, or deployment workflow change. The only new
required API is `certificatemanager.googleapis.com`, retained with
`disable_on_destroy = false`.

## C59 monitoring and edge-security foundation

C59 defines production monitoring and Cloud Armor configuration only. It does
not create notification channels, run a real GCP plan/apply, change DNS or
certificate state, or alter application code, Cloud Run ingress, runtime IAM,
or release IAM.

### Notification ownership and alert activation

`monitoring_notification_channel_ids` is a required list of pre-existing,
operator-owned Cloud Monitoring channel resource IDs. Keep recipient email
addresses, chat webhooks, and on-call ownership outside this repository.
Terraform creates no `google_monitoring_notification_channel` resource.

`enable_external_uptime_monitoring` defaults to `false`. It gates creation of
both public uptime checks and their alert policies, preventing false incidents
before external DNS and TLS are live. Turn it on only in a reviewed production
tfvars change after this sequence:

```text
infrastructure apply
→ DNS authorization CNAME and Certificate Manager certificate ACTIVE
→ production A-record cutover
→ HTTPS, API, and WebAuthn smoke checks
→ set enable_external_uptime_monitoring=true
→ reviewed Terraform apply
→ verify Web/API checks and operator-owned notification delivery
```

The Web check is `GET /` over HTTPS. The separate API check is
`GET /api/v1/health` over HTTPS and validates the JSON value
`$.status == "ok"`. It is an API liveness signal, not a database dependency
check. Both run every five minutes and use the normal multi-location uptime
condition, so a single transient checker failure does not page an operator.

### Initial alert runbook

| Alert | Severity | Signal | First response |
| --- | --- | --- | --- |
| Web uptime | P1 / CRITICAL | Two public checkers cannot reach `/` | Check HTTPS, certificate, LB logs, then Web revision. |
| API uptime | P1 / CRITICAL | Two public checkers cannot validate `/api/v1/health` | Check endpoint, LB logs, then API revision. |
| Worker unavailable | P1 / CRITICAL | Worker Pool instances `< 1` for 5m | Check worker revision, startup logs, image, and secret references. |
| Cloud SQL disk | P1 / CRITICAL | Utilization `> 80%` for 10m | Inspect growth and storage headroom; preserve backup/PITR safety. |
| Cloud SQL memory | P2 / WARNING | Utilization `> 90%` for 6h | Review connections, query activity, and capacity. |
| Cloud SQL OOM | P1 / CRITICAL | PostgreSQL OOM-killer log | Assess availability and preserve log evidence before remediation. |
| Cloud SQL backup | P1 / CRITICAL | Automated backup failed, attempt-failed, or skipped | Confirm last successful backup and PITR, then inspect the system event. |
| Worker NAT allocation | P1 / CRITICAL | NAT allocation failure | Inspect NAT capacity and worker egress configuration. |
| Worker NAT drops | P2 / WARNING | Capacity or endpoint-independence packet drops | Inspect NAT error logs and SMTP delivery behavior. |
| Certificate expired | P1 / CRITICAL | Certificate Manager `EXPIRED` log | Inspect renewal and keep the authorization CNAME intact. |
| Certificate close to expiry | P2 / WARNING | Certificate Manager `CLOSE_TO_EXPIRY` log | Verify certificate status and exact public CNAME authorization. |

Certificate Manager emits these expiry logs at the project monitored resource.
This root currently creates one production certificate; tighten the filters if a
future change adds more certificates to the project.

Metric alerts use `EVALUATION_MISSING_DATA_NO_OP`: Web can scale to zero and
low-traffic metrics must not create synthetic incidents. Log-match policies
use notification rate limits and explicit auto-close intervals to avoid repeat
pages for one event. The migration Job remains a release-time synchronous gate,
not an always-on alert.

Cloud SQL CPU and connection counts, Cloud Run CPU/memory and instance
saturation, load-balancer request volume/5xx/backend latency/total latency are
visible in their built-in dashboards. They intentionally have no initial alert
threshold until real production traffic establishes a baseline. SLOs, burn-rate
alerts, tracing, custom dashboards, Worker backlog metrics, and billing budgets
are also deferred.

### Cloud Armor and load-balancer logging

One common Cloud Armor policy is attached to the Web and API backend services.
It keeps the default allow rule enforced, but the following rules are strictly
preview-only:

- CRS 4.22 stable SQL injection and XSS detection at sensitivity 1;
- a 60 requests per 60 seconds, per-client-IP throttle for only these POST
  routes: `/api/v1/auth/login`, `/api/v1/auth/login/passkey/verify`, and
  `/api/v1/auth/password/recovery/request`.

The rate limit is evaluated per associated backend. These paths route only to
the API backend. No WAF or rate-limit denial is enforced in C59, no `allUsers`
binding is added, and `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` is unchanged.

Web and API backend request logging is enabled at a 100% sample rate while
preview rules are tuned. No optional request-header logging, request-body
logging, or Cloud Armor verbose logging is configured. Existing application
redaction remains unchanged. After a reviewed false-positive and traffic
baseline review, reduce the request-log sample rate (for example to 10%) and
move any selected preview rule to enforcement in a separate PR.

### Operational boundaries and prerequisites

Use Cloud Run, External Application Load Balancer, Cloud SQL, and Monitoring
built-in dashboards during an incident. Also consult Personalized Service
Health and the Google Cloud Service Health dashboard to distinguish provider
incidents from application faults; C59 adds no Service Health resource. Error
Reporting remains an investigation aid through existing Cloud Run logs.

Monitoring and logging, public uptime checks, 100% initial load-balancer
logging, and Cloud Armor preview evaluation can incur costs. C59 does not
hard-code prices or add a billing budget.

A real Terraform apply requires an owner-approved infrastructure apply identity
with least-privilege permissions to manage Monitoring alert policies and uptime
checks, Logging log-based alert notification rules, and Compute security
policies. Compute Security Admin-equivalent permissions are required for Cloud
Armor. Do not use Owner or Editor, hard-code a human identity, or grant these
permissions to runtime or release identities.

Post-apply tests are operator-owned: verify channel delivery and both uptime
checks after activation, and review preview WAF/rate-limit findings without
intentionally breaking a production resource. Do not simulate an alert by
damaging Cloud SQL, Cloud NAT, Cloud Run, DNS, or the certificate.

### Deferred Worker Functional Observability

The existing Worker Pool has no meaningful HTTP/gRPC probe endpoint and emits
no structured pending-count, oldest-pending-age, or retry-exhaustion metric.
C59 intentionally adds no dummy probe or broad SMTP string-match alert. A later
`Worker Functional Observability` change should add a reviewed application-level
signal before automated backlog alerts are considered.

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

## C61 staged production apply

This staged sequence supersedes the earlier C54 initial-apply chronology in this
document. It is the only approved first-production-apply path.

The production root has four explicit stages. `deployment_stage` has no default:
the operator must set it in the local, untracked production tfvars file. Advance
only in this order:

```text
foundation → migration → runtime → edge
```

This order is monotonic. Never lower the stage after an apply. If a lower-stage
plan shows any destroy action, STOP; do not use `terraform destroy` as rollback
and do not use `-target` for the normal go-live path. `prevent_destroy` remains
the protection for resources whose removal would be destructive.

| Stage | Required inputs | Resources enabled | STOP gate before advancing |
| --- | --- | --- | --- |
| `foundation` | project/network/Cloud SQL backup and maintenance inputs | APIs, VPC/subnets/PSA, Artifact Registry, runtime SAs, Secret containers/IAM, Cloud SQL | State is remote and protected; Cloud SQL is READY; repository, Secret containers, and runtime SAs exist. |
| `migration` | Foundation inputs plus real API-family digest and existing numeric `DATABASE_URL` version | Foundation plus migration Job and its release IAM | DB ownership, private connectivity, and the application role's migration permissions are proven. |
| `runtime` | Migration inputs plus real Web digest, SMTP settings/versions, approved origin/WebAuthn values, and real notification channel IDs | Migration plus Web/API, Worker Pool, worker NAT, runtime monitoring | Migration execution succeeded; internal API/login/WebAuthn/worker/SMTP smoke passes. |
| `edge` | Runtime inputs | Runtime plus ALB, NEGs, certificate, Cloud Armor preview policy, LB logging, edge monitoring | Runtime smoke is recorded. DNS A/AAAA records remain untouched until the certificate is ACTIVE. |

External uptime monitoring is a separate edge-only gate. Keep
`enable_external_uptime_monitoring=false` for the initial edge apply; set it to
`true` only in a reviewed later edge apply after DNS cutover and public smoke
checks succeed.

The formal go-live order is:

```text
bootstrap → foundation → DB/secret/image preparation → migration
→ migration execution → runtime → internal smoke → edge → certificate CNAME
→ certificate ACTIVE → pre-cutover smoke → DNS A cutover → public smoke
→ uptime monitoring activation
```

Each real phase uses `terraform plan -out`, human review, then the exact saved
plan. Do not change code or inputs between the reviewed plan and apply. Record
only non-secret evidence: Git SHA, stage, reviewed plan identity, apply timestamp,
image digests, migration execution result, certificate state, LB IP, DNS timestamp,
and smoke result.

### Inputs and real values

Fake image digests, fake secret versions, placeholder notification channels, and
fake domains are prohibited. The root allows nullable later-stage inputs only so
that foundation and migration do not require invented runtime values. A real
production tfvars file is local and untracked; it contains no secret payload.

After foundation succeeds, the release owner builds linux/amd64 Web and API-family
images from the reviewed main commit, pushes them with `lotus-brain-release`, reads
their immutable digests, and records the Git SHA-to-digest mapping. The Web build
uses the approved `NEXT_PUBLIC_API_BASE_URL` before its digest is produced.

Secret containers are foundation resources. An approved operator adds secret
versions after the database and SMTP credentials are real. Terraform receives only
their numeric versions. The secret-version operator should receive a per-secret
`roles/secretmanager.secretVersionAdder`-equivalent grant, not project-wide Secret
Manager Admin. Terraform never receives a secret payload.

### Apply identity and IAM ownership

`lotus-brain-release` remains the GitHub WIF identity for Artifact Registry image
push, Cloud Run image rollout, and migration Job execution. It never performs
Terraform infrastructure applies. `lotus-brain-terraform` is a separate,
non-federated apply identity. An owner-approved human impersonates it; no
service-account key is created or configured in Terraform.

The owner grants the apply identity externally, after reviewing the exact resource
graph. Do not use Owner, Editor, or broad Project IAM Admin. The minimum role
families to scope to concrete resources are:

| Resource family | Required capability boundary |
| --- | --- |
| State bucket | GCS state object read/write/lock-equivalent access only for the state bucket |
| Service Usage | Enable the approved APIs only |
| Compute | VPC, subnet, PSA, NAT, reserved IP, serverless NEG, ALB, backend, forwarding, and Cloud Armor resources |
| Service Networking | Private Services Access connection only |
| Artifact Registry | Repository metadata and the release-writer binding; release pushes remain separate |
| Secret Manager | Secret metadata and per-secret runtime accessor bindings, never secret payload access |
| Cloud SQL | Instance/database lifecycle only; application users/passwords remain operator-managed |
| Cloud Run | Service/Job/Worker Pool configuration and resource-specific release bindings |
| Runtime SAs | Create runtime SAs and grant only the specific `actAs`/resource IAM bindings needed by Cloud Run |
| Certificate Manager | DNS authorization, certificate, map, and map-entry management |
| Monitoring/Logging | Alert policies, uptime checks, and log-policy configuration |

Some Terraform-managed resource IAM bindings require resource-level
`setIamPolicy`. They are distinct from project-level role assignment. The apply
identity must never be able to grant or expand its own project-level privileges.

### DB and secret bootstrap runbook

Use no public SQL address. The preferred temporary admin path is an ephemeral VM
with no external IP, in the production VPC, reachable only through IAP. If using
Cloud SQL Auth Proxy, bind it only to localhost, use its private-IP path, and give
the temporary VM identity only the short-lived Cloud SQL Client permission it
needs. After bootstrap, remove the VM, disk, temporary firewall rule, and temporary
IAM grants; do not retain an admin host.

From that private path, use the Cloud SQL administrative `postgres` account only
for bootstrap. Do not put its password in a SQL file, shell history, repository,
tfvars, PR, or CI log. Create the application role and ownership exactly as follows;
enter the generated application password through an interactive password prompt:

```sql
CREATE ROLE lotus_brain_app
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

ALTER DATABASE lotus_brain OWNER TO lotus_brain_app;
REVOKE ALL ON DATABASE lotus_brain FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE lotus_brain TO lotus_brain_app;

-- after connecting to lotus_brain
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO lotus_brain_app;
GRANT USAGE, CREATE ON SCHEMA public TO lotus_brain_app;
```

Generate a strong password outside Terraform, URL-encode it, and create the real
`DATABASE_URL` value with the Cloud SQL private IP and `sslmode=require`. Add it as
a new version of the existing Secret Manager container and set only its numeric
version in the migration/runtime input. The initial migration and runtime use this
same app role; automatic down migrations are prohibited.

### Phase STOP and rollback rules

| Phase | STOP condition | Safe response |
| --- | --- | --- |
| Bootstrap | State migration, bucket protection, or identity boundary is unverified | Do not initialize prod; retain the encrypted local-state recovery copy. |
| Foundation | Reviewed plan has unexpected IAM/public exposure, or an apply is partial | Stop and correct the staged configuration; do not destroy state, secrets, or Cloud SQL. |
| DB/secret/image prep | Private admin path, role ownership, secret version, image digest, or SMTP input is not real | Do not create the migration Job. Disable/rotate a newly created unused secret version if necessary. |
| Migration | Job fails or migration state is not exact | Do not activate runtime. Investigate; never run automatic down migration. |
| Runtime | Internal smoke fails | Do not create edge/DNS. Roll back only to a previously proven compatible revision. |
| Edge/certificate | DNS authorization fails or certificate is not ACTIVE | Leave the A record unchanged and repair only the authorization/configuration. |
| DNS/public smoke | HTTPS, API, login, or WebAuthn smoke fails | Stop traffic at the runtime/LB layer; restore an earlier A record only when one exists. For first launch, remove the new A record through the approved DNS procedure. |

C61 adds no GitHub Terraform auto-apply workflow and performs no real GCP plan,
apply, IAM operation, image push, Secret Manager version creation, database-user
creation, certificate operation, or DNS change.
