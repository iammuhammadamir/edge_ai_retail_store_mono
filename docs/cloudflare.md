# Cloudflare Tunnel Setup Guide

Complete guide for setting up Cloudflare Tunnel on Jetson devices to expose local services (like MediaMTX) to the internet.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Quick Tunnel (Temporary URL)](#quick-tunnel-temporary-url)
4. [Named Tunnel (Permanent URL)](#named-tunnel-permanent-url)
5. [Running as a Service](#running-as-a-service)
6. [Troubleshooting](#troubleshooting)
7. [Common Errors](#common-errors)
8. [Architecture](#architecture)

---

## Overview

### What is Cloudflare Tunnel?

Cloudflare Tunnel (`cloudflared`) creates a secure outbound connection from your device to Cloudflare's edge network. This allows you to expose local services without:
- Opening firewall ports
- Configuring port forwarding
- Having a public IP address

### Two Types of Tunnels

| Type | URL | Persistence | Auth Required | Use Case |
|------|-----|-------------|---------------|----------|
| **Quick Tunnel** | `https://random-words.trycloudflare.com` | Changes on restart | No | Testing, development |
| **Named Tunnel** | `https://stream.yourdomain.com` | Permanent | Yes (Cloudflare account) | Production |

### Our Use Case

```
MediaMTX (localhost:8888) → cloudflared → Cloudflare Edge → Browser
```

The browser accesses `https://tunnel-url.trycloudflare.com/cam1/index.m3u8` which routes to `http://localhost:8888/cam1/index.m3u8` on the Jetson.

---

## Installation

### Jetson (ARM64 Linux)

```bash
# Download the ARM64 binary
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64

# Make executable
chmod +x cloudflared-linux-arm64

# Move to system path
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared

# Verify installation
cloudflared --version
# Expected: cloudflared version 2024.x.x (built ...)
```

### Alternative: Using Package Manager (Debian/Ubuntu)

```bash
# Add Cloudflare GPG key
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

# Add repository
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

# Install
sudo apt update
sudo apt install cloudflared
```

> **Note**: Package manager method may not have ARM64 packages for all distros. Direct binary download is more reliable for Jetson.

### Verify Network Access

```bash
# Test outbound connectivity to Cloudflare
curl -I https://cloudflare.com

# Test DNS resolution
nslookup argotunnel.com
```

---

## Quick Tunnel (Temporary URL)

The simplest way to expose a local service. No account needed.

### Basic Usage

```bash
# Expose local port 8888
cloudflared tunnel --url http://localhost:8888
```

### Output

```
2024-12-13T03:00:00Z INF Thank you for trying Cloudflare Tunnel...
2024-12-13T03:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2024-12-13T03:00:01Z INF +-----------------------------------------------------------+
2024-12-13T03:00:01Z INF |  Your quick Tunnel has been created! Visit it at:        |
2024-12-13T03:00:01Z INF |  https://objective-outputs-perhaps-prince.trycloudflare.com |
2024-12-13T03:00:01Z INF +-----------------------------------------------------------+
```

The URL `https://objective-outputs-perhaps-prince.trycloudflare.com` is your tunnel.

### Important Notes

- **URL changes every restart** - You'll get a new random URL each time
- **No authentication** - Anyone with the URL can access your service
- **Free** - No Cloudflare account required
- **Rate limited** - Not for high-traffic production use

### Running in Background

```bash
# Run in background with nohup
nohup cloudflared tunnel --url http://localhost:8888 > /var/log/cloudflared.log 2>&1 &

# Or use screen/tmux
screen -dmS cloudflare cloudflared tunnel --url http://localhost:8888
```

### Extracting the URL

```bash
# From log file
grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1

# Example output: https://objective-outputs-perhaps-prince.trycloudflare.com
```

---

## Named Tunnel (Permanent URL)

For production use with a consistent URL. Requires a Cloudflare account and domain.

### Prerequisites

1. **Cloudflare Account** - Free at https://dash.cloudflare.com/sign-up
2. **Domain on Cloudflare** - Either:
   - Transfer an existing domain to Cloudflare, OR
   - Register a new domain through Cloudflare (~$10/year for .com), OR
   - Use a free subdomain service and point it to Cloudflare

### Step 1: Login to Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser. If on a headless Jetson:

```bash
# It will print a URL like:
# Please open the following URL and log in with your Cloudflare account:
# https://dash.cloudflare.com/argotunnel?callback=...

# Copy this URL and open it on any device with a browser
# After logging in, a certificate is saved to ~/.cloudflared/cert.pem
```

### Step 2: Create a Named Tunnel

```bash
# Create tunnel (name it anything)
cloudflared tunnel create smoothflow-stream

# Output:
# Tunnel credentials written to /home/jetson/.cloudflared/<TUNNEL_ID>.json
# Created tunnel smoothflow-stream with id <TUNNEL_ID>
```

Save the **Tunnel ID** - you'll need it.

### Step 3: Create DNS Record

```bash
# Route your subdomain to the tunnel
cloudflared tunnel route dns smoothflow-stream stream.yourdomain.com

# This creates a CNAME record:
# stream.yourdomain.com → <TUNNEL_ID>.cfargotunnel.com
```

### Step 4: Create Config File

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/jetson/.cloudflared/<TUNNEL_ID>.json

ingress:
  # Route all traffic to MediaMTX
  - hostname: stream.yourdomain.com
    service: http://localhost:8888
  
  # Catch-all (required)
  - service: http_status:404
```

### Step 5: Run the Tunnel

```bash
# Run with config file
cloudflared tunnel run smoothflow-stream

# Or run with explicit config path
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

### File Locations (Named Tunnel)

| File | Location | Purpose |
|------|----------|---------|
| Certificate | `~/.cloudflared/cert.pem` | Account authentication |
| Credentials | `~/.cloudflared/<TUNNEL_ID>.json` | Tunnel authentication |
| Config | `~/.cloudflared/config.yml` | Tunnel routing rules |

---

## Running as a Service

### systemd Service (Recommended)

Create `/etc/systemd/system/cloudflared.service`:

#### For Quick Tunnel:

```ini
[Unit]
Description=Cloudflare Tunnel (Quick)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=jetson
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:8888
Restart=always
RestartSec=10
StandardOutput=append:/var/log/cloudflared.log
StandardError=append:/var/log/cloudflared.log

[Install]
WantedBy=multi-user.target
```

#### For Named Tunnel:

```ini
[Unit]
Description=Cloudflare Tunnel (Named)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=jetson
ExecStart=/usr/local/bin/cloudflared tunnel --config /home/jetson/.cloudflared/config.yml run
Restart=always
RestartSec=10
StandardOutput=append:/var/log/cloudflared.log
StandardError=append:/var/log/cloudflared.log

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable on boot
sudo systemctl enable cloudflared

# Start now
sudo systemctl start cloudflared

# Check status
sudo systemctl status cloudflared
```

### View Logs

```bash
# Real-time logs
journalctl -u cloudflared -f

# Or from log file
tail -f /var/log/cloudflared.log
```

---

## Troubleshooting

### 1. "failed to connect to edge" or "connection refused"

**Cause**: Network connectivity issues

**Fix**:
```bash
# Check internet connectivity
ping -c 3 cloudflare.com

# Check DNS
nslookup argotunnel.com

# Check if port 443 outbound is blocked
curl -v https://cloudflare.com
```

### 2. "error="Unable to reach the origin service"

**Cause**: The local service (MediaMTX) isn't running

**Fix**:
```bash
# Check if MediaMTX is running
ps aux | grep mediamtx

# Check if port 8888 is listening
ss -tlnp | grep 8888
# or
netstat -tlnp | grep 8888

# Test local access
curl http://localhost:8888/cam1/index.m3u8
```

### 3. "context deadline exceeded"

**Cause**: Slow network or DNS issues

**Fix**:
```bash
# Try with explicit protocol
cloudflared tunnel --protocol http2 --url http://localhost:8888

# Or try QUIC
cloudflared tunnel --protocol quic --url http://localhost:8888
```

### 4. "certificate has expired" or "x509: certificate signed by unknown authority"

**Cause**: System time is wrong or cert issues

**Fix**:
```bash
# Check system time
date

# Sync time
sudo timedatectl set-ntp true

# Or manually
sudo ntpdate pool.ntp.org

# For named tunnels, re-login
cloudflared tunnel login
```

### 5. "tunnel credentials file not found"

**Cause**: Missing credentials for named tunnel

**Fix**:
```bash
# Check if credentials exist
ls -la ~/.cloudflared/

# Re-create tunnel if needed
cloudflared tunnel delete smoothflow-stream
cloudflared tunnel create smoothflow-stream
```

### 6. Quick tunnel URL not appearing in logs

**Cause**: Log buffering or wrong log location

**Fix**:
```bash
# Run in foreground to see output directly
cloudflared tunnel --url http://localhost:8888

# Or flush logs
cloudflared tunnel --url http://localhost:8888 2>&1 | tee /var/log/cloudflared.log
```

### 7. "bind: address already in use"

**Cause**: Another cloudflared instance is running

**Fix**:
```bash
# Kill existing instances
pkill -f cloudflared

# Check for processes
ps aux | grep cloudflared
```

---

## Common Errors

### Error Reference Table

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `failed to connect to edge` | No internet | Check network connectivity |
| `Unable to reach the origin service` | Local service not running | Start MediaMTX first |
| `context deadline exceeded` | Slow network | Try different protocol |
| `certificate has expired` | Wrong system time | Sync NTP |
| `tunnel credentials file not found` | Missing credentials | Re-login or re-create tunnel |
| `bind: address already in use` | Duplicate process | Kill existing cloudflared |
| `no such host` | DNS resolution failed | Check DNS settings |
| `connection reset by peer` | Firewall blocking | Check outbound 443 |

### Debug Mode

```bash
# Run with verbose logging
cloudflared tunnel --loglevel debug --url http://localhost:8888

# Log levels: debug, info, warn, error, fatal
```

---

## Architecture

### How Cloudflare Tunnel Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           JETSON DEVICE                                  │
│                                                                          │
│  ┌──────────────┐         ┌──────────────────────────────────────────┐  │
│  │  MediaMTX    │◄───────►│  cloudflared                             │  │
│  │  :8888       │  HTTP   │  (outbound connection to Cloudflare)     │  │
│  └──────────────┘         └──────────────────────────────────────────┘  │
│                                        │                                 │
└────────────────────────────────────────┼─────────────────────────────────┘
                                         │ Outbound HTTPS/QUIC (port 443)
                                         │ (No inbound ports needed!)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE EDGE NETWORK                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Tunnel Endpoint                                                  │   │
│  │  - Receives requests for your tunnel URL                         │   │
│  │  - Forwards to your cloudflared instance                         │   │
│  │  - Handles TLS termination                                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                         ▲
                                         │ HTTPS
                                         │
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                     │
│                                                                          │
│  https://random-words.trycloudflare.com/cam1/index.m3u8                 │
│  or                                                                      │
│  https://stream.yourdomain.com/cam1/index.m3u8                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Points

1. **Outbound Only**: cloudflared makes outbound connections to Cloudflare. No inbound ports needed.
2. **TLS Everywhere**: Traffic is encrypted end-to-end.
3. **No Public IP Needed**: Works behind NAT, firewalls, CGNAT.
4. **Automatic Reconnection**: cloudflared reconnects if connection drops.

### Ports Used

| Direction | Port | Protocol | Purpose |
|-----------|------|----------|---------|
| Outbound | 443 | HTTPS/QUIC | Tunnel connection to Cloudflare |
| Local | 8888 | HTTP | MediaMTX HLS server |

---

## Quick Reference

### Commands Cheat Sheet

```bash
# === INSTALLATION ===
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared-linux-arm64
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared

# === QUICK TUNNEL ===
# Start (foreground)
cloudflared tunnel --url http://localhost:8888

# Start (background)
nohup cloudflared tunnel --url http://localhost:8888 > /var/log/cloudflared.log 2>&1 &

# Get URL from logs
grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1

# === NAMED TUNNEL ===
cloudflared tunnel login
cloudflared tunnel create smoothflow-stream
cloudflared tunnel route dns smoothflow-stream stream.yourdomain.com
cloudflared tunnel run smoothflow-stream

# === SERVICE MANAGEMENT ===
sudo systemctl start cloudflared
sudo systemctl stop cloudflared
sudo systemctl status cloudflared
sudo systemctl restart cloudflared
journalctl -u cloudflared -f

# === DEBUGGING ===
cloudflared tunnel --loglevel debug --url http://localhost:8888
ps aux | grep cloudflared
pkill -f cloudflared
curl http://localhost:8888/cam1/index.m3u8
```

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `TUNNEL_TOKEN` | Auth token for named tunnels | Used with `cloudflared tunnel run --token` |
| `NO_AUTOUPDATE` | Disable auto-update | `NO_AUTOUPDATE=true` |

### File Locations

| File | Path | Purpose |
|------|------|---------|
| Binary | `/usr/local/bin/cloudflared` | Executable |
| Certificate | `~/.cloudflared/cert.pem` | Account auth (named tunnels) |
| Credentials | `~/.cloudflared/<ID>.json` | Tunnel auth (named tunnels) |
| Config | `~/.cloudflared/config.yml` | Tunnel routing (named tunnels) |
| Logs | `/var/log/cloudflared.log` | Runtime logs |
| Service | `/etc/systemd/system/cloudflared.service` | systemd unit |

---

## Integration with MediaMTX

### Startup Order

1. **Start MediaMTX first** (must be listening on port 8888)
2. **Then start cloudflared** (connects to localhost:8888)

### Combined Startup Script

```bash
#!/bin/bash
# /home/jetson/start_stream.sh

# Start MediaMTX
echo "Starting MediaMTX..."
mediamtx /home/jetson/mediamtx.yml > /var/log/mediamtx.log 2>&1 &
sleep 3

# Verify MediaMTX is running
if ! curl -s http://localhost:8888 > /dev/null; then
    echo "ERROR: MediaMTX failed to start"
    exit 1
fi

# Start Cloudflare Tunnel
echo "Starting Cloudflare Tunnel..."
cloudflared tunnel --url http://localhost:8888 > /var/log/cloudflared.log 2>&1 &
sleep 5

# Extract and display URL
TUNNEL_URL=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1)
echo "Stream available at: ${TUNNEL_URL}/cam1/index.m3u8"
```

### Updating Database with Tunnel URL

```bash
#!/bin/bash
# /home/jetson/update_stream_url.sh

SUPABASE_URL="https://dqmkhmxxktycnajtqamh.supabase.co"
SUPABASE_KEY="your-service-role-key"
CAMERA_ID=1

# Get tunnel URL
TUNNEL_URL=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1)

if [ -z "$TUNNEL_URL" ]; then
    echo "ERROR: No tunnel URL found"
    exit 1
fi

# Update database
curl -X PATCH "${SUPABASE_URL}/rest/v1/cameras?id=eq.${CAMERA_ID}" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"stream_url\": \"${TUNNEL_URL}/cam1/index.m3u8\"}"

echo "Updated camera ${CAMERA_ID} stream URL to: ${TUNNEL_URL}/cam1/index.m3u8"
```
