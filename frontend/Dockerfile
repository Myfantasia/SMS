# --- Stage 1: build the React app ---
FROM node:22-alpine AS build

WORKDIR /app

# Copy only the manifest files first so `npm install`'s layer is cached
# whenever package.json/package-lock.json haven't changed.
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Stage 2: serve the compiled static files with nginx ---
FROM nginx:1.27-alpine

# Vite's build output (dist/) is copied out of the "build" stage above —
# the Node toolchain and source code never make it into this final image.
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
