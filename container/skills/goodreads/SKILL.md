---
name: goodreads
description: Access Goodreads — search for books, browse reading shelves, and add books to your to-read list. Use when the user asks about books on Goodreads, wants to check their reading list, or wants to add a book to read later.
allowed-tools: Bash(goodreads:*)
---

# Goodreads

Browse Goodreads and manage reading lists via headless browser automation. Logs in with your Goodreads account and saves the session so it only needs to authenticate once.

## Commands

```bash
goodreads search <query>           # Search for books by title or author
goodreads shelf                    # List your to-read shelf (default)
goodreads shelf <name>             # List any shelf: to-read, read, currently-reading
goodreads add-to-read <query>      # Find a book and add it to your to-read list
goodreads profile                  # Show your Goodreads profile and shelf names
goodreads login                    # Force a fresh login (if session expired)
```

## Typical workflows

User asks "add Dune to my to-read list":
1. `goodreads add-to-read "Dune Frank Herbert"`
2. Confirm the book was added

User asks "what's on my to-read list?":
1. `goodreads shelf to-read`
2. Report the books

User asks "find books by Ursula Le Guin":
1. `goodreads search "Ursula Le Guin"`
2. Report results with titles and Goodreads IDs

## Setup

Requires `GOODREADS_EMAIL` and `GOODREADS_PASSWORD` in your `.env` file.

Auth state is saved to `~/.goodreads/auth.json` and reused across sessions.
First run will open the browser and log in — subsequent runs reuse the saved session.

> Note: Uses your email/password Goodreads account. If your account is linked to
> Amazon sign-in only (no separate Goodreads password), run `goodreads login` to
> set up credentials, or add a Goodreads password via your account settings first.
