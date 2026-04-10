FROM docker:26-cli

# Install minimal required utilities in a single layer
RUN apk add --no-cache bash curl openssl

WORKDIR /stack

# Copy only orchestration files, relying on .dockerignore for efficient context
COPY docker-compose.yml .env.example setup.sh ./
COPY scripts ./scripts
COPY configs ./configs
COPY portal ./portal

# Optimized file permissions
RUN chmod +x setup.sh scripts/*.sh

# Entrypoint setup
COPY deploy/manager/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
