FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Release tag (e.g. v0.73) is separate from the binary patch version (e.g. v0.73.4).
# GitHub URL uses the tag; the filename uses the full patch version.
ARG VELO_TAG=v0.73
ARG VELO_VERSION=v0.73.4
RUN curl -fL -o /usr/local/bin/velociraptor \
    "https://github.com/Velocidex/velociraptor/releases/download/${VELO_TAG}/velociraptor-${VELO_VERSION}-linux-amd64" \
    && chmod +x /usr/local/bin/velociraptor \
    && /usr/local/bin/velociraptor version

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
