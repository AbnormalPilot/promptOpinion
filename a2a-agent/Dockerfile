FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY tsconfig.json ./
ENV A2A_PORT=8001
EXPOSE 8001
CMD ["npx", "tsx", "src/server.ts"]
