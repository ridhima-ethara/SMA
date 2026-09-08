# Ethara SMA API. Runs TypeScript directly with tsx, matching how the app runs locally
# (the project is noEmit — there is no compiled build step).
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so a source-only change reuses this layer.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

# The repo root declares "type": "module", which is what makes shared/*.ts load as ESM.
# Without a package.json at /app those files would be treated as CommonJS and their named
# exports would not resolve.
RUN printf '{"name":"ethara-sma-runtime","private":true,"type":"module"}\n' > /app/package.json

# The server imports ../../shared at runtime, so both trees must be present.
COPY shared ./shared
COPY server/src ./server/src
COPY server/tsconfig.json ./server/

# tsx is a devDependency of the server package; install it explicitly for the runtime.
RUN cd server && npm i --no-save --no-audit --no-fund tsx@4.19.2

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

WORKDIR /app/server

# Fail the container health check until the API can actually reach Postgres.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/index.ts"]
