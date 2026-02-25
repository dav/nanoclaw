# To get you shell ready:
set -a; source /home/dav/code/nanoclaw/.env; set +a                                                                                                                                                                
                                                                                                                                                                                                                     
# Then any command:                                                                                                                                                                                                
node /home/dav/code/nanoclaw/container/skills/apple-music/apple-music.mjs list-playlists                                                                                                  
node /home/dav/code/nanoclaw/container/skills/apple-music/apple-music.mjs search "empire of the sun"
node /home/dav/code/nanoclaw/container/skills/apple-music/apple-music.mjs create-playlist "Test" "test"
                                                                                                   
                                                                                                                  
set -a makes every variable exported automatically, so all the MUSICKIT_* and APPLE_MUSIC_* vars become available to the node process. set +a turns that off afterward so your shell doesn't export everything going forward.

This way you can iterate quickly without a full container rebuild+restart cycle.

