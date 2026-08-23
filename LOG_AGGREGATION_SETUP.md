# Log Aggregation & Alerting Setup Guide
**Date:** 2026-08-20  
**Status:** Documentation complete, awaiting infrastructure deployment

## Overview

AICG currently logs structured JSON to stdout with rich telemetry. This guide documents the logging schema, key metrics, and recommended alerting strategy for Railway deployment + Grafana Cloud integration.

---

## Current Structured Logging

### Log Types

#### 1. AIProviderTrace
**Purpose:** Track every AI provider call with success/failure/fallback metadata

```json
{
  "type": "AIProviderTrace",
  "requestId": "cuid",
  "conversationId": "cuid",
  "provider": "groq" | "workers" | "openai",
  "model": "openai/gpt-oss-120b",
  "stage": "PRIMARY_ATTEMPT" | "FALLBACK_ATTEMPT" | "WORKERS_EXTRACTION",
  "upstreamStatus": 200 | 413 | 429 | 500,
  "errorCategory": "RATE_LIMIT" | "CONTEXT_TOO_LARGE" | "TIMEOUT" | null,
  "fallbackAttempted": boolean,
  "fallbackSucceeded": boolean | null,
  "latencyMs": number,
  "timestamp": "ISO8601"
}
```

**Where:** `apps/api/src/providers/hybrid.provider.ts` (lines 66, 97, etc.)

#### 2. AIModelRoute
**Purpose:** Track model routing decisions

```json
{
  "type": "AIModelRoute",
  "requestId": "cuid",
  "conversationId": "cuid",
  "role": "FAST" | "STANDARD",
  "model": "openai/gpt-oss-20b",
  "reason": "short-conversational" | "real-estate-conversation",
  "fallbackChain": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  "timestamp": "ISO8601"
}
```

**Where:** `apps/api/src/chat.service.ts` (inferred from router usage)

#### 3. AIContextTrace
**Purpose:** Track context construction and token usage

```json
{
  "type": "AIContextTrace",
  "requestId": "cuid",
  "conversationId": "cuid",
  "bytesSent": number,
  "estimatedTokens": number,
  "candidatesBeforeRanking": number,
  "contextKind": "PROPERTY_SEARCH" | "COMPARISON" | "INVESTMENT",
  "compactionLevel": "normal" | "aggressive",
  "timestamp": "ISO8601"
}
```

**Where:** `apps/api/src/providers/ai-context.ts` (answerContextMetrics)

#### 4. CustomerTurnTrace
**Purpose:** End-to-end conversation turn tracking

```json
{
  "type": "CustomerTurnTrace",
  "requestId": "cuid",
  "conversationId": "cuid",
  "deviceToken": "sha256-hash",
  "messageCount": number,
  "purchaseIntent": number,
  "leadStatus": "NEW" | "IN_PROGRESS" | "QUALIFIED",
  "latencyMs": number,
  "timestamp": "ISO8601"
}
```

**Where:** `apps/api/src/chat.service.ts` (prepare/send/stream methods)

---

## Database Telemetry

### AIUsage Table Schema

```prisma
model AIUsage {
  id             String   @id @default(cuid())
  provider       String   // "groq" | "workers" | "openai"
  model          String   // "openai/gpt-oss-120b"
  taskType       String   // "customer_answer" | "intent" | "knowledge"
  inputTokens    Int?
  outputTokens   Int?
  latencyMs      Int
  success        Boolean
  fallbackUsed   Boolean  @default(false)
  errorCode      String?
  promptVersion  String?  // NEW: "v1.0.0"
  promptVariant  String?  // NEW: "control" | "experiment-a"
  conversationId String?  // NEW: Track per-conversation
  createdAt      DateTime @default(now())
}
```

**Indexes:**
- `[provider, createdAt]` — Success rate by provider over time
- `[taskType, createdAt]` — Latency by task type
- `[promptVersion, createdAt]` — A/B testing analysis
- `[conversationId]` — Trace full conversation AI calls

---

## Key Metrics to Monitor

