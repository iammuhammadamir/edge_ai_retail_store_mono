# Live Streaming Setup Guide (Jetson Device)

This guide explains how to set up low-latency live streaming on a Jetson device using MediaMTX and Cloudflare Tunnel.

## Architecture

**Production Setup (IP Camera with RTSP):**
```
IP Camera (RTSP) → MediaMTX (LL-HLS) → Cloudflare Tunnel → Web Dashboard
```

**Development Setup (USB Camera):**
```
USB Camera → FFmpeg → MediaMTX (LL-HLS) → Cloudflare Tunnel → Web Dashboard
```

- **MediaMTX**: Lightweight media server that proxies RTSP and serves Low-Latency HLS
- **Cloudflare Tunnel**: Exposes local stream to the internet (no port forwarding needed)

---

## Prerequisites

### 1. Install MediaMTX

```bash
# Download MediaMTX for ARM64 (Jetson)
wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.3/mediamtx_v1.9.3_linux_arm64v8.tar.gz
tar -xzf mediamtx_v1.9.3_linux_arm64v8.tar.gz
sudo mv mediamtx /usr/local/bin/
```

### 2. Install Cloudflare Tunnel (cloudflared)

```bash
# Download cloudflared for ARM64
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared-linux-arm64
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared
```

### 3. Install FFmpeg (only needed for USB cameras or transcoding)

```bash
sudo apt update
sudo apt install ffmpeg
```

### 4. Verify Camera Access

**For IP cameras with RTSP:**
```bash
# Test RTSP stream (replace with your camera's URL)
ffplay rtsp://admin:password@192.168.1.100:554/stream1
```

**For USB cameras (development only):**
```bash
# List video devices
v4l2-ctl --list-devices

# Check camera capabilities
v4l2-ctl -d /dev/video0 --list-formats-ext
```

---

## Configuration Files

Create these files in your home directory (e.g., `/home/jetson/`):

---

## Option A: IP Camera with RTSP (Production)

If your camera provides an RTSP URL directly, use this simpler setup. No FFmpeg needed.

### MediaMTX Configuration (`mediamtx.yml`)

```yaml
# MediaMTX configuration for IP Camera (RTSP source)

authMethod: internal
authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: publish
        path:
      - action: read
        path:

# HLS settings for low latency
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
hlsSegmentMaxSize: 50M
hlsAllowOrigin: '*'

paths:
  cam1:
    # Direct RTSP proxy - replace with your camera's RTSP URL
    source: rtsp://admin:password@192.168.1.100:554/stream1
    sourceOnDemand: yes
    sourceOnDemandCloseAfter: 10s
```

> **Note**: Replace `rtsp://admin:password@192.168.1.100:554/stream1` with your actual camera RTSP URL.

### Common RTSP URL Formats

| Camera Brand | RTSP URL Format |
|--------------|-----------------|
| Hikvision | `rtsp://admin:password@IP:554/Streaming/Channels/101` |
| Dahua | `rtsp://admin:password@IP:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://admin:password@IP:554/axis-media/media.amp` |
| Generic | `rtsp://admin:password@IP:554/stream1` |

### Adjusting Quality (IP Camera)

Most IP cameras have a web interface to configure:
- **Resolution**: 1080p, 720p, 480p, etc.
- **Bitrate**: Lower = less bandwidth
- **FPS**: 15, 20, 25, 30

Access your camera's web interface (usually `http://CAMERA_IP`) to adjust these settings.

---

## Option B: USB Camera (Development/Testing)

Use this when you don't have an IP camera with RTSP.

### 1. Camera Streaming Script (`stream_camera.sh`)

This script controls video quality. Edit the variables to change resolution/fps.

```bash
#!/bin/bash
# Camera streaming script - called by MediaMTX
# ============================================
# EDIT THESE VALUES TO CHANGE VIDEO QUALITY
# ============================================

WIDTH=320      # Resolution width (320, 480, 640, 854)
HEIGHT=180     # Resolution height (180, 270, 360, 480)
FPS=8          # Frames per second (8, 10, 12, 15)
CRF=32         # Quality (25=high quality, 32=low quality/small size)
CAMERA=/dev/video0  # Camera device

# ============================================
# FFmpeg command (Jetson/Linux version)
# ============================================
ffmpeg -f v4l2 -framerate 30 -video_size 1280x720 -i "$CAMERA" \
  -c:v libx264 -preset ultrafast -tune zerolatency -crf $CRF \
  -vf "scale=${WIDTH}:${HEIGHT}" -r $FPS -g $FPS -an \
  -f rtsp rtsp://localhost:8554/cam1
```

