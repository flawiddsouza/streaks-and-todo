# Multi-stage build: First build the frontend
FROM oven/bun:1.2-alpine AS frontend-builder

WORKDIR /app/ui

# Copy frontend package files
COPY ui/package.json ui/bun.lock ./
RUN bun install --frozen-lockfile

# Copy frontend source and build
COPY ui/ .
RUN bun run build

# Main backend stage
FROM oven/bun:1.2-alpine

WORKDIR /app

# Copy backend package files
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy backend source
COPY src/ src/
COPY drizzle.config.ts tsconfig.json ./

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/ui/dist ./ui/dist

EXPOSE 9008

CMD ["bun", "run", "src/index.ts"]
