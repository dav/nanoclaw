---
name: mi-library
description: Search the Mechanics Institute Library catalog. Use when the user asks if the MI library has a book, wants to check availability, or asks about their Mechanics Institute membership. No login required.
allowed-tools: Bash(mi-library:*)
---

# Mechanics Institute Library

Search the Mechanics Institute Library catalog for books and check availability.

## Commands

```bash
mi-library search <query>    # Search by title, author, or keyword
```

## Examples

```bash
mi-library search "dungeon crawler carl"
mi-library search "Ursula Le Guin"
mi-library search "chess strategy"
```

## Output

Shows matching titles with call numbers and availability.
