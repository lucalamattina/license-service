locals {
  app_namespace = "license-service"

  # In-cluster service DNS + credentials. These match the Helm release names
  # below (pg-postgresql, redis-master), so the Secret the app consumes is
  # derived from the same source of truth that provisions the datastores.
  database_url = "postgres://${var.db_user}:${var.db_password}@pg-postgresql.${local.app_namespace}.svc.cluster.local:5432/${var.db_name}"
  redis_url    = "redis://redis-master.${local.app_namespace}.svc.cluster.local:6379"
}

# ---- namespaces ------------------------------------------------------------
resource "kubernetes_namespace" "app" {
  metadata { name = local.app_namespace }
}

resource "kubernetes_namespace" "argocd" {
  metadata { name = "argocd" }
}

resource "kubernetes_namespace" "monitoring" {
  metadata { name = "monitoring" }
}

# ---- datastores (in-cluster, for the learning exercise) --------------------
# In production these would be managed services (RDS / Valkey); the cluster
# would run only the app. Pinned chart versions keep the platform reproducible.
resource "helm_release" "postgresql" {
  name = "pg"
  # Bitnami charts are pulled from their OCI registry. Their classic HTTP index
  # (charts.bitnami.com/bitnami) now points artifacts at OCI in a way the helm
  # provider's downloader rejects ("invalid_reference: invalid tag"); the OCI
  # registry resolves cleanly.
  repository = "oci://registry-1.docker.io/bitnamicharts"
  chart      = "postgresql"
  version    = "18.7.8"
  namespace  = kubernetes_namespace.app.metadata[0].name

  set {
    name  = "auth.username"
    value = var.db_user
  }
  set {
    name  = "auth.password"
    value = var.db_password
  }
  set {
    name  = "auth.database"
    value = var.db_name
  }
}

resource "helm_release" "redis" {
  name       = "redis"
  repository = "oci://registry-1.docker.io/bitnamicharts" # see postgresql note above
  chart      = "redis"
  version    = "27.0.12"
  namespace  = kubernetes_namespace.app.metadata[0].name

  set {
    name  = "architecture"
    value = "standalone"
  }
  set {
    name  = "auth.enabled"
    value = "false"
  }
}

# ---- app Secret ------------------------------------------------------------
# The DATABASE_URL / REDIS_URL the Deployments consume via envFrom. Codified
# here (was created imperatively with `kubectl create secret`); in production
# this would come from an external secrets operator rather than Terraform state.
resource "kubernetes_secret" "app" {
  metadata {
    name      = "license-service-secrets"
    namespace = kubernetes_namespace.app.metadata[0].name
  }
  type = "Opaque"
  data = {
    DATABASE_URL = local.database_url
    REDIS_URL    = local.redis_url
  }
}

# ---- observability stack ---------------------------------------------------
resource "helm_release" "monitoring" {
  name       = "monitoring"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "87.3.0"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  timeout    = 600
  # Nothing in this config depends on the stack being fully ready, and the app's
  # ServiceMonitors/dashboard are applied by ArgoCD (which retries), so don't
  # block apply on every monitoring pod becoming ready.
  wait = false
}
