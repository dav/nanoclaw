---
name: gmail
description: Read emails from Gmail. Use when the user asks to check their email, read a specific message, or search their inbox. This is read-only — it cannot send, reply to, delete, or modify any emails.
allowed-tools: Bash(gmail:*)
---

# Gmail (read-only)

Read emails from the user's Gmail inbox. Cannot send, reply, delete, or modify anything.

## Commands

```bash
gmail list                              # 15 most recent emails (shows ID, from, subject, date, preview)
gmail list --max 30                     # More results
gmail list --query "from:bank"          # Filter while listing
gmail read <id>                         # Full email content by ID
gmail search "from:amazon subject:order" # Search and list results
gmail profile                           # Show connected Gmail address
```

## Gmail search syntax (for list --query and search)

- `from:someone@example.com` — from a sender
- `to:me` — sent to you
- `subject:invoice` — subject contains word
- `is:unread` — unread only
- `after:2026/02/01` — after a date
- `has:attachment` — has attachments
- Combine: `from:github is:unread`

## Typical workflow

User asks "do I have any new emails from Amazon?":
1. `gmail search "from:amazon is:unread"`
2. Report what you find

User asks "read that email":
1. Use the ID from the previous list result
2. `gmail read <id>`

Requires ~/.gmail-readonly/ credentials. Set up with: node scripts/gmail-setup.mjs
