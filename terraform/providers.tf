# Both providers target the local kind cluster's kubeconfig context. In a real
# cloud setup these would point at an EKS/GKE cluster (itself provisioned by a
# cluster module in the same configuration); only the provider wiring changes.
provider "kubernetes" {
  config_path    = var.kubeconfig
  config_context = var.kube_context
}

provider "helm" {
  kubernetes {
    config_path    = var.kubeconfig
    config_context = var.kube_context
  }
}
