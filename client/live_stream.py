#!/usr/bin/env python3
"""
Live Stream Worker - HLS Streaming

Captures video from RTSP camera, generates HLS segments using FFmpeg,
and uploads them to Supabase Storage for browser playback.

Architecture:
    RTSP Camera → FFmpeg → HLS Segments (.ts) → Supabase Storage → Browser (hls.js)

Requirements:
    - FFmpeg installed: sudo apt install ffmpeg
    - Supabase credentials in environment:
        SUPABASE_URL=https://xxx.supabase.co
        SUPABASE_KEY=your-service-key
"""

import os
import sys
import time
import logging
import subprocess
import threading
import glob
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

# Supabase client
try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False
    print("Warning: supabase package not installed. Run: pip install supabase")

from camera_manager import CameraConfig

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class LiveStreamSettings:
    """Settings for live streaming."""
    target_width: int = 640          # 360p width (lower = smaller files)
    target_fps: int = 12             # Target FPS
    segment_duration: int = 2        # Seconds per HLS segment
    segments_to_keep: int = 5        # Rolling window
    crf: int = 28                    # Quality (18-28, higher = lower quality, smaller files)


# =============================================================================
# SUPABASE STORAGE
# =============================================================================

class StorageUploader:
    """Handles uploading HLS segments to Supabase Storage."""
    
    def __init__(self, location_id: int, camera_id: str):
        self.location_id = location_id
        self.camera_id = camera_id
        self.bucket_name = "streams"
        self.base_path = f"location_{location_id}/{camera_id}"
        
        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
        
        if not supabase_url or not supabase_key:
            logger.warning("Supabase credentials not found in environment")
            self.client: Optional[Client] = None
        elif not SUPABASE_AVAILABLE:
            logger.warning("Supabase package not installed")
            self.client = None
        else:
            self.client = create_client(supabase_url, supabase_key)
            logger.info(f"Supabase client initialized for {self.base_path}")
    
    def upload_file(self, local_path: str, remote_name: str, content_type: str) -> bool:
        """Upload a file to Supabase Storage."""
        if not self.client:
            logger.debug(f"Skipping upload (no client): {remote_name}")
            return False
        
        try:
            remote_path = f"{self.base_path}/{remote_name}"
            
            with open(local_path, "rb") as f:
                data = f.read()
            
            file_size = len(data)
            logger.info(f"Uploading {remote_name} ({file_size/1024:.1f}KB) to {remote_path}")
            
            # Upload with upsert to overwrite existing
            result = self.client.storage.from_(self.bucket_name).upload(
                remote_path,
                data,
                file_options={"content-type": content_type, "upsert": "true"}
            )
            
            logger.info(f"✓ Uploaded: {remote_name}")
            return True
            
        except Exception as e:
            logger.error(f"✗ Upload failed for {remote_name}: {e}")
            return False
    
    def delete_file(self, remote_name: str) -> bool:
        """Delete a file from Supabase Storage."""
        if not self.client:
            return False
        
        try:
            remote_path = f"{self.base_path}/{remote_name}"
            self.client.storage.from_(self.bucket_name).remove([remote_path])
            logger.debug(f"Deleted: {remote_name}")
            return True
        except Exception as e:
            logger.error(f"Delete failed for {remote_name}: {e}")
            return False
    
    def get_public_url(self, remote_name: str) -> str:
        """Get the public URL for a file."""
        if not self.client:
            return ""
        
        remote_path = f"{self.base_path}/{remote_name}"
        result = self.client.storage.from_(self.bucket_name).get_public_url(remote_path)
        return result


# =============================================================================
# HLS GENERATOR
# =============================================================================

