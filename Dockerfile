FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY .env.example ./
EXPOSE 3010
CMD ["node", "src/server.js"]
