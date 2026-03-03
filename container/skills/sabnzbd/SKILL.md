---
name: sabnzbd
description: Add NZBs to SABnzbd and check download status. Use when the user wants to download something via usenet, add an NZB, check download progress, or see download history.
allowed-tools: Bash(sabnzbd:*)
---

# SABnzbd

Add NZBs and monitor downloads on SABnzbd.

## Commands

```bash
sabnzbd add <nzb-url>               # Add NZB by URL to download queue
sabnzbd addfile <path>              # Add NZB from a local file
sabnzbd queue                       # Show current download queue
sabnzbd history [--limit N]         # Show recent download history
sabnzbd status                      # Quick server status
```

## Optional flags for add/addfile

- `--cat Category` — assign a category
- `--priority 0` — set priority: -2 paused, -1 low, 0 normal, 1 high, 2 force

## Workflow with NZB search

After finding an NZB with the `nzb` tool, download then send it to SABnzbd:

```bash
nzb download 12345                  # Downloads .nzb file to /tmp/
sabnzbd addfile /tmp/filename.nzb   # Sends it to SABnzbd
```

## Examples

```bash
sabnzbd add "https://example.com/some.nzb"
sabnzbd addfile /tmp/my-download.nzb --cat tv
sabnzbd queue
sabnzbd history --limit 5
sabnzbd status
```

Requires SABNZBD_URL and SABNZBD_API_KEY env vars.
