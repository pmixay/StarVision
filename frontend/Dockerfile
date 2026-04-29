FROM node:22-alpine

WORKDIR /app

# Copy lockfile first so dependency-only changes don't bust the npm-ci layer.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 3000

# `vite` already binds to 0.0.0.0 with --host; the proxy target is
# rewritten via VITE_API_TARGET so the dev server inside the container
# can reach the backend service in docker-compose.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
