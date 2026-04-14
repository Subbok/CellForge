#!/usr/bin/env bash
set -euo pipefail

# All reads use /dev/tty so the script works with curl|bash

echo "=== CellForge Docker Setup ==="
echo ""

# --- Step 1: Choose kernels ---
echo "Which kernels? (comma-separated, e.g. 2,4)"
echo ""
echo "  [1] Python        (ipykernel — always included)"
echo "  [2] R             (IRkernel)"
echo "  [3] Julia          (IJulia)"
echo "  [4] JavaScript    (ijavascript)"
echo "  [5] Kotlin        (kotlin-jupyter)"
echo "  [6] Ruby           (iruby)"
echo ""
echo "  [a] Python only    [b] All"
echo ""
read -rp "Choice [a]: " choice </dev/tty
choice=${choice:-a}

R=false; JULIA=false; JS=false; KOTLIN=false; RUBY=false

case "$choice" in
  a|1) ;;
  b)   R=true; JULIA=true; JS=true; KOTLIN=true; RUBY=true ;;
  *)
    IFS=',' read -ra picks <<< "$choice"
    for p in "${picks[@]}"; do
      case "$(echo "$p" | tr -d ' ')" in
        2) R=true ;; 3) JULIA=true ;; 4) JS=true ;;
        5) KOTLIN=true ;; 6) RUBY=true ;;
      esac
    done ;;
esac

read -rp "Port [8888]: " port </dev/tty
port=${port:-8888}

read -rp "Notebook directory [~/notebooks]: " nb_dir </dev/tty
nb_dir=${nb_dir:-~/notebooks}

selected="Python"
$R && selected="$selected, R";        $JULIA && selected="$selected, Julia"
$JS && selected="$selected, JavaScript"; $KOTLIN && selected="$selected, Kotlin"
$RUBY && selected="$selected, Ruby"

# --- Generate inline Dockerfile inside docker-compose.yml ---
{
cat << HEADER
services:
  cellforge:
    build:
      context: .
      dockerfile_inline: |
        FROM debian:bookworm-slim

        ADD https://github.com/Subbok/CellForge/releases/latest/download/cellforge-linux-x64 /usr/local/bin/cellforge-server
        RUN chmod +x /usr/local/bin/cellforge-server

        RUN apt-get update && apt-get install -y --no-install-recommends \\
            python3 python3-pip python3-venv ca-certificates \\
            && rm -rf /var/lib/apt/lists/* \\
            && python3 -m pip install --break-system-packages ipykernel
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
            default-jdk wget unzip \
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

        EXPOSE 8888
        WORKDIR /data
        ENTRYPOINT ["cellforge-server", "--host", "0.0.0.0"]
    ports:
      - "${port}:8888"
    volumes:
      - ${nb_dir}:/data
    restart: unless-stopped
FOOTER
} > docker-compose.yml

echo ""
echo "Saved: ./docker-compose.yml (kernels: $selected)"
echo ""
echo "Run:"
echo "  docker compose up -d"
echo "  open http://localhost:$port"
