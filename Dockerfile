# Build stage: install everything, compile TypeScript.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production deps only, compiled output, non-root user.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATABASE_URL=file:/data/catalyst.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN groupadd -r catalyst && useradd -r -m -d /home/catalyst -g catalyst catalyst && mkdir -p /data && chown catalyst:catalyst /data
ENV HOME=/home/catalyst
USER catalyst
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
