variable "kubeconfig" {
  type        = string
  description = "Path to the kubeconfig file."
  default     = "~/.kube/config"
}

variable "kube_context" {
  type        = string
  description = "kubeconfig context to target (the kind cluster)."
  default     = "kind-licsvc"
}

variable "repo_url" {
  type        = string
  description = "Git repo ArgoCD syncs the k8s/ manifests from."
  default     = "https://github.com/lucalamattina/license-service.git"
}

variable "git_revision" {
  type        = string
  description = "Git revision ArgoCD tracks."
  default     = "main"
}

variable "db_user" {
  type    = string
  default = "license_service"
}

variable "db_password" {
  type      = string
  default   = "license_service"
  sensitive = true
}

variable "db_name" {
  type    = string
  default = "license_service"
}