### 1. AI Success Rate
**Query (PostgreSQL):**
```sql
SELECT 
  provider,
  COUNT(*) as total,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY provider;
```

**Target:** >95% for all providers
**Alert:** Success rate <90% for 5+ minutes

### 2. Fallback Rate
**Query:**
```sql
SELECT 
  model,
  COUNT(*) as total,
  SUM(CASE WHEN "fallbackUsed" THEN 1 ELSE 0 END) as fallbacks,
  ROUND(100.0 * SUM(CASE WHEN "fallbackUsed" THEN 1 ELSE 0 END) / COUNT(*), 2) as fallback_rate
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  AND provider = 'groq'
GROUP BY model;
```

**Target:** <10%
**Alert:** Fallback rate >20% for 10+ minutes

### 3. P95 Latency
**Query:**
```sql
SELECT 
  provider,
  model,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "latencyMs") as p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "latencyMs") as p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "latencyMs") as p99_ms
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  AND success = true
GROUP BY provider, model;
```

**Target:** P95 <3000ms for customer answers
**Alert:** P95 >5000ms for 10+ minutes

### 4. Context 413 Error Rate
**Query:**
```sql
SELECT 
  COUNT(*) as total_errors,
  SUM(CASE WHEN "errorCode" = '413' THEN 1 ELSE 0 END) as context_too_large,
  ROUND(100.0 * SUM(CASE WHEN "errorCode" = '413' THEN 1 ELSE 0 END) / COUNT(*), 2) as pct_413
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  AND success = false;
```

**Target:** <2% of all errors
**Alert:** >5% of errors are 413 for 10+ minutes

### 5. Prompt Version Performance
**Query (A/B Testing):**
```sql
SELECT 
  "promptVersion",
  "promptVariant",
  COUNT(*) as conversations,
  ROUND(AVG("latencyMs"), 0) as avg_latency_ms,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate,
  ROUND(100.0 * SUM(CASE WHEN "fallbackUsed" THEN 1 ELSE 0 END) / COUNT(*), 2) as fallback_rate
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
  AND "taskType" = 'customer_answer'
GROUP BY "promptVersion", "promptVariant"
ORDER BY "promptVersion", "promptVariant";
```

**Use:** Compare control vs experiment variants
**Decision criteria:** 1000+ samples per variant, statistical significance

---

## Recommended Infrastructure

### Option 1: Railway + Grafana Cloud (Recommended)

**Pros:**
- Railway has built-in log streaming
- Grafana Cloud free tier: 50GB logs/month, 10k metrics series
- Managed Prometheus + Loki + alerting
- No ops overhead

**Setup:**
1. Railway project → Settings → Observability → Enable log export
2. Create Grafana Cloud account (free tier)
3. Add Railway as log source (Loki)
4. Create Grafana dashboard from queries above
5. Set up alert rules (see below)

**Cost:** Free up to 50GB logs/month

### Option 2: Self-Hosted Loki + Prometheus

**Pros:**
- Full control
- No vendor lock-in

**Cons:**
- Ops overhead (server, backups, scaling)
- Cost of running infrastructure

**Not recommended** unless already managing self-hosted observability.

---

## Grafana Dashboard Panels

### Panel 1: AI Success Rate (Gauge)
```promql
(sum(rate(aiusage_success_total[5m])) / sum(rate(aiusage_total[5m]))) * 100
```
- Green: >95%
- Yellow: 90-95%
- Red: <90%

### Panel 2: Success Rate by Provider (Bar Chart)
```sql
-- Use PostgreSQL datasource, not PromQL
SELECT provider, success_rate FROM ai_success_rate_last_hour
```

### Panel 3: Fallback Rate Over Time (Line Chart)
```promql
(sum(rate(aiusage_fallback_total[5m])) / sum(rate(aiusage_total[5m]))) * 100
```

### Panel 4: P50/P95 Latency (Line Chart)
```promql
histogram_quantile(0.50, aiusage_latency_seconds_bucket)
histogram_quantile(0.95, aiusage_latency_seconds_bucket)
```

