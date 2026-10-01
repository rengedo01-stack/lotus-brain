# Bootstrap Terraform root

This root breaks the state-bucket circular dependency deliberately. It initially
uses local state, creates the protected GCS state bucket and GitHub WIF foundation,
then migrates its own state to GCS.

## One-time owner procedure

1. The account or organization owner creates the Google Cloud project and attaches
   billing. Human IAM is handled outside this repository.
2. Copy the example values to a local, untracked `bootstrap.auto.tfvars`; use the
   numeric GitHub repository and owner IDs, not names.
3. Run `terraform init -backend=false`, review `terraform plan`, and run
   `terraform apply` only under the owner's approved production change procedure.
4. Confirm that the protected state bucket now exists, then make an encrypted backup
   of the local `terraform.tfstate` outside this repository.
5. Copy `backend.gcs.hcl.example` to the ignored `backend.gcs.hcl`, set the actual
   bucket name and the `bootstrap` prefix, then run:

   ```sh
   terraform init -migrate-state -backend-config=backend.gcs.hcl
   ```

6. Confirm `terraform state list` reads the remote backend. Retain the backup under
   the owner's recovery policy, then safely dispose of the local working copy.
7. Initialize `../environments/prod` with the same bucket and the `prod` prefix.

GitHub Environment approval is an independent GitHub-side gate. No service-account
key, user credential, or application secret is part of this bootstrap.

## Apply and release identities

Bootstrap creates two deliberately separate identities:

- `lotus-brain-release` is the only GitHub WIF-federated identity. It is limited
  to reviewed image push, image rollout, and migration Job execution.
- `lotus-brain-terraform` is the production infrastructure-apply identity. It
  has no GitHub WIF binding and no service-account key.

Before a real production apply, an owner approves the narrowly scoped resource
roles for `lotus-brain-terraform` outside this Terraform root. The identity must
not receive Owner, Editor, or a project-wide IAM-admin role, and Terraform must
not grant the identity its own project permissions. The preferred operation path
is an approved human identity impersonating `lotus-brain-terraform`; the human
receives only the service-account Token Creator permission on that account. Do
not put an impersonation key, credential path, or fixed service-account key in
the provider configuration.

## C50 local validation only

The C50 implementation itself runs only `terraform init -backend=false` and
`terraform validate`; it does not contact a Google Cloud project or create resources.