Make it executable:
```bash
chmod +x stream_camera.sh
```

### 2. MediaMTX Configuration (`mediamtx.yml`)

```yaml
# MediaMTX configuration for USB Camera

authMethod: internal
authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: publish
        path:
      - action: read
        path:

# HLS settings for low latency
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
hlsSegmentMaxSize: 50M
hlsAllowOrigin: '*'

paths:
  cam1:
    runOnDemand: /home/jetson/stream_camera.sh
    runOnDemandRestart: yes
    runOnDemandCloseAfter: 10s
```

> **Note**: Update the path `/home/jetson/stream_camera.sh` to match your actual location.

---

## Quality Presets Reference

| Preset | Resolution | FPS | CRF | Bandwidth | Use Case |
|--------|------------|-----|-----|-----------|----------|
| **ultra_low** | 320×180 | 8 | 32 | ~30 kbps | Very slow connections |
| **low** | 480×270 | 10 | 30 | ~80 kbps | Slow connections |
| **medium** | 640×360 | 12 | 28 | ~150 kbps | Balanced |
| **high** | 854×480 | 15 | 25 | ~300 kbps | Good connection |

### How to Change Quality

1. Edit `stream_camera.sh`:
   ```bash
   nano ~/stream_camera.sh
   ```

2. Change the values:
   ```bash
   WIDTH=640
   HEIGHT=360
   FPS=12
   CRF=28
   ```

3. Restart MediaMTX:
   ```bash
   pkill -f mediamtx
   mediamtx ~/mediamtx.yml &
   ```

---

## Starting the Stream

### Manual Start

```bash
# Terminal 1: Start MediaMTX
mediamtx ~/mediamtx.yml &

# Terminal 2: Start Cloudflare Tunnel
cloudflared tunnel --url http://localhost:8888

# The tunnel will output a URL like:
# https://random-words-here.trycloudflare.com
```

The stream URL will be:
```
https://random-words-here.trycloudflare.com/cam1/index.m3u8
```

### Startup Script (`start_stream.sh`)

Create a single script to start everything:

```bash
#!/bin/bash
# Start streaming services

LOG_DIR=/var/log/smoothflow
mkdir -p $LOG_DIR

# Kill any existing processes
pkill -f mediamtx
pkill -f cloudflared
sleep 2

# Start MediaMTX
echo "Starting MediaMTX..."
mediamtx ~/mediamtx.yml > $LOG_DIR/mediamtx.log 2>&1 &
sleep 3

# Start Cloudflare Tunnel and capture URL
echo "Starting Cloudflare Tunnel..."
cloudflared tunnel --url http://localhost:8888 2>&1 | tee $LOG_DIR/cloudflare.log &
sleep 10

# Extract and display tunnel URL
TUNNEL_URL=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' $LOG_DIR/cloudflare.log | head -1)
echo ""
echo "=========================================="
echo "Stream is ready!"
echo "=========================================="
echo "Tunnel URL: $TUNNEL_URL"
echo "Stream URL: ${TUNNEL_URL}/cam1/index.m3u8"
echo ""
echo "Update this URL in the database if needed."
echo "=========================================="
```

---

## Auto-Start on Boot (systemd)

### 1. Create MediaMTX Service

```bash
sudo nano /etc/systemd/system/mediamtx.service
```

```ini
[Unit]
Description=MediaMTX Media Server
After=network.target

[Service]
Type=simple
User=jetson
ExecStart=/usr/local/bin/mediamtx /home/jetson/mediamtx.yml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 2. Create Cloudflare Tunnel Service

```bash
sudo nano /etc/systemd/system/cloudflared.service
```

```ini
[Unit]
Description=Cloudflare Tunnel
After=network.target mediamtx.service

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

### 3. Enable Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable mediamtx
sudo systemctl enable cloudflared
sudo systemctl start mediamtx
sudo systemctl start cloudflared
```

### 4. Check Status

```bash
sudo systemctl status mediamtx
sudo systemctl status cloudflared

# View tunnel URL from logs
grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1
```

---

## Updating the Dashboard URL

After starting the tunnel, you need to update the stream URL in the database.

### Option 1: Using curl

```bash
TUNNEL_URL="https://your-tunnel-url.trycloudflare.com"
SUPABASE_KEY="your-service-role-key"