class HLSGenerator:
    """Generates HLS segments from RTSP stream using FFmpeg."""
    
    def __init__(
        self,
        rtsp_url: str,
        output_dir: str,
        settings: LiveStreamSettings
    ):
        self.rtsp_url = rtsp_url
        self.output_dir = Path(output_dir)
        self.settings = settings
        self.process: Optional[subprocess.Popen] = None
        self._stop_event = threading.Event()
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def _build_ffmpeg_command(self) -> list:
        """Build FFmpeg command for HLS generation."""
        playlist_path = self.output_dir / "stream.m3u8"
        segment_pattern = self.output_dir / "segment_%03d.ts"
        
        # Calculate height to maintain aspect ratio (assuming 16:9)
        target_height = int(self.settings.target_width * 9 / 16)
        # Ensure even dimensions
        target_height = target_height if target_height % 2 == 0 else target_height + 1
        
        cmd = [
            "ffmpeg",
            "-rtsp_transport", "tcp",           # Use TCP for RTSP (more reliable)
            "-i", self.rtsp_url,                # Input RTSP stream
            "-c:v", "libx264",                  # H.264 video codec
            "-preset", "ultrafast",             # Fast encoding (low latency)
            "-tune", "zerolatency",             # Optimize for low latency
            "-crf", str(self.settings.crf),     # Quality (higher = smaller files)
            "-vf", f"scale={self.settings.target_width}:{target_height}",  # Resize
            "-r", str(self.settings.target_fps),  # Output framerate
            "-g", str(self.settings.target_fps * self.settings.segment_duration),  # GOP size
            "-sc_threshold", "0",               # Disable scene change detection
            "-c:a", "aac",                      # AAC audio codec
            "-b:a", "64k",                      # Audio bitrate (reduced)
            "-ar", "22050",                     # Audio sample rate (reduced)
            "-f", "hls",                        # HLS output format
            "-hls_time", str(self.settings.segment_duration),  # Segment duration
            "-hls_list_size", str(self.settings.segments_to_keep),  # Playlist size
            "-hls_flags", "delete_segments+append_list",  # Auto-delete old segments
            "-hls_segment_filename", str(segment_pattern),  # Segment filename pattern
            str(playlist_path)                  # Output playlist
        ]
        
        return cmd
    
    def start(self) -> bool:
        """Start FFmpeg process."""
        if self.process and self.process.poll() is None:
            logger.warning("FFmpeg already running")
            return False
        
        cmd = self._build_ffmpeg_command()
        logger.info(f"Starting FFmpeg: {' '.join(cmd[:5])}...")
        
        try:
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            self._stop_event.clear()
            logger.info("FFmpeg started successfully")
            return True
        except FileNotFoundError:
            logger.error("FFmpeg not found. Install with: sudo apt install ffmpeg")
            return False
        except Exception as e:
            logger.error(f"Failed to start FFmpeg: {e}")
            return False
    
    def stop(self):
        """Stop FFmpeg process."""
        self._stop_event.set()
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None
            logger.info("FFmpeg stopped")
    
    def is_running(self) -> bool:
        """Check if FFmpeg is running."""
        return self.process is not None and self.process.poll() is None
    
    def get_segments(self) -> list:
        """Get list of generated segment files."""
        return sorted(glob.glob(str(self.output_dir / "segment_*.ts")))
    
    def get_playlist_path(self) -> str:
        """Get path to HLS playlist."""
        return str(self.output_dir / "stream.m3u8")


# =============================================================================
# STREAM WORKER
# =============================================================================

