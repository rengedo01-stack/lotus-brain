resource "google_compute_security_policy" "edge" {
  project     = var.project_id
  name        = "${var.system_name}-${var.environment}-edge-security"
  description = "Preview-first edge protections for the Lotus BRAIN production external Application Load Balancer."

  rule {
    action      = "deny(403)"
    description = "Preview CRS 4.22 stable SQL injection detection at sensitivity 1."
    preview     = true
    priority    = 1000

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v422-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    action      = "deny(403)"
    description = "Preview CRS 4.22 stable XSS detection at sensitivity 1."
    preview     = true
    priority    = 1010

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v422-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    action      = "throttle"
    description = "Preview a per-client-IP throttle for public authentication requests."
    preview     = true
    priority    = 1020

    match {
      expr {
        expression = "request.method == 'POST' && (request.path == '/api/v1/auth/login' || request.path == '/api/v1/auth/login/passkey/verify' || request.path == '/api/v1/auth/password/recovery/request')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = 60
        interval_sec = 60
      }
    }
  }

  rule {
    action   = "allow"
    priority = 2147483647

    match {
      versioned_expr = "SRC_IPS_V1"

      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}
