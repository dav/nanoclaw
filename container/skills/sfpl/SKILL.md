---
name: sfpl
description: Search the San Francisco Public Library catalog. Use when the user asks if SFPL has a book, wants to check availability or holds, or asks about their library. No login required.
allowed-tools: Bash(sfpl:*)
---

# San Francisco Public Library (SFPL)

Search the SFPL catalog for books and check availability.

## Commands

```bash
sfpl search <query>    # Search by title, author, or keyword
```

## Examples

```bash
sfpl search "dungeon crawler carl"
sfpl search "Ursula Le Guin left hand of darkness"
sfpl search "Matt Dinniman"
```

## Output

Shows each matching title with format, call number, availability status, and hold counts.

Example:
```
Dungeon Crawler Carl — by Dinniman, Matt
  • Book (SF DINNIMAN) — All copies in use — Holds: 69 on 26 copies
  • eBook (EBOOK LIBBY) — All copies in use — Holds: 399 on 125 copies
  • Large Print (LARGE PRINT SF DINNIMAN) — All copies in use — Holds: 8 on 5 copies
```
