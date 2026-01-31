FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock ./
RUN apt-get update
RUN bun install

COPY src ./src
COPY public ./public

# Ensure data directory exists for SQLite
RUN mkdir -p data

EXPOSE 3000

CMD ["bun", "src/index.ts"]
