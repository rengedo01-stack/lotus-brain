# Production foundation Terraform root

Initialize this root only after bootstrap state has been migrated to the protected
GCS bucket. Copy `backend.gcs.hcl.example` to the ignored `backend.gcs.hcl` and use
the same bucket with the `prod` prefix:

```sh
terraform init -backend-config=backend.gcs.hcl
```

`prod.auto.tfvars.example` is a committed shape-only example. Real production
tfvars are local and never contain application secret values.

## C50 resources

This root enables the approved APIs, creates dedicated runtime identities, a custom
VPC with application and worker subnets, Private Services Access range, a Tokyo
Docker Artifact Registry repository, and Secret Manager containers plus
least-privilege per-secret access bindings. The GitHub WIF release identity is
created by the bootstrap root and is granted only Artifact Registry upload access.

## Deferred to C51 and later

Cloud SQL, Cloud Run Web/API, migration Job, worker, Cloud NAT, load balancer,
certificates, DNS, monitoring, backups, and application deployment are explicitly
out of scope. No secret version or secret value is managed here.

No C50 command may run a real-project plan, apply, or destroy.
