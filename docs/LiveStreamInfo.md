# Live Streaming System Documentation

This document explains the HLS live streaming architecture, configuration, and latency tuning parameters.

---

## 1. Setup

### Overview

The live streaming system uses **HLS (HTTP Live Streaming)** to deliver video from RTSP cameras to web browsers:

```
RTSP Camera → FFmpeg → HLS Segments (.ts) → Supabase Storage → Browser (hls.js)
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `live_stream.py` | Edge Device | Captures RTSP, generates HLS, uploads to storage |
| `HLSPlayer.tsx` | React App | Plays HLS stream in browser using hls.js |
| Supabase Storage | Cloud | Hosts HLS segments and playlist |
| MediaMTX (optional) | Local | Exposes USB cameras as RTSP for testing |

---

### Edge Device Configuration

#### `cameras.yaml` - Camera Definition

```yaml
- id: "cam_floor"
  name: "Floor Camera"
  rtsp_url: "rtsp://localhost:8554/cam1"  # Or IP camera URL
  use_case: "live_stream"
  enabled: true
  
  settings:
    target_width: 854             # Output width (480p = 854x480)
    target_fps: 15                # Frames per second
    segment_duration: 2           # Seconds per HLS segment
    segments_to_keep: 5           # Rolling window size
```

#### `live_stream.py` - Default Settings

```python
@dataclass
class LiveStreamSettings:
    """Settings for live streaming."""
    target_width: int = 854          # 480p width
    target_fps: int = 15             # Target FPS
    segment_duration: int = 2        # Seconds per HLS segment
    segments_to_keep: int = 5        # Rolling window
```

#### FFmpeg Command (Generated)

```bash
ffmpeg \
  -rtsp_transport tcp \
  -i rtsp://camera-url \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -vf scale=854:480 \
  -r 15 \
  -g 30 \                    # GOP size = fps × segment_duration
  -sc_threshold 0 \          # Disable scene change detection
  -c:a aac -b:a 128k \
  -f hls \
  -hls_time 2 \              # Segment duration
  -hls_list_size 5 \         # Segments in playlist
  -hls_flags delete_segments+append_list \
  -hls_segment_filename segment_%03d.ts \
  stream.m3u8
```

#### Environment Variables (Edge Device)

```bash
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_KEY="your-service-role-key"
```

#### Running the Stream

```bash
cd Edge_AI_For_Retail_Stores
python live_stream.py --camera cam_floor
```

---

### Web Side Configuration

#### `HLSPlayer.tsx` - Player Settings

```tsx
const hls = new Hls({
  enableWorker: true,
  lowLatencyMode: true,
  backBufferLength: 30,           // Seconds of back buffer to keep
  maxBufferLength: 10,            // Max buffer ahead (seconds)
  maxMaxBufferLength: 20,         // Absolute max buffer
  liveSyncDurationCount: 2,       // Segments behind live edge
  liveMaxLatencyDurationCount: 4, // Max segments behind before seeking
  liveDurationInfinity: true,     // Treat as infinite live stream
  highBufferWatchdogPeriod: 1,    // Buffer check interval (seconds)
});
```

#### Database - Camera Record

The camera's `stream_url` in the database points to the HLS playlist:

```sql
INSERT INTO cameras (name, stream_url, location_id, status, is_active) 
VALUES (
  'Floor Camera', 
  'https://xxx.supabase.co/storage/v1/object/public/streams/location_1/cam_floor/stream.m3u8',
  1, 
  'active', 
  true
);
```

#### Supabase Storage Structure

```
streams/
  └── location_1/
      └── cam_floor/
          ├── stream.m3u8      # HLS playlist
          ├── segment_000.ts   # Video segment
          ├── segment_001.ts
          ├── segment_002.ts
          ├── segment_003.ts
          └── segment_004.ts
