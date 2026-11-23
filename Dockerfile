# Node 24 LTS (soporte hasta abril 2028). Versión exacta para builds reproducibles;
# Dependabot propone las actualizaciones de seguridad.
# ---------- build ----------
FROM node:24.22.3-alpine AS build
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: ningún paquete ejecuta código al instalarse (defensa de cadena de suministro).
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---------- runtime ----------
FROM node:24.22.3-alpine
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts ./scripts
# Esquema y migraciones para `node scripts/migrar.js` (pre-deploy de Render). Sin datos demo.
COPY --chown=node:node db/sql ./db/sql
# Sin privilegios de root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
