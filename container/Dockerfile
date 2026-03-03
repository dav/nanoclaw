# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally
RUN npm install -g agent-browser @anthropic-ai/claude-code

# Install iCloud calendar tool
COPY skills/icloud-calendar/icloud-calendar.mjs /usr/local/bin/icloud-calendar
RUN chmod +x /usr/local/bin/icloud-calendar

# Install Apple Music tool
COPY skills/apple-music/apple-music.mjs /usr/local/bin/apple-music
RUN chmod +x /usr/local/bin/apple-music

# Install Gmail read-only tool
COPY skills/gmail/gmail.mjs /usr/local/bin/gmail
RUN chmod +x /usr/local/bin/gmail

# Install usage tracking tool
COPY skills/usage/usage.mjs /usr/local/bin/usage
RUN chmod +x /usr/local/bin/usage

# Install Goodreads tool
COPY skills/goodreads/goodreads.mjs /usr/local/bin/goodreads
RUN chmod +x /usr/local/bin/goodreads

# Install SFPL catalog tool
COPY skills/sfpl/sfpl.mjs /usr/local/bin/sfpl
RUN chmod +x /usr/local/bin/sfpl

# Install Mechanics Institute Library catalog tool
COPY skills/mi-library/mi-library.mjs /usr/local/bin/mi-library
RUN chmod +x /usr/local/bin/mi-library

# Install NZB search tool
COPY skills/nzb/nzb.mjs /usr/local/bin/nzb
RUN chmod +x /usr/local/bin/nzb

# Install SABnzbd tool
COPY skills/sabnzbd/sabnzbd.mjs /usr/local/bin/sabnzbd
RUN chmod +x /usr/local/bin/sabnzbd

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Secrets are passed via stdin JSON — temp file is deleted immediately after Node reads it
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
