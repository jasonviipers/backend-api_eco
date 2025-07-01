# Both stages use Alpine-based images
FROM oven/bun:1.1.13-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    postgresql-dev \
    openssl-dev \
    zlib-dev \
    libpq-dev \
    pkgconfig

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --production

# Final stage
FROM oven/bun:1.1.13-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    postgresql-client \
    libpq \
    curl \
    bash \
    openjdk11-jre-headless \
    python3 \
    py3-pip \
    ffmpeg

# Install cqlsh for Cassandra migrations
RUN pip3 install --no-cache-dir cqlsh

# Copy installed node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy package files and source code
COPY package.json bun.lock ./
COPY . .

# Set permissions
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app && \
    mkdir -p /app/logs && \
    chown -R nodejs:nodejs /app/logs

USER nodejs

# Expose ports
EXPOSE 5000 1935 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start the application
CMD ["bun", "start"]