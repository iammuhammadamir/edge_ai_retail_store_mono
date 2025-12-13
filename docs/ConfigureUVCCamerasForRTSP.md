# Configure UVC/USB Cameras for RTSP Streaming

This guide explains how to expose USB/UVC cameras as RTSP streams using **MediaMTX** and **FFmpeg** on macOS. This is useful for testing the live streaming functionality without physical IP cameras.

---

## Prerequisites

### Install MediaMTX

```bash
brew install mediamtx
```

### Install FFmpeg

```bash
brew install ffmpeg
```

---

## Step 1: List Available Cameras

Find your camera device indices:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

Example output:

```
[AVFoundation indev @ 0x...] AVFoundation video devices:
[AVFoundation indev @ 0x...] [0] MacBook Pro Camera
[AVFoundation indev @ 0x...] [1] H264 USB Camera
[AVFoundation indev @ 0x...] [2] UVC Camera
[AVFoundation indev @ 0x...] [3] OBS Virtual Camera
```

Note the index numbers (e.g., `1` for H264 USB Camera, `2` for UVC Camera).

---

## Step 2: Configure MediaMTX

Create a config file at `~/mediamtx.yml`:

```yaml
# MediaMTX configuration for USB camera testing

# Authentication - allow any user to publish/read
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

# Define paths that can accept streams
paths:
  cam1:
  cam2:
```

---

## Step 3: Start MediaMTX

```bash
mediamtx ~/mediamtx.yml
```

You should see:

```
INF MediaMTX v1.15.5
INF [RTSP] listener opened on :8554 (TCP), :8000 (UDP/RTP), :8001 (UDP/RTCP)
INF [RTMP] listener opened on :1935
INF [HLS] listener opened on :8888
INF [WebRTC] listener opened on :8889 (HTTP), :8189 (ICE/UDP)
```

---

## Step 4: Push Camera Streams to MediaMTX

Open new terminal windows for each camera.

### Camera 1 (e.g., H264 USB Camera at index 1):

```bash
ffmpeg -f avfoundation -framerate 30 -video_size 1280x720 -pixel_format uyvy422 -i "1" \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
  -f rtsp rtsp://localhost:8554/cam1
```

### Camera 2 (e.g., UVC Camera at index 2):

```bash
ffmpeg -f avfoundation -framerate 30 -video_size 1280x720 -pixel_format uyvy422 -i "2" \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
  -f rtsp rtsp://localhost:8554/cam2
```

**Note:** Adjust `-video_size` based on your camera's supported resolution. Common values:

- `640x480` - VGA
- `1280x720` - 720p HD
- `1920x1080` - 1080p Full HD

---

## Step 5: Verify Streams

### Test with FFplay:

```bash
ffplay rtsp://localhost:8554/cam1
ffplay rtsp://localhost:8554/cam2
```

### Test with VLC:

Open VLC → Media → Open Network Stream → Enter: `rtsp://localhost:8554/cam1`

### Test MediaMTX's built-in HLS:

Open in browser: `http://localhost:8888/cam1`

---

## Step 6: Use with Live Stream Worker

Update `cameras.yaml` to use the local RTSP URLs:

```yaml
cameras:
  - id: "cam_floor"
    name: "Floor Camera (USB)"
    rtsp_url: "rtsp://localhost:8554/cam1"
    use_case: "live_stream"
    enabled: true
    settings:
      target_width: 854
      target_fps: 15
      segment_duration: 4
      segments_to_keep: 10
```

Then run the live stream worker:

```bash
cd Edge_AI_For_Retail_Stores
python live_stream.py --camera cam_floor --debug
```

Or test directly with RTSP URL:

```bash
python live_stream.py --rtsp "rtsp://localhost:8554/cam1" --debug
```

---

## Troubleshooting

### "path 'camX' is not configured"

Make sure the path is defined in `mediamtx.yml` under `paths:`.

### "401 Unauthorized"

Ensure `authInternalUsers` allows `any` user with `publish` and `read` permissions.

### Camera resolution mismatch

If FFmpeg fails with resolution errors, check your camera's supported resolutions:

```bash
ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -A5 "H264 USB"
```

Try a lower resolution like `640x480` if `1280x720` fails.

### High CPU usage

- Use `-preset ultrafast` for lowest CPU usage
- Reduce framerate: `-framerate 15`
- Reduce resolution: `-video_size 640x480`

---

## Quick Reference

| Service     | URL                            |
| ----------- | ------------------------------ |
| RTSP Stream | `rtsp://localhost:8554/cam1` |
| RTMP Stream | `rtmp://localhost:1935/cam1` |
| HLS Stream  | `http://localhost:8888/cam1` |
| WebRTC      | `http://localhost:8889/cam1` |

---

## Cleanup

To stop all processes:

```bash
# Stop FFmpeg streams (Ctrl+C in each terminal)
# Or kill all FFmpeg processes:
pkill ffmpeg

# Stop MediaMTX
pkill mediamtx
```
