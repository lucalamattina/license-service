output "namespaces" {
  description = "Namespaces this configuration manages."
  value       = [
    kubernetes_namespace.app.metadata[0].name,
    kubernetes_namespace.argocd.metadata[0].name,
    kubernetes_namespace.monitoring.metadata[0].name,
  ]
}

output "argocd_admin_password_cmd" {
  description = "Command to read the ArgoCD initial admin password."
  value       = "kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath=\"{.data.password}\" | base64 -d"
}

output "grafana_admin_password_cmd" {
  description = "Command to read the Grafana admin password."
  value       = "kubectl -n monitoring get secret monitoring-grafana -o jsonpath=\"{.data.admin-password}\" | base64 -d"
}
