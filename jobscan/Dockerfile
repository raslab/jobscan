FROM node:22-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Runtime
EXPOSE 3050
CMD ["node", "dist/index.js"]
