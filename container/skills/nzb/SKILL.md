---
name: nzb
description: Search for NZBs. Use when the user asks to find, search, or download NZBs, usenet content, or asks about TV shows/movies in the context of downloading.
allowed-tools: Bash(nzb:*)
---

# NZB Search 

Search the nzbs indexer for NZBs.

## Commands

```bash
nzb search <query>                  # General search
nzb tv <query> [--season N] [--ep N]  # TV-specific search
nzb movie <query> [--imdbid N]      # Movie-specific search
nzb nfo <id>                        # Get NFO for a release
nzb download <id>                   # Download NZB file to /tmp/
```

All search commands support these optional flags:
- `--limit N` — max results (default 25, max 500)
- `--maxage N` — only results from last N days
- `--cat 5040,5030` — filter by category IDs

## Examples

```bash
nzb search "Dungeon Crawler Carl"
nzb tv "Severance" --season 2 --ep 5
nzb tv "The Last of Us" --season 2
nzb movie "Dune Part Two"
nzb search "Ubuntu 24.04" --maxage 30
nzb nfo 12345
nzb download 12345
```

## Output

Shows matching results with title, size, category, age, and grabs count. Results include the NZB ID needed for `nzb download` and `nzb nfo`.

Requires NZBS_API_URL and NZBS_API_KEY env vars.
