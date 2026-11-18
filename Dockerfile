# -------------------------------------------------------------
# Stage 1: Build stage
# -------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# Install native dependencies required for build and native modules (e.g. bcrypt)
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci || npm install --no-audit --no-fund

COPY . .

# Generate Prisma Client and build the NestJS application
RUN DATABASE_URL="mongodb://localhost:27017/online_exam?replicaSet=rs0" npx prisma generate
RUN npm run build

# Prune devDependencies to keep only production packages
RUN npm prune --omit=dev && npm cache clean --force

# -------------------------------------------------------------
# Stage 2: Production runner stage
# -------------------------------------------------------------
FROM node:24-alpine AS runner

WORKDIR /app

# Install runtime dependencies for Prisma engine on Alpine
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=3000
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Ensure /app itself is owned by non-root user before copying artifacts
RUN chown node:node /app

# Copy built application, production node_modules, prisma schema and client
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

# Switch to non-root user (UID 1000)
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
