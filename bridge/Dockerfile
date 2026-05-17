FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:24-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3800
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/main.js", "--headless", "--port=3800"]
