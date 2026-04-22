#!/usr/bin/env bash
set -euo pipefail

# All reads use /dev/tty so the script works with curl|bash

echo "=== CellForge Docker Setup ==="
echo ""

# --- Step 1: GPU / DL frameworks? ---
echo "Need a GPU (PyTorch + TensorFlow) kernel?"
echo ""
echo "  [y] Yes — cellforge-server-ai base (~8 GB, amd64 only, GPU)"
echo "  [n] No  — cellforge-server base (~2 GB, amd64 + arm64, no DL)"
echo ""
read -rp "Choice [n]: " gpu </dev/tty
gpu=${gpu:-n}

# Resolve the latest stable release tag so the generated compose pins a
# specific version instead of tracking :latest. Falls back to :latest if
# GitHub is unreachable (offline install, API rate limit, etc.).
resolve_release_tag() {
  local raw
  raw=$(curl -fsSL --max-time 5 \
        "https://api.github.com/repos/Subbok/CellForge/releases/latest" 2>/dev/null \
        | grep '"tag_name"' | head -1 \
        | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  if [ -z "$raw" ]; then
    echo "latest"
  else
    # docker image tags are published without the 'v' prefix (semver pattern)
    echo "${raw#v}"
  fi
}

RESOLVED_TAG=$(resolve_release_tag)

case "$gpu" in
  y|Y|yes)
    BASE="ghcr.io/subbok/cellforge-server-ai:${RESOLVED_TAG}"
    NEED_GPU=true
    ;;
  *)
    BASE="ghcr.io/subbok/cellforge-server:${RESOLVED_TAG}"
    NEED_GPU=false
    ;;
esac

# --- Step 2: Extra kernels on top of Python ---
echo ""
echo "Extra kernels on top of the bundled Python? (comma-separated, e.g. 1,3)"
echo ""
echo "  [1] R             (IRkernel)"
echo "  [2] Julia         (IJulia)"
echo "  [3] JavaScript    (ijavascript)"
echo "  [4] Kotlin        (kotlin-jupyter)"
echo "  [5] Ruby          (iruby)"
echo ""
echo "  [n] None — just Python    [a] All"
echo ""
read -rp "Choice [n]: " choice </dev/tty
choice=${choice:-n}

R=false; JULIA=false; JS=false; KOTLIN=false; RUBY=false

case "$choice" in
  n) ;;
  a) R=true; JULIA=true; JS=true; KOTLIN=true; RUBY=true ;;
  *)
    IFS=',' read -ra picks <<< "$choice"
    for p in "${picks[@]}"; do
      case "$(echo "$p" | tr -d ' ')" in
        1) R=true ;; 2) JULIA=true ;; 3) JS=true ;;
        4) KOTLIN=true ;; 5) RUBY=true ;;
      esac
    done ;;
esac

# --- Step 3: Port, notebook directory, optional CORS origin ---
read -rp "Port [8888]: " port </dev/tty
port=${port:-8888}

read -rp "Notebook directory [~/notebooks]: " nb_dir </dev/tty
nb_dir=${nb_dir:-~/notebooks}

echo ""
echo "Access URL for the browser (e.g. https://notebooks.example.com)."
echo "Leave empty if you only ever open CellForge via http://localhost:${port}."
read -rp "Extra allowed origin: " origin </dev/tty
origin=${origin:-}

kernel_list="Python"
$R && kernel_list="$kernel_list, R"
$JULIA && kernel_list="$kernel_list, Julia"
$JS && kernel_list="$kernel_list, JavaScript"
$KOTLIN && kernel_list="$kernel_list, Kotlin"
$RUBY && kernel_list="$kernel_list, Ruby"

# --- Generate docker-compose.yml with an inline Dockerfile ---
{
cat << HEADER
services:
  cellforge:
    build:
      context: .
      dockerfile_inline: |
        FROM ${BASE}
HEADER

if $R; then cat << 'BLOCK'

        RUN apt-get update && apt-get install -y --no-install-recommends \
            r-base r-base-dev libcurl4-openssl-dev libssl-dev \
            && rm -rf /var/lib/apt/lists/* \
            && R -e "install.packages('IRkernel', repos='https://cloud.r-project.org'); IRkernel::installspec(user=FALSE)"
BLOCK
fi

if $JULIA; then cat << 'BLOCK'

        RUN apt-get update && apt-get install -y --no-install-recommends wget \
            && wget -q https://julialang-s3.julialang.org/bin/linux/x64/1.11/julia-1.11.2-linux-x86_64.tar.gz \
            && tar -xzf julia-*.tar.gz -C /opt \
            && rm julia-*.tar.gz \
            && ln -s /opt/julia-*/bin/julia /usr/local/bin/julia \
            && julia -e 'using Pkg; Pkg.add("IJulia")' \
            && rm -rf /var/lib/apt/lists/*
BLOCK
fi

if $JS; then cat << 'BLOCK'

        RUN apt-get update && apt-get install -y --no-install-recommends \
            nodejs npm \
            && rm -rf /var/lib/apt/lists/* \
            && npm install -g ijavascript \
            && ijsinstall --install=global
BLOCK
fi

if $KOTLIN; then cat << 'BLOCK'

        RUN apt-get update && apt-get install -y --no-install-recommends \
            default-jdk \
            && rm -rf /var/lib/apt/lists/* \
            && python3 -m pip install --break-system-packages kotlin-jupyter-kernel
BLOCK
fi

if $RUBY; then cat << 'BLOCK'

        RUN apt-get update && apt-get install -y --no-install-recommends \
            ruby ruby-dev libtool libffi-dev libzmq3-dev \
            && rm -rf /var/lib/apt/lists/* \
            && gem install iruby \
            && iruby register --force
BLOCK
fi

cat << FOOTER
    ports:
      - "${port}:8888"
    volumes:
      - ${nb_dir}:/data
    restart: unless-stopped
FOOTER

if [ -n "$origin" ]; then
cat << ORIGIN
    environment:
      CELLFORGE_ALLOWED_ORIGINS: ${origin}
ORIGIN
fi

if $NEED_GPU; then
cat << 'GPU_BLOCK'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
GPU_BLOCK
fi
} > docker-compose.yml

echo ""
echo "Saved: ./docker-compose.yml"
echo "  base:    $BASE"
[ "$RESOLVED_TAG" = "latest" ] && echo "           (warning: could not resolve release tag, pinned to :latest)"
echo "  kernels: $kernel_list"
[ -n "$origin" ] && echo "  origin:  $origin"
$NEED_GPU && echo "  gpu:     nvidia (all devices)"
echo ""
echo "Run:"
echo "  docker compose up -d"
echo "  open http://localhost:${port}"
