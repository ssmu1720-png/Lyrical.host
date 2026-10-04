FROM node:22-bookworm-slim

# Install git and python3 so LYRICAL can clone and run Node.js & Python WhatsApp bots
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

RUN mkdir -p /app/data

ENV NODE_ENV=production
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
