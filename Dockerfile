# Use the official Microsoft Playwright image with dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Set working directory
WORKDIR /app

# Copy the application files
COPY . .

# Clean up any host-side lockfiles or node_modules that might have been copied
RUN rm -rf package-lock.json backend/package-lock.json frontend/package-lock.json node_modules backend/node_modules frontend/node_modules

# Install all dependencies on the clean Linux container
RUN npm install --no-audit --no-fund
RUN npm install --prefix backend --no-audit --no-fund
RUN npm install --prefix frontend --no-audit --no-fund
RUN npm install --prefix frontend @rolldown/binding-linux-x64-gnu --no-audit --no-fund

# Build the frontend production files
RUN npm run build --prefix frontend

# Expose the default backend port
EXPOSE 5022

# Start the application using server.js
CMD ["npm", "run", "start"]
