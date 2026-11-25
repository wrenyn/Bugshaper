FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY . .
RUN npm run package
CMD ["sh", "-c", "ls -la dist && echo 'Extension package ready in /app/dist'"]