curl -X PATCH "https://dqmkhmxxktycnajtqamh.supabase.co/rest/v1/cameras?id=eq.1" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"stream_url\": \"${TUNNEL_URL}/cam1/index.m3u8\"}"
```

### Option 2: Script to Auto-Update

Add this to your startup script:

```bash
#!/bin/bash
# update_stream_url.sh

SUPABASE_URL="https://dqmkhmxxktycnajtqamh.supabase.co"
SUPABASE_KEY="your-service-role-key"
CAMERA_ID=1

# Wait for tunnel to be ready
sleep 15

# Get tunnel URL from logs
TUNNEL_URL=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1)

if [ -n "$TUNNEL_URL" ]; then
  curl -X PATCH "${SUPABASE_URL}/rest/v1/cameras?id=eq.${CAMERA_ID}" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"stream_url\": \"${TUNNEL_URL}/cam1/index.m3u8\"}"
  echo "Updated stream URL to: ${TUNNEL_URL}/cam1/index.m3u8"
else
  echo "ERROR: Could not find tunnel URL"
fi
```

---

## Multiple Cameras

To stream multiple cameras, add more paths to `mediamtx.yml`:

### IP Cameras (Production)

```yaml
paths:
  cam1:
    source: rtsp://admin:password@192.168.1.100:554/stream1
    sourceOnDemand: yes
    sourceOnDemandCloseAfter: 10s
  
  cam2:
    source: rtsp://admin:password@192.168.1.101:554/stream1
    sourceOnDemand: yes
    sourceOnDemandCloseAfter: 10s
  
  cam3:
    source: rtsp://admin:password@192.168.1.102:554/stream1
    sourceOnDemand: yes
    sourceOnDemandCloseAfter: 10s
```

Stream URLs will be:
- `https://tunnel-url.trycloudflare.com/cam1/index.m3u8`
- `https://tunnel-url.trycloudflare.com/cam2/index.m3u8`
- `https://tunnel-url.trycloudflare.com/cam3/index.m3u8`

---

## Troubleshooting

### RTSP stream not connecting (IP Camera)

```bash
# Test RTSP URL directly
ffplay rtsp://admin:password@192.168.1.100:554/stream1

# Check network connectivity
ping 192.168.1.100

# Verify port is open
nc -zv 192.168.1.100 554
```

### USB Camera not found (Development)

```bash
# List all video devices
ls -la /dev/video*

# Check if camera is recognized
v4l2-ctl --list-devices
```

### Stream not loading

1. Check MediaMTX is running:
   ```bash
   ps aux | grep mediamtx
   ```

2. Test local stream:
   ```bash
   curl http://localhost:8888/cam1/index.m3u8
   ```

3. Check MediaMTX logs for errors:
   ```bash
   journalctl -u mediamtx -f
   ```

### High latency

**For IP cameras:**
- Access camera web interface and reduce resolution/bitrate
- Use the camera's "sub-stream" instead of main stream (lower quality)

**For USB cameras:**
- Reduce resolution and FPS in `stream_camera.sh`
- Increase CRF value (lower quality = faster encoding)

### Tunnel URL not working

1. Verify cloudflared is running:
   ```bash
   ps aux | grep cloudflared
   ```

2. Check logs:
   ```bash
   cat /var/log/cloudflared.log
   ```

### RTSP Authentication Failed

- Verify username/password are correct
- Check if camera requires digest vs basic auth
- Try URL-encoding special characters in password

---

## File Locations Summary

| File | Location | Purpose |
|------|----------|---------|
| `mediamtx.yml` | `~/mediamtx.yml` | MediaMTX server configuration (camera URLs) |
| `stream_camera.sh` | `~/stream_camera.sh` | FFmpeg script (USB cameras only) |
| `start_stream.sh` | `~/start_stream.sh` | Startup script |
| MediaMTX logs | `/var/log/smoothflow/mediamtx.log` | Server logs |
| Cloudflare logs | `/var/log/cloudflared.log` | Tunnel URL and status |

---

## Quick Reference

```bash
# Start streaming
./start_stream.sh

# Stop streaming
pkill -f mediamtx && pkill -f cloudflared

# Restart MediaMTX (after config changes)
pkill -f mediamtx && mediamtx ~/mediamtx.yml &

# Get current tunnel URL
grep -o 'https://[^[:space:]]*\.trycloudflare\.com' /var/log/cloudflared.log | tail -1

# Test RTSP camera
ffplay rtsp://admin:password@192.168.1.100:554/stream1

# Check services
systemctl status mediamtx cloudflared

# View live logs
journalctl -u mediamtx -f
```
