FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY tsconfig.json ./
ENV A2A_PORT=8001
EXPOSE 8001
CMD ["npx", "tsx", "src/server.ts"]