def run_live_stream_worker(
    camera_config: CameraConfig,
    location_id: int,
    shutdown_event: threading.Event,
    debug_mode: bool = False
):
    """
    Main worker function for live streaming.
    
    Args:
        camera_config: Camera configuration from cameras.yaml
        location_id: Location ID for storage path
        shutdown_event: Event to signal shutdown
        debug_mode: Enable debug logging
    """
    if debug_mode:
        logging.getLogger().setLevel(logging.DEBUG)
    
    logger.info(f"Starting live stream worker for: {camera_config.name}")
    
    # Parse settings
    settings = LiveStreamSettings(
        target_width=camera_config.settings.get("target_width", 640),
        target_fps=camera_config.settings.get("target_fps", 12),
        segment_duration=camera_config.settings.get("segment_duration", 2),
        segments_to_keep=camera_config.settings.get("segments_to_keep", 5),
        crf=camera_config.settings.get("crf", 28),
    )
    
    # Create temp directory for HLS files
    temp_dir = f"/tmp/hls_{camera_config.id}"
    
    # Initialize components
    generator = HLSGenerator(
        rtsp_url=camera_config.rtsp_url,
        output_dir=temp_dir,
        settings=settings
    )
    
    uploader = StorageUploader(
        location_id=location_id,
        camera_id=camera_config.id
    )
    
    # Track uploaded segments for cleanup
    uploaded_segments = set()
    
    try:
        # Start FFmpeg
        if not generator.start():
            logger.error("Failed to start FFmpeg, exiting")
            return
        
        # Wait for first segment
        logger.info("Waiting for first HLS segment...")
        time.sleep(settings.segment_duration + 1)
        
        # Main upload loop
        while not shutdown_event.is_set() and generator.is_running():
            # Upload playlist
            playlist_path = generator.get_playlist_path()
            if os.path.exists(playlist_path):
                uploader.upload_file(playlist_path, "stream.m3u8", "application/vnd.apple.mpegurl")
            
            # Upload new segments
            current_segments = set(generator.get_segments())
            new_segments = current_segments - uploaded_segments
            
            for segment_path in new_segments:
                segment_name = os.path.basename(segment_path)
                if uploader.upload_file(segment_path, segment_name, "video/mp2t"):
                    uploaded_segments.add(segment_path)
            
            # Clean up old segments from storage
            deleted_segments = uploaded_segments - current_segments
            for segment_path in deleted_segments:
                segment_name = os.path.basename(segment_path)
                uploader.delete_file(segment_name)
                uploaded_segments.discard(segment_path)
            
            # Wait before next check
            time.sleep(1)
        
        # Check if FFmpeg crashed
        if not generator.is_running() and not shutdown_event.is_set():
            stderr = generator.process.stderr.read() if generator.process else ""
            logger.error(f"FFmpeg crashed: {stderr}")
    
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
    
    except Exception as e:
        logger.error(f"Live stream worker error: {e}")
        raise
    
    finally:
        generator.stop()
        logger.info(f"Live stream worker stopped: {camera_config.name}")


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    import argparse
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%H:%M:%S'
    )
    
    parser = argparse.ArgumentParser(description="Live Stream Worker")
    parser.add_argument("--rtsp", type=str, help="RTSP URL (for testing)")
    parser.add_argument("--camera", type=str, help="Camera ID from cameras.yaml")
    parser.add_argument("--config", type=str, help="Path to cameras.yaml")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    
    args = parser.parse_args()
    
    shutdown = threading.Event()
    
    if args.rtsp:
        # Direct RTSP URL for testing
        from dataclasses import dataclass, field
        
        @dataclass
        class TestCamera:
            id: str = "test_cam"
            name: str = "Test Camera"
            rtsp_url: str = ""
            use_case: str = "live_stream"
            enabled: bool = True
            settings: dict = field(default_factory=dict)
        
        test_cam = TestCamera(rtsp_url=args.rtsp)
        run_live_stream_worker(test_cam, location_id=1, shutdown_event=shutdown, debug_mode=args.debug)
    
    elif args.camera:
        # Load from cameras.yaml
        from camera_manager import load_config
        
        config = load_config(args.config)
        camera = config.get_camera_by_id(args.camera)
        
        if not camera:
            print(f"Camera not found: {args.camera}")
            sys.exit(1)
        
        if camera.use_case != "live_stream":
            print(f"Camera {args.camera} is not configured for live_stream")
            sys.exit(1)
        
        run_live_stream_worker(
            camera,
            location_id=config.location.id,
            shutdown_event=shutdown,
            debug_mode=args.debug
        )
    
    else:
        print("Usage:")
        print("  python live_stream.py --rtsp 'rtsp://...'  # Test with RTSP URL")
        print("  python live_stream.py --camera cam_floor   # Use cameras.yaml")
        sys.exit(1)
