---
name: sfpl
description: Search the San Francisco Public Library catalog and place holds. Use when the user asks if SFPL has a book, wants to check availability, place a hold, or asks about their library.
allowed-tools: Bash(sfpl:*)
---

# San Francisco Public Library (SFPL)

Search the SFPL catalog for books, check availability, and place holds.

## Commands

```bash
sfpl search <query>    # Search by title, author, or keyword
sfpl hold <query>      # Search and place a hold on the first matching title
sfpl login             # Force a fresh login (troubleshooting)
```

## Examples

```bash
sfpl search "dungeon crawler carl"
sfpl hold "dungeon crawler carl book 1"
sfpl search "Ursula Le Guin left hand of darkness"
sfpl hold "left hand of darkness"
```

## Output

**search** — Shows each matching title with format, call number, availability status, and hold counts.

Example:
```
Dungeon Crawler Carl — by Dinniman, Matt
  • Book (SF DINNIMAN) — All copies in use — Holds: 69 on 26 copies
  • eBook (EBOOK LIBBY) — All copies in use — Holds: 399 on 125 copies
```

**hold** — Places a hold on the first matching physical book, with pickup at Bayview branch. Reports success or failure.

## Notes

- Hold placement requires SFPL_BARCODE and SFPL_PIN in .env
- Pickup location is always Bayview/Linda Brooks-Burton branch
- Auth state is cached between runs (~/.sfpl/auth.json)
