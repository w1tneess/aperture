# ---- build the web app
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- runtime: Node + Python extractors + ffmpeg
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Extractors live in a venv owned by the app user, so AUTO_UPDATE can upgrade them without root.
ENV VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
RUN python3 -m venv /opt/venv \
 && pip install --no-cache-dir -U pip "yt-dlp[default]" gallery-dl \
 && chown -R node:node /opt/venv

WORKDIR /app
COPY server/package*.json server/
RUN npm ci --omit=dev --prefix server
COPY server/ server/
COPY --from=web /app/web/dist web/dist

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 PYTHON=/opt/venv/bin/python AUTO_UPDATE=1 TRUST_PROXY=1
USER node
EXPOSE 8787
CMD ["node", "server/src/index.js", "--prod"]
