---
name: icloud-calendar
description: Read and create events in the user's iCloud Calendar via CalDAV. Use this when the user asks about their schedule, upcoming events, calendar, or wants to create/add a new event.
allowed-tools: Bash(icloud-calendar:*)
---

# iCloud Calendar

Read and create iCloud calendar events.

## Read Events

```bash
icloud-calendar today          # Events today
icloud-calendar tomorrow       # Events tomorrow
icloud-calendar week           # Next 7 days
icloud-calendar range 2026-02-25 2026-03-01  # Custom range
icloud-calendar list-calendars # Show available calendars
```

## Create Events

```bash
# Timed event
icloud-calendar create "Lunch with Alice" "2026-03-05 12:00" "2026-03-05 13:00"

# All-day event
icloud-calendar create "Vacation" "2026-03-10"

# Multi-day all-day event
icloud-calendar create "Conference" "2026-03-10" "2026-03-12"

# With optional calendar and location
icloud-calendar create "Dentist" "2026-03-05 14:00" "2026-03-05 15:00" --calendar Personal --location "123 Main St"
```

**Important:** Always use `list-calendars` first if the user wants to add an event to a specific calendar. The `--calendar` flag matches by display name. If omitted, the first calendar is used.

Requires ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD env vars.