### Panel 5: Error Rate by Code (Pie Chart)
```sql
SELECT "errorCode", COUNT(*) as count
FROM "AIUsage"
WHERE success = false AND "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY "errorCode";
```

### Panel 6: Token Usage (Area Chart)
```sql
SELECT 
  DATE_TRUNC('minute', "createdAt") as time,
  SUM("inputTokens") as input,
  SUM("outputTokens") as output
FROM "AIUsage"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY time
ORDER BY time;
```

---

## Alert Rules (Grafana)

### Alert 1: High AI Failure Rate
```yaml
name: High AI Failure Rate
condition: success_rate < 90
for: 5m
severity: critical
message: "AI success rate dropped below 90% (current: {{ $value }}%)"
notify: slack, email
```

### Alert 2: High Fallback Rate
```yaml
name: High Fallback Rate
condition: fallback_rate > 20
for: 10m
severity: warning
message: "Groq fallback rate above 20% (current: {{ $value }}%)"
notify: slack
```

### Alert 3: Slow AI Responses
```yaml
name: Slow AI Responses
condition: p95_latency > 5000
for: 10m
severity: warning
message: "P95 AI latency above 5s (current: {{ $value }}ms)"
notify: slack
```

### Alert 4: Context Size Issues
```yaml
name: Context Size Issues
condition: error_413_rate > 5
for: 10m
severity: warning
message: "Context-too-large errors above 5% (current: {{ $value }}%)"
notify: slack
```

---

## Log Retention Policy

**Recommended:**
- **Stdout logs (Railway):** 7 days
- **Grafana Loki:** 30 days
- **AIUsage table:** 90 days (then archive or aggregate)

**Rationale:** 30 days covers debugging recent issues and month-over-month analysis. Older data can be archived to S3/R2 for compliance.

---

## Implementation Checklist

- [x] Structured logging schema documented
- [x] AIUsage table has `promptVersion`, `promptVariant`, `conversationId`
- [x] Key metrics queries written
- [x] Alert thresholds defined
- [ ] Railway log export configured
- [ ] Grafana Cloud account created
- [ ] Dashboard created from queries above
- [ ] Alert rules configured in Grafana
- [ ] Slack webhook connected for notifications
- [ ] Email notification list configured
- [ ] Runbook created for responding to alerts

---

## Next Steps

1. **Deploy infrastructure** (Railway + Grafana Cloud setup)
2. **Create dashboard** (import queries as panels)
3. **Configure alerts** (copy alert rules from this doc)
4. **Test alerting** (simulate failure, verify notification)
5. **Document runbook** (how to respond to each alert type)

---

## Runbook (Draft)

### Alert: High AI Failure Rate

**Symptoms:** Success rate <90% for 5+ minutes

**Investigation:**
1. Check Grafana: Which provider is failing? (Groq, Workers AI, OpenAI)
2. Check Railway logs: Filter by `AIProviderTrace` with `success: false`
3. Look for common `errorCode`: 429 (rate limit), 500 (server error), timeout

**Actions:**
- **429 (Rate Limit):** Check Groq API dashboard, verify rate limit not exceeded
- **500 (Server Error):** Check Groq status page (status.groq.com if exists)
- **Timeout:** Check network latency, consider increasing timeout threshold

### Alert: High Fallback Rate

**Symptoms:** >20% of requests hitting fallback models

**Investigation:**
1. Check which primary model is failing
2. Check if fallbacks are succeeding (fallbackSucceeded: true/false)
3. Review error codes for primary model failures

**Actions:**
- If primary model has transient issues → monitor, fallbacks working as designed
- If fallbacks also failing → critical, escalate to provider

### Alert: Slow AI Responses

**Symptoms:** P95 latency >5s

**Investigation:**
1. Check if specific to one model or all models
2. Check if context size is unusually large (estimatedTokens)
3. Check if Groq API is experiencing degradation

**Actions:**
- Large context → review compaction logic, consider more aggressive trimming
- Model-specific → switch to faster model temporarily
- Provider-wide → check provider status page

---

**Status:** Documentation complete. Infrastructure deployment requires Railway access and Grafana Cloud signup (no code changes needed).
