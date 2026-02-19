FROM node:lts-bookworm-slim

# 1. Install system dependencies
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      fontconfig \
      fonts-dejavu-core \
      fonts-freefont-ttf \
      fonts-noto-core \
      bash \
      openssh-server \
      git \
      lsof \
      ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# 2. Configure SSH for public-key auth only
RUN set -eux; \
    mkdir -p /var/run/sshd /root/.ssh; \
    chmod 700 /root/.ssh; \
    sed -ri 's/^#?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config; \
    sed -ri 's/^#?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config; \
    sed -ri 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config; \
    if ! grep -q '^AuthorizedKeysFile' /etc/ssh/sshd_config; then \
      echo 'AuthorizedKeysFile .ssh/authorized_keys' >> /etc/ssh/sshd_config; \
    fi

# 3. App directory
WORKDIR /app/nanopi2-dashboard

# 4. Install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# 5. Copy app source
COPY . .

# 6. Entrypoint script
RUN cat > /entrypoint.sh <<'SH' && chmod +x /entrypoint.sh
#!/bin/sh
set -eu

# Create runtime dir and host keys if needed
mkdir -p /run/sshd
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
  ssh-keygen -A
fi

# Start SSH daemon in background
/usr/sbin/sshd

# Disable core dumps to avoid large crash files
ulimit -c 0 || true

cd /app/nanopi2-dashboard
chmod +x /app/nanopi2-dashboard/start-server.sh

# Run app as PID 1 for proper signal handling
exec /app/nanopi2-dashboard/start-server.sh
SH

EXPOSE 22 3000

ENTRYPOINT ["/entrypoint.sh"]