```

---

## 2. Logic & Latency Tuning

### Understanding HLS Latency

HLS latency consists of several components:

```
Total Latency = Encoding + Segment Duration + Upload + Network + Player Buffer
```

| Component | Typical Value | Controllable? |
|-----------|---------------|---------------|
| Encoding (FFmpeg) | 0.1-0.5s | Partially (preset) |
| Segment Duration | 2-4s | Yes |
| Upload to Storage | 0.5-2s | Depends on network |
| Network (CDN) | 0.1-1s | No |
| Player Buffer | 2-8s | Yes |

### Key Parameters

#### Edge Device (FFmpeg)

| Parameter | Setting | Effect on Latency |
|-----------|---------|-------------------|
| `segment_duration` | 2s (was 4s) | **Direct impact** - shorter = lower latency but more uploads |
| `segments_to_keep` | 5 (was 10) | Smaller playlist = fresher content |
| `preset` | `ultrafast` | Fastest encoding, minimal delay |
| `tune` | `zerolatency` | Disables B-frames, reduces encoding buffer |
| `sc_threshold` | `0` | Prevents mid-segment keyframes |
| `g` (GOP size) | `fps × segment_duration` | Keyframe at segment boundaries |

#### HLS Player (hls.js)

| Parameter | Value | Effect |
|-----------|-------|--------|
| `lowLatencyMode` | `true` | Enables low-latency optimizations |
| `liveSyncDurationCount` | `2` | Stay 2 segments behind live edge |
| `liveMaxLatencyDurationCount` | `4` | Auto-seek if >4 segments behind |
| `maxBufferLength` | `10s` | Limits buffer ahead |
| `backBufferLength` | `30s` | Limits buffer behind |
| `highBufferWatchdogPeriod` | `1s` | Frequent buffer checks |

### Latency Calculation

**Current Configuration:**

```
Segment Duration: 2 seconds
Segments Behind Live Edge: 2 (liveSyncDurationCount)
Upload Delay: ~1 second

Minimum Latency = 2s × 2 + 1s = ~5 seconds
Typical Latency = 2s × 3 + 1s = ~7 seconds
```

**Previous Configuration (4s segments, 4 segments behind):**

```
Minimum Latency = 4s × 4 + 1s = ~17 seconds
```

### Improving Latency Further

#### Option 1: Shorter Segments (1 second)

```python
# live_stream.py
segment_duration: int = 1        # 1 second segments
segments_to_keep: int = 6        # Keep 6 segments
```

```tsx
// HLSPlayer.tsx
liveSyncDurationCount: 3,        // 3 segments behind
```

**Result:** ~4-5 second latency  
**Tradeoff:** More frequent uploads, higher bandwidth usage

#### Option 2: LL-HLS (Low-Latency HLS)

Requires FFmpeg 4.4+ with partial segments:

```bash
ffmpeg ... \
  -hls_flags delete_segments+independent_segments \
  -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -hls_time 2 \
  -hls_playlist_type event
```

**Result:** 2-3 second latency  
**Tradeoff:** More complex setup, requires compatible player

#### Option 3: WebRTC (Alternative Protocol)

For sub-second latency, consider WebRTC instead of HLS. MediaMTX supports WebRTC natively at `http://localhost:8889/cam1`.

**Result:** <1 second latency  
**Tradeoff:** Different architecture, peer-to-peer complexity

### Monitoring & Debugging

#### Check Current Latency

In browser console:

```javascript
// Get hls.js instance
const hls = document.querySelector('video')?.hls;

// Current latency
console.log('Latency:', hls?.latency);

// Buffer info
console.log('Buffer length:', hls?.media?.buffered?.end(0) - hls?.media?.currentTime);
```

#### Check Segment Freshness

```bash
# List segments with timestamps
curl -s "https://xxx.supabase.co/storage/v1/object/list/streams" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"location_1/cam_floor"}' | jq '.[].updated_at'
```

#### Check Playlist Content

```bash
curl -s "https://xxx.supabase.co/storage/v1/object/public/streams/location_1/cam_floor/stream.m3u8"
```

Expected output:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:2.000000,
segment_042.ts
#EXTINF:2.000000,
segment_043.ts
...
```

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| High latency (>15s) | Large segments or buffer | Reduce `segment_duration` and `liveSyncDurationCount` |
| Frequent buffering | Network too slow | Increase `segment_duration` or reduce resolution |
| Stream freezes | Segments not uploading | Check Edge device logs and network |
| Player seeks backward | `liveMaxLatencyDurationCount` too low | Increase to 5-6 |

---

## Quick Reference

### Latency vs Stability Tradeoffs

| Profile | Segment | Sync Count | Latency | Stability |
|---------|---------|------------|---------|-----------|
| Ultra-low | 1s | 2 | ~3-4s | Lower |
| Low | 2s | 2 | ~5-7s | Medium |
| Balanced | 4s | 3 | ~15-20s | High |
| Stable | 6s | 4 | ~30s+ | Very High |

### Current Settings

- **Segment Duration:** 2 seconds
- **Segments to Keep:** 5
- **Player Sync:** 2 segments behind
- **Expected Latency:** 5-8 seconds
