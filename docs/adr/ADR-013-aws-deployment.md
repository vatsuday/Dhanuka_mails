# ADR-013: AWS deployment

**Status:** Accepted for region, accounts and compute (Phase 1 approval, 2026-10-14). **Cost option: Option B (lean beta) preferred by the PO (D5, 2026-10-14), subject to a verified Pricing Calculator estimate before provisioning (S2.7).** · **Date:** 2026-10-14

## Decision
- **Region:** ap-south-1, for India-first data residency. The `data_region` field allows future regional deployments.
- **Accounts:** separate AWS accounts for staging and production under AWS Organizations.
- **Compute:** ECS Fargate on ARM64 for all six processes. No Vercel, so cookies, networking and IAM stay on one platform. The browser reaches `api` through the same-origin `/api` path.
- **Managed services:** RDS PostgreSQL 18, ElastiCache Valkey ×2, S3, SQS/SNS, EventBridge, CloudFront and WAF, Secrets Manager and KMS.
- **IaC and delivery:** Terraform; GitHub Actions → ECR → ECS.
- **Cost:** `08-aws-cost-estimate.md`.
  - Option A (high availability): about $915–1,295/month including staging.
  - Option B (lean beta): about $700–960/month.
  - Both are to be validated in S2.7.
