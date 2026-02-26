---
name: usage
description: Show NanoClaw Claude token usage and estimated costs. Use when the user asks how much they've spent, how many tokens were used, or about their Claude usage today/this week/this month.
allowed-tools: Bash(usage:*)
---

# Usage Tracking

Show estimated Claude API costs for NanoClaw requests.

## Commands

```bash
usage today        # Today's usage (default)
usage yesterday
usage week         # Last 7 days
usage month        # Current calendar month
usage all          # All recorded history
```

## Important note on costs

Costs shown are *estimated API-equivalent amounts* based on token counts and standard API pricing. If you use a Claude subscription plan (Pro/Max), these are not actual charges — you pay a flat monthly fee. The numbers reflect what the same usage would cost at pay-per-token API rates.

Usage data is saved to data/usage/usage.jsonl and accumulates from the first request after this feature was deployed.
