# Lotus BRAIN Google Cloud infrastructure

This directory defines the production infrastructure foundation for Lotus BRAIN in
Google Cloud's `asia-northeast1` region. It is Terraform code only: C50 does not
create, change, or inspect any Google Cloud resource.

## Architecture and ownership

The account or organization owner creates the Google Cloud project and attaches its
billing account before Terraform is used. Human access (Owner, Editor, and
user-level IAM) remains outside Terraform and is managed by the owner or
organization policy.

Terraform manages only infrastructure resources. GitHub Actions authenticates with
short-lived Workload Identity Federation credentials; service-account JSON keys and
GCP private keys in GitHub secrets are deliberately unsupported.

## State strategy

`bootstrap/` initially uses local state to create the state bucket and GitHub WIF
foundation. Its state is then migrated to the bucket under the `bootstrap` prefix.
`environments/prod/` uses the same bucket under the `prod` prefix. A future staging
environment uses the `staging` prefix. Terraform workspaces are not used.

The state bucket has versioning, uniform bucket-level access, public-access
prevention, and deletion protection. Actual backend configuration is local-only and
is never committed.

## Secret strategy

C50 creates only Secret Manager containers for `DATABASE_URL`, `SMTP_USER`, and
`SMTP_PASSWORD`. It creates no secret versions, values, database credentials, or
password variables. Consequently Terraform state contains no application secret.
An operator adds secret values only after the later Cloud SQL design fixes the
private endpoint and database-user contract.

## C50 boundary

C50 creates the state/WIF foundation, API enablement, service-account identities,
networking, Private Services Access, Artifact Registry, and secret metadata.

C51 and later may add Cloud SQL, Cloud Run services, migration jobs, the worker,
NAT, load balancing, certificates, DNS, monitoring, backup, and runtime IAM after
their resource contracts are reviewed.

## Deliberate no-apply rule

This change permits only local static checks:

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap init -backend=false -input=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/environments/prod init -backend=false -input=false
terraform -chdir=infra/environments/prod validate
```

Do not run a real-project plan, apply, destroy, or `gcloud` resource-creation
command as part of C50.
