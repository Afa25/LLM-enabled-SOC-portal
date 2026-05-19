FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Pin to a specific release to avoid build-time API rate limiting
ARG VELO_VERSION=v0.76.5
RUN curl -L -o /usr/local/bin/velociraptor \
    "https://github.com/Velocidex/velociraptor/releases/download/v0.76/velociraptor-${VELO_VERSION}-linux-amd64" \
    && chmod +x /usr/local/bin/velociraptor

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
