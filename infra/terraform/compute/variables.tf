variable "project" {
  description = "Prefix for resource names, and the value this stack looks the network and the registry up by."
  type        = string
  default     = "scheduling-manager"
}

variable "region" {
  description = "Must match the network and the registry: pulling an image across regions is billed and slow."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Graviton, because the same performance costs less. Burstable: sustained CPU above the baseline is billed as surplus credits under the default unlimited mode."
  type        = string
  default     = "t4g.small"

  # This has to agree with the architecture CI builds for, and nothing enforces
  # the agreement from here — a mismatched image is pushed, pulled and started
  # without complaint, then exits immediately with an exec format error. The
  # pipeline asserts the image is arm64 for exactly this reason; changing this
  # to an x86 family means changing that assertion and the runner alongside it.
  validation {
    condition     = can(regex("^(t4g|m6g|m7g|m8g|c6g|c7g|c8g|r6g|r7g|r8g)\\.", var.instance_type))
    error_message = "Must be a Graviton (arm64) instance type, matching the architecture the pipeline builds — see .github/workflows/ci.yml."
  }
}

variable "root_volume_size" {
  description = "GiB. Holds the operating system, Docker's image cache and the logs. Billed in full whether used or not, and it can grow later but never shrink."
  type        = number
  default     = 20
}

# ── the public name ───────────────────────────────────────────────────────────

variable "domain_name" {
  description = "Public hostname. Empty means bring-up mode: no DNS record, no certificate, and the application answers plain HTTP on the Elastic IP. See README.md before leaving it empty."
  type        = string
  default     = ""

  validation {
    condition     = var.domain_name == "" || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.domain_name))
    error_message = "Must be a lowercase fully qualified domain name, or empty."
  }
}

variable "route53_zone_name" {
  description = "Hosted zone the record goes into, with the trailing dot omitted. Defaults to the registrable part of domain_name, which is wrong for a zone delegated deeper than that."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "Where Let's Encrypt sends expiry warnings. Required once domain_name is set."
  type        = string
  default     = ""

  validation {
    condition     = var.domain_name == "" || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.acme_email))
    error_message = "acme_email is required, and must be an address, whenever domain_name is set."
  }
}

variable "acme_staging" {
  description = "Issue from Let's Encrypt's staging endpoint, whose certificates are untrusted by browsers. Its rate limits are far higher, which is what makes iterating on the bootstrap safe — production allows five certificates a week for an identical set of names, refilling one every 34 hours."
  type        = bool
  default     = true
}

# ── what runs on it ───────────────────────────────────────────────────────────

variable "image_tag" {
  description = "The commit SHA CI published. Written to Parameter Store, not into the instance — see README.md on how a deploy happens."
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z0-9._-]+$", var.image_tag))
    error_message = "Must be a valid image tag: letters, digits, dot, underscore or hyphen."
  }
}

variable "app_replicas" {
  description = "Application containers behind the proxy. Two is the floor worth running: Docker marks an unhealthy container but does nothing about it, so with one container a wedged process is an outage until someone notices."
  type        = number
  default     = 2

  validation {
    condition     = var.app_replicas >= 1 && var.app_replicas <= 8
    error_message = "Between 1 and 8. Past that the instance is the wrong size, not the container count."
  }

  # The two variables are only meaningful against each other: replicas are
  # capped by the connections the pooler will hand out, not by the CPU.
  validation {
    condition     = floor(var.database_pool_size / var.app_replicas) >= 2
    error_message = "database_pool_size divided by app_replicas leaves fewer than 2 connections per container. Raise the pooler's pool size or run fewer replicas."
  }
}

variable "database_pool_size" {
  description = "The pool size configured on the Supavisor pooler, read from the Supabase dashboard. Divided across the replicas to derive each container's DATABASE_POOL_MAX, so scaling containers cannot silently exhaust it."
  type        = number
  default     = 15

  validation {
    condition     = var.database_pool_size >= 4
    error_message = "Below 4 there is nothing left to divide once migrations and administrative connections are accounted for."
  }
}

# ── throttling at the edge ────────────────────────────────────────────────────

variable "rate_limit_average" {
  description = "Requests per second per source address, sustained. Enforced in the proxy's own memory, so it applies after the traffic has already reached the instance — docs/aws-stack-implementation.md."
  type        = number
  default     = 20
}

variable "rate_limit_burst" {
  description = "How far a source may exceed the average before being throttled. Absorbs a page that fires several calls at once without letting a script run unbounded."
  type        = number
  default     = 50
}

variable "in_flight_limit" {
  description = "Concurrent requests per source address. Catches what a rate limit cannot: a client that opens many connections and holds them open slowly."
  type        = number
  default     = 20
}
