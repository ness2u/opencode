# Stage 1: Base - System Dependencies
FROM oven/bun:1.3.5-slim AS tools

# Install essential development tools
# - git: Required for Bun to resolve dependencies (e.g., @typescript/native-preview)
# - curl/unzip: Standard utilities
# - openssh-client: For git operations over SSH
# - procps: Often required by dev tools to manage child processes
# - nodejs/npm: Required for some tools (like turbo) that rely on a Node environment
RUN apt-get update && apt-get install -y \
  git \
  curl \
  unzip \
  ca-certificates \
  openssh-client \
  procps \
  build-essential \
  nodejs \
  npm \
  && rm -rf /var/lib/apt/lists/*

# Install Turborepo globally via Bun
RUN bun add -g turbo

# Stage 2: Dev - Development Environment
FROM tools AS dev

# Set the working directory to match standard devcontainer conventions
WORKDIR /workspaces/opencode

# Configure environment variables
ENV SHELL=/bin/bash
ENV NODE_ENV=development

# Persistent Cache Recommendation:
# mount volume to ~/.bun/install/cache to avoid re-downloading stuff

# Expose ports commonly used by the project:
# - 3000: Standard dev port
# - 5173: Default Vite dev server port
# - 4096: Default OpenCode serve port
EXPOSE 3000 5173 4096

CMD ["bash"]
