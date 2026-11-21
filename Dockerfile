FROM oven/bun:1

WORKDIR /app

# Deps first so source edits don't re-run install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["bun", "src/main.ts"]
