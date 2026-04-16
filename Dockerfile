FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
ENV PORT=3000
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
