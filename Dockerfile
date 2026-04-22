# ── Stage 1: Build frontend ──
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Build backend ──
FROM rust:1.85-slim AS backend
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
RUN cargo build --release -p cellforge-server

# ── Stage 3: Runtime ──
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    ca-certificates \
    python3 \
    python3-pip \
    bubblewrap \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 cellforge-kernel \
    && useradd -u 1000 -g 1000 -s /usr/sbin/nologin -M cellforge-kernel

# Install ipykernel so there's at least one kernel available
RUN pip3 install --break-system-packages ipykernel && \
    python3 -m ipykernel install --name python3 --display-name "Python 3"

WORKDIR /app

# Copy backend binary
COPY --from=backend /app/target/release/cellforge-server /app/cellforge-server

# Copy frontend dist
COPY --from=frontend /app/frontend/dist /app/dist

# Copy built-in Python modules
COPY crates/cellforge-kernel/python/*.py /app/pylib/

# Default port
EXPOSE 8888

# Data volume for user notebooks + config
VOLUME ["/data"]

ENV CELLFORGE_HOST=0.0.0.0

ENTRYPOINT ["/app/cellforge-server"]
CMD ["--host", "0.0.0.0", "--port", "8888", "--notebook-dir", "/data"]
