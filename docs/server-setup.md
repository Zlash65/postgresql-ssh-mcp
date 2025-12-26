# Deployment Guide

This guide walks you through deploying the PostgreSQL SSH MCP server on a Linux server with HTTPS.

---

## Prerequisites

- A Linux server (Ubuntu 22.04/24.04 recommended) — AWS EC2, DigitalOcean, Linode, etc.
- A registered domain name
- Firewall allowing ports 22 (SSH), 80 (HTTP), and 443 (HTTPS)
- PostgreSQL database (RDS or self-hosted)
- Auth0 configured (complete [ChatGPT Setup Guide](chatgpt-setup.md) Steps 3.1-3.6 first)

---

## Step 1: Configure DNS

Create an A record pointing your domain to your server:

| Type | Name | Value |
|------|------|-------|
| A | your-subdomain | Server Public IP |

Verify DNS propagation:

```bash
nslookup your-subdomain.example.com
```

---

## Step 2: Connect to Server

```bash
ssh -i your-key.pem ubuntu@your-server-ip
```

---

## Step 3: Install Dependencies

Update system packages:

```bash
sudo apt update && sudo apt upgrade -y
```

Install Node.js via nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
```

Install nginx and Certbot:

```bash
sudo apt install -y nginx
sudo apt install -y certbot python3-certbot-nginx
```

---

## Step 4: Configure nginx

Create nginx configuration:

```bash
sudo vim /etc/nginx/sites-available/mcp
```

Add the following (replace `your-subdomain.example.com` with your domain):

```nginx
server {
    listen 80;
    server_name your-subdomain.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

Enable the site and reload nginx:

```bash
sudo ln -s /etc/nginx/sites-available/mcp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 5: Obtain SSL Certificate

Run Certbot to obtain and configure SSL:

```bash
sudo certbot --nginx -d your-subdomain.example.com
```

Verify auto-renewal is configured:

```bash
sudo certbot renew --dry-run
```

Certbot automatically updates your nginx config with SSL settings.

---

## Step 6: Install MCP Server

Create app directory:

```bash
sudo mkdir -p /opt/mcp-server
sudo chown ubuntu:ubuntu /opt/mcp-server
```

Clone and build:

```bash
cd /opt/mcp-server
git clone https://github.com/zlash65/postgresql-ssh-mcp.git
cd postgresql-ssh-mcp
npm install
npm run build
```

---

## Step 7: Configure Environment

Create environment file:

```bash
vim /opt/mcp-server/postgresql-ssh-mcp/.env
```

Add your configuration:

```bash
# Database
DATABASE_URI=postgresql://user:password@your-db-host:5432/your-database
DATABASE_SSL=false
READ_ONLY=true

# SSH Tunnel (optional - uncomment if database is behind bastion)
# SSH_ENABLED=true
# SSH_HOST=bastion.example.com
# SSH_USER=ubuntu
# SSH_PRIVATE_KEY_PATH=/home/ubuntu/.ssh/id_rsa

# Query Settings
QUERY_TIMEOUT=30000
MAX_ROWS=1000

# HTTP Server
MCP_HOST=0.0.0.0
MCP_SESSION_TTL_MINUTES=30

# Auth0
MCP_AUTH_MODE=oauth
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_AUDIENCE=https://your-subdomain.example.com/mcp
```

---

## Step 8: Create systemd Service

Create service file:

```bash
sudo vim /etc/systemd/system/postgresql-ssh-mcp.service
```

Add the following (update Node.js path if different):

```ini
[Unit]
Description=PostgreSQL SSH MCP Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mcp-server/postgresql-ssh-mcp
EnvironmentFile=/opt/mcp-server/postgresql-ssh-mcp/.env
Environment=PATH=/home/ubuntu/.nvm/versions/node/v22.21.1/bin:/usr/bin:/bin
ExecStart=/home/ubuntu/.nvm/versions/node/v22.21.1/bin/node /opt/mcp-server/postgresql-ssh-mcp/dist/http.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

> **Note:** Check your Node.js path with `which node` and update the service file accordingly.

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable postgresql-ssh-mcp
sudo systemctl start postgresql-ssh-mcp
```

---

## Step 9: Verify Deployment

Check service status:

```bash
sudo systemctl status postgresql-ssh-mcp
```

View logs:

```bash
sudo journalctl -u postgresql-ssh-mcp -f
```

Test health endpoint:

```bash
curl https://your-subdomain.example.com/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-12-27T...",
  "version": "1.x.x"
}
```

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `sudo systemctl status postgresql-ssh-mcp` | Check service status |
| `sudo systemctl restart postgresql-ssh-mcp` | Restart service |
| `sudo systemctl stop postgresql-ssh-mcp` | Stop service |
| `sudo journalctl -u postgresql-ssh-mcp -f` | View live logs |
| `sudo journalctl -u postgresql-ssh-mcp --since "1 hour ago"` | View recent logs |
| `sudo nginx -t` | Test nginx config |
| `sudo systemctl reload nginx` | Reload nginx |
| `sudo certbot renew` | Renew SSL certificate |

---

## Next Steps

1. **Connect ChatGPT** — Complete Step 4 in the [ChatGPT Setup Guide](chatgpt-setup.md) to add your MCP server
2. **Monitor** — Set up monitoring for your server (e.g., UptimeRobot, Datadog)
