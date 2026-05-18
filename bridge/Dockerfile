FROM node:24-alpine
RUN apk add --no-cache tini wget
WORKDIR /app

# Copy all monorepo files (needed for file: dependencies)
COPY bridge/package*.json ./bridge/
COPY modules/ ./modules/
COPY bridge/src/ ./bridge/src/
COPY bridge/test/ ./bridge/test/
COPY .github/ ./.github/

# Install bridge dependencies (resolves file: links to modules/)
RUN cd bridge && npm ci --only=production 2>/dev/null || npm install --production

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "bridge/src/main.js", "--headless"]
