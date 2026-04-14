#!/usr/bin/env bash
set -euo pipefail

echo "=== CellForge Docker Setup ==="
echo ""
echo "Select which kernels to include:"
echo ""
echo "  [1] Python only (smallest, ~500 MB)"
echo "  [2] Python + R"
echo "  [3] Python + Julia"
echo "  [4] Python + R + Julia (full, ~1.5 GB)"
echo "  [5] Custom (you pick)"
echo ""
read -rp "Choice [1]: " choice
choice=${choice:-1}

PYTHON=true
R=false
JULIA=false

case "$choice" in
  2) R=true ;;
  3) JULIA=true ;;
  4) R=true; JULIA=true ;;
  5)
    read -rp "Include R kernel? [y/N]: " yn
    [[ "$yn" =~ ^[Yy] ]] && R=true
    read -rp "Include Julia kernel? [y/N]: " yn
    [[ "$yn" =~ ^[Yy] ]] && JULIA=true
    ;;
esac

read -rp "Port [8888]: " port
port=${port:-8888}

read -rp "Notebook directory [~/notebooks]: " nb_dir
nb_dir=${nb_dir:-~/notebooks}
nb_dir="${nb_dir/#\~/$HOME}"
mkdir -p "$nb_dir"

echo ""
echo "Building CellForge Docker image..."
echo "  Python: $PYTHON"
echo "  R:      $R"
echo "  Julia:  $JULIA"
echo "  Port:   $port"
echo "  Dir:    $nb_dir"
echo ""

# Generate Dockerfile
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/Dockerfile" << 'DEOF'
# --- Stage 1: Build frontend ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Build backend ---
FROM rust:1.85-bookworm AS backend
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY --from=frontend /app/frontend/dist frontend/dist
RUN cargo build --release -p cellforge-server --features embed-frontend

# --- Stage 3: Runtime ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages ipykernel
DEOF

if $R; then
  cat >> "$TMPDIR/Dockerfile" << 'REOF'

RUN apt-get update && apt-get install -y --no-install-recommends \
    r-base r-base-dev libcurl4-openssl-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && R -e "install.packages('IRkernel', repos='https://cloud.r-project.org'); IRkernel::installspec(user=FALSE)"
REOF
fi

if $JULIA; then
  cat >> "$TMPDIR/Dockerfile" << 'JEOF'

RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && wget -q https://julialang-s3.julialang.org/bin/linux/x64/1.11/julia-1.11.2-linux-x86_64.tar.gz \
    && tar -xzf julia-*.tar.gz -C /opt \
    && rm julia-*.tar.gz \
    && ln -s /opt/julia-*/bin/julia /usr/local/bin/julia \
    && julia -e 'using Pkg; Pkg.add("IJulia")' \
    && rm -rf /var/lib/apt/lists/*
JEOF
fi

cat >> "$TMPDIR/Dockerfile" << 'EEOF'

COPY --from=backend /app/target/release/cellforge-server /usr/local/bin/cellforge-server
EXPOSE 8888
WORKDIR /data
ENTRYPOINT ["cellforge-server", "--host", "0.0.0.0"]
EEOF

# Build
docker build -t cellforge -f "$TMPDIR/Dockerfile" .
rm -rf "$TMPDIR"

echo ""
echo "Done! Starting CellForge..."
echo ""
echo "  http://localhost:$port"
echo ""

docker run -it --rm -p "$port:8888" -v "$nb_dir:/data" cellforge
