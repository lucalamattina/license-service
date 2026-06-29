# terraform — license-service platform (IaC)

Provisions the in-cluster platform the app runs on, with OpenTofu/Terraform
instead of the raw `kubectl`/`helm` commands used while bootstrapping by hand:

- namespaces: `license-service`, `argocd`, `monitoring`
- datastores: PostgreSQL + Redis (Bitnami charts, in-cluster — RDS/Valkey in prod)
- the app `Secret` (`DATABASE_URL` / `REDIS_URL`)
- observability: `kube-prometheus-stack` (Prometheus + Grafana)
- GitOps: ArgoCD (`argo-cd` chart) + the root `Application` (`argocd-apps` chart)
  that syncs `k8s/` from this repo and self-heals

Once `tofu apply` finishes, ArgoCD takes over: it syncs `k8s/`, runs the PreSync
migration hook, and rolls the web/worker Deployments from the GHCR image pinned
by CI. The platform is IaC; the app is GitOps.

## Prerequisite: a cluster

The kind cluster is treated as a prerequisite (like the cloud account itself).
In a real setup an EKS/GKE module would sit alongside these files and the
providers would point at it.

```
kind create cluster --name licsvc
```

## Use

```
tofu init
tofu plan
tofu apply
```

Chart versions are pinned for reproducibility. Variables (repo URL, git
revision, DB credentials) are in `variables.tf`.

> The DB credentials live in `variables.tf` / state for this exercise. In
> production they'd come from an external secrets operator, not Terraform state.
