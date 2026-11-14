# Node runs the TypeScript source directly, so there's no build stage.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Run as the image's unprivileged "node" user, not root.
USER node
CMD ["node", "src/index.ts"]
