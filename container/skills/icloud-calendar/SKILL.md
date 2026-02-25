---
name: icloud-calendar
description: Read events from the user's iCloud Calendar via CalDAV. Use this when the user asks about their schedule, upcoming events, or calendar.
allowed-tools: Bash(icloud-calendar:*)
---

# iCloud Calendar

Read iCloud calendar events.

## Commands

```bash
icloud-calendar today          # Events today
icloud-calendar tomorrow       # Events tomorrow
icloud-calendar week           # Next 7 days
icloud-calendar range 2026-02-25 2026-03-01  # Custom range
icloud-calendar list-calendars # Show available calendars
```

Requires ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD env vars.
