# Deployment Guide

This document explains how to deploy the ClientBridge system in various environments.

---

## Table of Contents

1. [Local Development](#local-development)
2. [Production Deployment Options](#production-deployment-options)
3. [Docker Deployment](#docker-deployment)
4. [Cloud Deployment (Railway/Render)](#cloud-deployment)
5. [Self-Hosted VPS](#self-hosted-vps)
6. [Edge Device Deployment](#edge-device-deployment)
7. [Environment Variables](#environment-variables)
8. [SSL/HTTPS Setup](#sslhttps-setup)
9. [Troubleshooting](#troubleshooting)

---

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Python 3.9+ (for edge device)

### Quick Start

```bash
# 1. Create database
createdb clientbridge

# 2. Install dependencies
cd ClientBridge
npm install

# 3. Start server
DATABASE_URL="postgresql://localhost:5432/clientbridge" \
SESSION_SECRET="dev-secret" \
EDGE_API_KEY="dev-edge-api-key" \
npm run dev
```

**URLs:**

- Frontend: http://localhost:3001
- Backend API: http://localhost:5000

**Default Login:**

- Username: `manager1`
- Password: `manager1`

---

## Production Deployment Options

| Option                 | Pros                       | Cons                | Cost     |
| ---------------------- | -------------------------- | ------------------- | -------- |
| **Railway**      | Easy, auto-deploy from Git | Limited free tier   | $5-20/mo |
| **Render**       | Free tier, easy setup      | Cold starts on free | $0-25/mo |
| **DigitalOcean** | Full control, reliable     | More setup required | $6-24/mo |
| **Self-hosted**  | Full control, no recurring | Requires hardware   | One-time |

---

## Docker Deployment

### Dockerfile

Create `Dockerfile` in the project root:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Expose port
EXPOSE 5000

# Start server
CMD ["npm", "start"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/clientbridge
      - SESSION_SECRET=${SESSION_SECRET}
      - EDGE_API_KEY=${EDGE_API_KEY}
      - NODE_ENV=production
    depends_on:
      - db

  db:
    image: postgres:14-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=clientbridge
      - POSTGRES_PASSWORD=password

volumes:
  postgres_data:
```

### Deploy with Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop
docker-compose down
```

---

## Cloud Deployment

### Railway

1. **Create Railway account** at https://railway.app
2. **Connect GitHub repo**

   - New Project → Deploy from GitHub repo
   - Select your repository
3. **Add PostgreSQL**

   - New → Database → PostgreSQL
   - Railway auto-sets `DATABASE_URL`
4. **Set environment variables**

   - Go to Variables tab
   - Add:
     ```
     SESSION_SECRET=<generate-random-string>
     EDGE_API_KEY=<your-api-key>
     NODE_ENV=production
     ```
5. **Deploy**

   - Railway auto-deploys on push to main
   - Get your URL from Deployments tab

### Render

1. **Create Render account** at https://render.com
2. **Create Web Service**

   - New → Web Service
   - Connect GitHub repo
   - Settings:
     - Build Command: `npm install && npm run build`
     - Start Command: `npm start`
3. **Create PostgreSQL Database**

   - New → PostgreSQL
   - Copy Internal Database URL
4. **Set environment variables**

   ```
   DATABASE_URL=<internal-database-url>
   SESSION_SECRET=<generate-random-string>
   EDGE_API_KEY=<your-api-key>
   NODE_ENV=production
   ```
5. **Deploy**

   - Click "Create Web Service"
   - Get your URL from dashboard

---

## Self-Hosted VPS

### DigitalOcean / Linode / Vultr

1. **Create VPS**

   - Ubuntu 22.04 LTS
   - 1GB RAM minimum (2GB recommended)
   - 25GB SSD
2. **Initial setup**

   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y

   # Install Node.js 18
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install -y nodejs

   # Install PostgreSQL
   sudo apt install -y postgresql postgresql-contrib

   # Install nginx (reverse proxy)
   sudo apt install -y nginx

   # Install certbot (SSL)
   sudo apt install -y certbot python3-certbot-nginx
   ```
3. **Setup PostgreSQL**

   ```bash
   sudo -u postgres psql
   CREATE DATABASE clientbridge;
   CREATE USER clientbridge WITH PASSWORD 'your-password';
   GRANT ALL PRIVILEGES ON DATABASE clientbridge TO clientbridge;
   \q
   ```
4. **Clone and setup app**

   ```bash
   cd /var/www
   git clone https://github.com/your-repo/ClientBridge.git
   cd ClientBridge
   npm install
   npm run build
   ```
5. **Create systemd service**

   ```bash
   sudo nano /etc/systemd/system/clientbridge.service
   ```

   ```ini
   [Unit]
   Description=ClientBridge Server
   After=network.target postgresql.service

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/ClientBridge
   Environment=NODE_ENV=production
   Environment=DATABASE_URL=postgresql://clientbridge:your-password@localhost:5432/clientbridge
   Environment=SESSION_SECRET=your-secret-key
   Environment=EDGE_API_KEY=your-edge-api-key
   ExecStart=/usr/bin/node dist/index.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
6. **Start service**

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable clientbridge
   sudo systemctl start clientbridge
   ```
7. **Configure nginx**

   ```bash
   sudo nano /etc/nginx/sites-available/clientbridge
   ```

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

   ```bash
   sudo ln -s /etc/nginx/sites-available/clientbridge /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```
8. **Setup SSL**

   ```bash
   sudo certbot --nginx -d your-domain.com
   ```

---

## Edge Device Deployment

### On Jetson Nano

1. **Flash JetPack OS**

   - Download JetPack 4.6+ from NVIDIA
   - Flash to SD card
2. **Install dependencies**

   ```bash
   # Update
   sudo apt update && sudo apt upgrade -y

   # Install Python dependencies
   sudo apt install -y python3-pip python3-venv libopencv-dev

   # Create virtual environment
   cd /home/jetson
   git clone https://github.com/your-repo/Edge_AI_For_Retail_Stores.git
   cd Edge_AI_For_Retail_Stores
   python3 -m venv venv
   source venv/bin/activate

   # Install packages
   pip install opencv-python numpy requests
   pip install onnxruntime  # or onnxruntime-gpu for GPU
   pip install insightface
   ```
3. **Configure**

   ```bash
   nano config.py
   ```

   ```python
   API_BASE_URL = "https://your-server.com"  # Production server URL
   API_KEY = "your-edge-api-key"
   API_LOCATION_ID = 1
   ```
4. **Create systemd service**

   ```bash
   sudo nano /etc/systemd/system/visitor-counter.service
   ```

   ```ini
   [Unit]
   Description=Visitor Counter
   After=network.target

   [Service]
   Type=simple
   User=jetson
   WorkingDirectory=/home/jetson/Edge_AI_For_Retail_Stores
   ExecStart=/home/jetson/Edge_AI_For_Retail_Stores/venv/bin/python visitor_counter.py --camera 0
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```
5. **Start service**

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable visitor-counter
   sudo systemctl start visitor-counter

   # View logs
   journalctl -u visitor-counter -f
   ```

### On Mac (Development/Testing)

```bash
cd Edge_AI_For_Retail_Stores
source venv/bin/activate
python visitor_counter.py --webcam
```

---

## Environment Variables

### Server (Required)

| Variable           | Description                  | Example                                 |
| ------------------ | ---------------------------- | --------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `SESSION_SECRET` | Session encryption key       | Random 32+ char string                  |
| `EDGE_API_KEY`   | API key for edge devices     | Random 32+ char string                  |

### Server (Optional)

| Variable                 | Description        | Default         |
| ------------------------ | ------------------ | --------------- |
| `NODE_ENV`             | Environment mode   | `development` |
| `PORT`                 | Server port        | `5000`        |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA secret   | None            |
| `RECAPTCHA_SITE_KEY`   | reCAPTCHA site key | None            |

### Edge Device

| Variable            | Description                          | Example                     |
| ------------------- | ------------------------------------ | --------------------------- |
| `API_BASE_URL`    | Server URL                           | `https://your-server.com` |
| `API_KEY`         | Must match server's `EDGE_API_KEY` | Same as server              |
| `API_LOCATION_ID` | Store location ID                    | `1`                       |

---

## SSL/HTTPS Setup

### Why HTTPS?

- **Required** for production
- Protects API keys in transit
- Browsers block mixed content

### Options

1. **Let's Encrypt (Free)**

   ```bash
   sudo certbot --nginx -d your-domain.com
   ```
2. **Cloudflare (Free)**

   - Add domain to Cloudflare
   - Enable "Full (strict)" SSL
   - Cloudflare handles certificates
3. **Self-signed (Development only)**

   ```bash
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout server.key -out server.crt
   ```

---

## Troubleshooting

### Server won't start

```bash
# Check if port is in use
lsof -i :5000

# Check PostgreSQL is running
sudo systemctl status postgresql

# Check logs
journalctl -u clientbridge -f
```

### Database connection failed

```bash
# Test connection
psql -h localhost -U clientbridge -d clientbridge

# Check PostgreSQL is accepting connections
sudo nano /etc/postgresql/14/main/pg_hba.conf
# Ensure: local all all md5
```

### Edge device can't connect

```bash
# Test API health
curl https://your-server.com/api/edge/health \
  -H "X-API-Key: your-edge-api-key"

# Check firewall
sudo ufw status
sudo ufw allow 5000
```

### SSL certificate issues

```bash
# Renew Let's Encrypt
sudo certbot renew

# Check certificate
openssl s_client -connect your-domain.com:443
```

### Camera not detected (Jetson)

```bash
# List cameras
ls /dev/video*

# Test camera
gst-launch-1.0 v4l2src device=/dev/video0 ! videoconvert ! autovideosink
```

---

## Monitoring

### Basic Health Check

```bash
# Server health
curl https://your-server.com/health

# Edge API health
curl https://your-server.com/api/edge/health \
  -H "X-API-Key: your-edge-api-key"
```

### Logs

```bash
# Server logs (systemd)
journalctl -u clientbridge -f

# Edge device logs (systemd)
journalctl -u visitor-counter -f

# Nginx access logs
tail -f /var/log/nginx/access.log
```

### Database Stats

```sql
-- Customer count
SELECT COUNT(*) FROM customers;

-- Visits today
SELECT COUNT(*) FROM customers 
WHERE last_seen > NOW() - INTERVAL '1 day';

-- Top visitors
SELECT name, points as visits FROM customers 
ORDER BY points DESC LIMIT 10;
```

---

## Backup

### Database Backup

```bash
# Backup
pg_dump clientbridge > backup_$(date +%Y%m%d).sql

# Restore
psql clientbridge < backup_20241208.sql
```

### Automated Backup (cron)

```bash
crontab -e
```

```
# Daily backup at 2am
0 2 * * * pg_dump clientbridge > /backups/clientbridge_$(date +\%Y\%m\%d).sql
```

---

## Security Checklist

- [ ] Change default passwords
- [ ] Use strong `SESSION_SECRET` (32+ random chars)
- [ ] Use strong `EDGE_API_KEY` (32+ random chars)
- [ ] Enable HTTPS
- [ ] Configure firewall (only expose ports 80, 443)
- [ ] Regular database backups
- [ ] Keep dependencies updated
- [ ] Monitor logs for suspicious activity
