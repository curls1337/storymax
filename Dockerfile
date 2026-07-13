# Use the official Microsoft Playwright image with dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install all dependencies
RUN npm install
RUN npm install --prefix backend
RUN npm install --prefix frontend

# Copy the rest of the application files
COPY . .

# Build the frontend production files
RUN npm run build --prefix frontend

# Expose the default backend port
EXPOSE 5022

# Start the application using server.js
CMD ["npm", "run", "start"]
