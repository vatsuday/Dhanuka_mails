# 08 — AWS Cost Estimate (Controlled Beta)

**Status:** v0.1, an **indicative estimate**, accepted as the basis for planning. **D5 (2026-10-14): the product owner prefers Option B (lean beta), subject to a verified AWS Pricing Calculator estimate (S2.7) before any provisioning.** **Validate with the AWS Pricing Calculator in Sprint 2 (story S2.7) before committing.**
**Region:** ap-south-1 (Mumbai)
**Last updated:** 2026-10-14

## Price sources and confidence

| Item | Source | Confidence |
|---|---|---|
| **SES** | **Verified 2026-10-14** on aws.amazon.com/ses/pricing: $0.10 per 1,000 emails (à la carte); tenants $0.005/tenant/month + $0.005 per 1,000 emails; dedicated IP $24.95/month | High |
| Everything else | Approximate on-demand list prices from general knowledge, **not verified** for ap-south-1 in this session | Medium (±25%) |

## Planning assumptions (need product-owner confirmation; decision U5)

- About **25 beta tenants** and about **2 million emails per month** across the platform.
- No dedicated IPs.
- Logs kept 180 days.

## Option A: recommended (high availability)

| Component | Sizing | USD/month |
|---|---|---|
| ECS Fargate (ARM) | web 2×(0.5 vCPU, 1 GB); api 2×(0.5, 1); tracker 2×(0.25, 0.5); worker 2×(1, 2); webhook-worker 1×(0.25, 0.5); admin 1×(0.25, 0.5) = 5 vCPU, 10 GB | 140 – 190 |
| RDS PostgreSQL | db.t4g.medium **Multi-AZ**, 100 GB gp3, 7-day PITR | 200 – 260 |
| ElastiCache Valkey | queue: cache.t4g.small primary + replica; cache: one cache.t4g.small | 50 – 80 |
| ALB | 1 ALB, host-based routing | 30 – 45 |
| NAT | 1 NAT gateway + S3 gateway endpoint (beta); 2 for GA | 50 – 100 |
| CloudFront + WAF | managed rules, low traffic | 25 – 40 |
| S3 (assets, imports, archives) | < 200 GB | 5 – 10 |
| **SES** | 2M emails × $0.10/1k = $200; tenants 25 × $0.005 + 2M × $0.005/1k ≈ $10 | **≈ 210** |
| SNS, SQS, EventBridge | | < 5 |
| Secrets Manager + KMS | ~15 secrets, 4 keys | 10 – 15 |
| CloudWatch (logs 180 d, metrics, alarms) | | 40 – 80 |
| ECR, Route 53 | | 5 – 10 |
| **Production subtotal** | | **≈ 765 – 1,045** |
| **Staging** | Single-AZ, smallest sizes, scaled down outside working hours, SES sandbox | **≈ 150 – 250** |
| **Total** | | **≈ $915 – 1,295 / month** |

## Option B: lean beta (lower cost, lower availability)

Changes from Option A:
- RDS **Single-AZ** db.t4g.small: about $90–120 less.
- valkey-queue **without a replica**: about $15–25 less.
- **1 task** per service: about $60–90 less.
- Staging switched off when not in use: about $50–100 less.

**Total ≈ $700 – 960 / month.**

Trade-off: an AZ failure causes downtime until the service is restored (RTO about 1–4 h). Sending state stays safe because of the Postgres-backed reconciliation design. Moving from Option B to Option A later is a Terraform change, not a redesign.

## Cost levers

- Graviton/ARM everywhere.
- Fargate Spot for staging workers.
- Scheduled scale-down of staging.
- A Compute Savings Plan (about 20–30%) once usage is stable after beta.
- An S3 gateway endpoint to cut NAT data charges.
- Log sampling for high-volume tracker access logs.

## Not included

- Domain registration.
- Sentry or Grafana paid tiers (free tiers are assumed for beta).
- GitHub plan.
- Docker Desktop subscription (needed only if the business exceeds the free-use limits).
- Support plans (AWS Business Support costs about 10% of the bill, with a minimum fee; recommended before GA).
- Taxes: AWS India (AISPL) bills in INR **plus 18% GST**.
- Currency conversion: the bill in INR depends on the exchange rate.
