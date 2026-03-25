# Stage 1: Build
FROM node:20-alpine as builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Run
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev && \
    mkdir -p /app/logs && \
    chown -R node:node /app
COPY --from=builder /app/dist ./dist
USER node

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
