FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY . .
ENTRYPOINT ["node", "cli.mjs"]
CMD ["--help"]
