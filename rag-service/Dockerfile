FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
# Pre-create the data directory so the index can be written at runtime
RUN mkdir -p /app/data/ncd-index
ENV RAG_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
CMD ["npx", "tsx", "src/index.ts"]
