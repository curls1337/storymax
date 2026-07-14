# Use the official Microsoft Playwright image with dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Remove Windows-generated package-lock.json files to force fresh resolution for Linux
RUN rm -f package-lock.json backend/package-lock.json frontend/package-lock.json

# Install all dependencies (adding flags to bust Docker layer cache)
RUN npm install --no-audit --no-fund
RUN npm install --prefix backend --no-audit --no-fund
RUN npm install --prefix frontend --no-audit --no-fund
RUN npm install --prefix frontend @rolldown/binding-linux-x64-gnu --no-audit --no-fund

# Copy the rest of the application files
COPY . .

# Build the frontend production files
RUN npm run build --prefix frontend

# Expose the default backend port
EXPOSE 5022

# Start the application using server.js
CMD ["npm", "run", "start"]
