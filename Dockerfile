# -------------------------------------------------------------
# Stage 1: Build stage
# -------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# Install native dependencies required for build and native modules (e.g. bcrypt)
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

# Generate Prisma Client and build the NestJS application
RUN npx prisma generate
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

# Copy built application, production node_modules, prisma schema and client
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

# Switch to non-root user (UID 1000)
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
