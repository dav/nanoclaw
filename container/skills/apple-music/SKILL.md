---
name: apple-music
description: Create playlists and add songs in Apple Music. Use when the user asks to create a playlist, add songs to a playlist, or build a music collection. Search for songs by title/artist, create named playlists, and populate them.
allowed-tools: Bash(apple-music:*)
---

# Apple Music

Create playlists and add songs to the user's Apple Music library.

## Commands

```bash
apple-music search "dire straits sultans of swing"          # Find a song, returns ID + name
apple-music create-playlist "Playlist Name" ["Description"] # Create playlist, returns ID
apple-music add-songs <playlist-id> <song-id> [song-id ...] # Add songs by catalog ID
apple-music make "Playlist Name" "query1" "query2" ...      # Create + search + add in one step
apple-music list-playlists                                  # Show recent library playlists
apple-music delete-playlist <playlist-id>                   # Delete a playlist
```

## Never modify existing playlists unless explicitly asked

**Do not add songs to any existing playlist** unless the user explicitly names a specific existing playlist they want to modify. If playlist creation fails, report the error — do not fall back to adding songs to any other playlist.

## Always research before creating

Before creating any playlist:
1. Research all artists/songs first (search Apple Music, browse the web, etc.)
2. Send the user a message summarising what was found — which artists are on Apple Music, which weren't, and what songs will be added
3. Only then create the playlist and add songs

This avoids creating empty or wrong playlists and keeps the user informed.

## Typical workflow

For "create a playlist from a venue's weekend lineup":
1. Look up the lineup (browse venue calendar page)
2. `apple-music search "artist name"` for each artist
3. Send message: "Found X artists: [names + top songs]. Could not find: [names]. Creating playlist now..."
4. `apple-music make "Playlist Name" "artist1 song1" "artist1 song2" "artist2 song1" ...`

For a simple request like "make me a workout playlist":
1. `apple-music make "Workout" "eye of the tiger" "jump van halen" "walking on sunshine" ...`

For more control:
1. `apple-music search "query"` — note the song ID and name
2. `apple-music create-playlist "Name"` — note the playlist ID
3. `apple-music add-songs <playlist-id> <song-id1> <song-id2> ...`

Requires MUSICKIT_TEAM_ID, MUSICKIT_KEY_ID, MUSICKIT_PRIVATE_KEY_B64, APPLE_MUSIC_USER_TOKEN env vars.
