FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY demo ./demo
# The demo server (made-up Acme Invoices tools + withSupport) over stdio.
CMD ["npx", "tsx", "demo/server.ts"]
