FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY config ./config
COPY docs ./docs

USER node
EXPOSE 3101

CMD ["node", "src/app.js"]
