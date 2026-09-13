FROM node:20-alpine

# Install python3, ffmpeg, and curl/ca-certificates needed for yt-dlp
RUN apk add --no-cache \
    python3 \
    ffmpeg \
    curl \
    ca-certificates

# Install latest yt-dlp standalone binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package descriptors first for Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Ensure data directory exists
RUN mkdir -p /app/data /app/data/downloads /app/data/cookies

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
