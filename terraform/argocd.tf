# ArgoCD itself, via the official chart (replaces the raw `kubectl apply` of the
# install manifests used while bootstrapping by hand).
resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "10.0.0"
  namespace  = kubernetes_namespace.argocd.metadata[0].name
  timeout    = 600
}

# The root Application, via the argocd-apps chart. Creating it through Helm
# (rather than a kubernetes_manifest) sidesteps the plan-time CRD problem: the
# Application CRD is installed by the argo-cd release this depends on.
#
# It depends on the datastores too, so ArgoCD doesn't start syncing the app
# (and running its PreSync migration hook) before Postgres/Redis are reachable.
resource "helm_release" "argocd_apps" {
  name       = "argocd-apps"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argocd-apps"
  version    = "2.0.5"
  namespace  = kubernetes_namespace.argocd.metadata[0].name

  depends_on = [
    helm_release.argocd,
    helm_release.postgresql,
    helm_release.redis,
    kubernetes_secret.app,
  ]

  values = [yamlencode({
    applications = {
      "license-service" = {
        namespace = "argocd"
        project   = "default"
        source = {
          repoURL        = var.repo_url
          targetRevision = var.git_revision
          path           = "k8s"
        }
        destination = {
          server    = "https://kubernetes.default.svc"
          namespace = local.app_namespace
        }
        syncPolicy = {
          automated = {
            prune    = true
            selfHeal = true
          }
        }
      }
    }
  })]
}
