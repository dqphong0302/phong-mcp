FROM node:22-alpine AS base

# Install pnpm
RUN npm i -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy source
COPY src/ ./src/

# Default env
ENV TRANSPORT=stdio
ENV PORT=3100
ENV NODE_ENV=production

EXPOSE 3100

# Use public entry point (no ops/tts)
CMD ["node", "src/public.js"]
