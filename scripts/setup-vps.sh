#!/bin/bash
set -e

echo "=== BulkMailer VPS Setup Script ==="

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "Docker installed."
else
    echo "Docker already installed."
fi

# Install Docker Compose plugin (comes with Docker now)
docker compose version

# Install git
apt-get install -y git

# Create app directory
mkdir -p /opt/bulk-email-sender
cd /opt/bulk-email-sender

# Clone or pull repo
if [ -d ".git" ]; then
    git pull origin main
else
    git clone https://github.com/pulkitpareek18/Bulk-Email-Sender.git .
fi

# Create production .env if not exists
if [ ! -f ".env" ]; then
    cat > .env << 'ENVEOF'
POSTGRES_DB=bulk_email
POSTGRES_USER=bulk_email_user
POSTGRES_PASSWORD=CHANGE_ME_STRONG_DB_PASSWORD_HERE
JWT_SECRET=CHANGE_ME_JWT_SECRET_AT_LEAST_32_CHARS
JWT_REFRESH_SECRET=CHANGE_ME_REFRESH_SECRET_AT_LEAST_32_CHARS
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD
TRACKING_DOMAIN=https://yeb.mail.intellimix.online
ENVEOF
    echo "Created .env - PLEASE EDIT WITH REAL PASSWORDS before starting!"
    echo "Edit: nano /opt/bulk-email-sender/.env"
fi

# Set up firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "1. Edit /opt/bulk-email-sender/.env with real passwords"
echo "2. Point DNS: yeb.mail.intellimix.online -> $(curl -s ifconfig.me)"
echo "3. Run: cd /opt/bulk-email-sender && docker compose -f docker-compose.prod.yml up -d --build"
echo "4. Run migrations: docker compose -f docker-compose.prod.yml exec server npx node-pg-migrate up --migrations-dir dist/db/migrations --migration-file-language js"
echo "5. Seed admin: docker compose -f docker-compose.prod.yml exec server node dist/db/seeds/001_admin-user.js"
