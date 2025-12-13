#!/usr/bin/env python3
"""
Stream Monitor - Real-time visibility into the HLS streaming pipeline.

Shows:
1. Local HLS state (FFmpeg output)
2. Supabase Storage state (uploaded segments)
3. Pipeline health metrics
"""

import os
import sys
import time
import json
import requests
from datetime import datetime
from pathlib import Path

# Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://dqmkhmxxktycnajtqamh.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
LOCAL_HLS_DIR = "/tmp/hls_cam_floor"
STREAM_PATH = "location_1/cam_floor"
BUCKET = "streams"

# Colors for terminal output
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def get_local_state():
    """Get state of local HLS files."""
    state = {
        "playlist_exists": False,
        "playlist_sequence": None,
        "segments": [],
        "last_modified": None,
    }
    
    playlist_path = Path(LOCAL_HLS_DIR) / "stream.m3u8"
    if playlist_path.exists():
        state["playlist_exists"] = True
        state["last_modified"] = datetime.fromtimestamp(playlist_path.stat().st_mtime)
        
        content = playlist_path.read_text()
        for line in content.split('\n'):
            if line.startswith('#EXT-X-MEDIA-SEQUENCE:'):
                state["playlist_sequence"] = int(line.split(':')[1])
            elif line.endswith('.ts'):
                state["segments"].append(line)
    
    # Get segment files
    hls_dir = Path(LOCAL_HLS_DIR)
    if hls_dir.exists():
        segment_files = sorted(hls_dir.glob("segment_*.ts"))
        state["segment_files"] = [
            {
                "name": f.name,
                "size": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime)
            }
            for f in segment_files[-5:]  # Last 5 segments
        ]
    
    return state


def get_supabase_playlist():
    """Get the playlist from Supabase Storage."""
    url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{STREAM_PATH}/stream.m3u8"
    try:
        # Add cache-busting
        response = requests.get(url, params={"t": int(time.time())}, timeout=5)
        if response.status_code == 200:
            content = response.text
            sequence = None
            segments = []
            for line in content.split('\n'):
                if line.startswith('#EXT-X-MEDIA-SEQUENCE:'):
                    sequence = int(line.split(':')[1])
                elif line.endswith('.ts'):
                    segments.append(line)
            return {
                "status": "ok",
                "sequence": sequence,
                "segments": segments,
                "content": content
            }
        else:
            return {"status": "error", "code": response.status_code}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def check_segment_accessible(segment_name):
    """Check if a segment is accessible from Supabase."""
    url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{STREAM_PATH}/{segment_name}"
    try:
        response = requests.head(url, timeout=5)
        return response.status_code == 200
    except:
        return False


def print_header():
    """Print monitor header."""
    os.system('clear' if os.name == 'posix' else 'cls')
    print(f"{Colors.BOLD}{Colors.CYAN}╔══════════════════════════════════════════════════════════════╗{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}║          HLS STREAM MONITOR - Real-time Pipeline View        ║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}╚══════════════════════════════════════════════════════════════╝{Colors.RESET}")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()


def print_local_state(state):
    """Print local HLS state."""
    print(f"{Colors.BOLD}{Colors.BLUE}┌─ LOCAL (FFmpeg Output) ─────────────────────────────────────┐{Colors.RESET}")
    
    if state["playlist_exists"]:
        age = (datetime.now() - state["last_modified"]).total_seconds()
        age_color = Colors.GREEN if age < 5 else Colors.YELLOW if age < 10 else Colors.RED
        
        print(f"  Playlist: {Colors.GREEN}✓ EXISTS{Colors.RESET}")
        print(f"  Sequence: {Colors.CYAN}{state['playlist_sequence']}{Colors.RESET}")
        print(f"  Last Modified: {age_color}{age:.1f}s ago{Colors.RESET}")
        print(f"  Segments in playlist: {', '.join(state['segments'])}")
        
        if state.get("segment_files"):
            print(f"\n  {Colors.BOLD}Segment Files:{Colors.RESET}")
            for seg in state["segment_files"]:
                seg_age = (datetime.now() - seg["modified"]).total_seconds()
                size_kb = seg["size"] / 1024
                print(f"    {seg['name']}: {size_kb:.1f}KB, {seg_age:.1f}s ago")
    else:
        print(f"  Playlist: {Colors.RED}✗ NOT FOUND{Colors.RESET}")
        print(f"  Directory: {LOCAL_HLS_DIR}")
    
    print(f"{Colors.BLUE}└──────────────────────────────────────────────────────────────┘{Colors.RESET}")
    print()


def print_supabase_state(state, local_sequence):
    """Print Supabase state."""
    print(f"{Colors.BOLD}{Colors.GREEN}┌─ SUPABASE STORAGE ──────────────────────────────────────────┐{Colors.RESET}")
    
    if state["status"] == "ok":
        print(f"  Status: {Colors.GREEN}✓ CONNECTED{Colors.RESET}")
        print(f"  Sequence: {Colors.CYAN}{state['sequence']}{Colors.RESET}")
        print(f"  Segments: {', '.join(state['segments'])}")
        
        # Check sync with local
        if local_sequence is not None:
            diff = local_sequence - (state['sequence'] or 0)
            if diff == 0:
                print(f"  Sync: {Colors.GREEN}✓ IN SYNC with local{Colors.RESET}")
            elif diff > 0:
                print(f"  Sync: {Colors.YELLOW}⚠ {diff} segments BEHIND local{Colors.RESET}")
            else:
                print(f"  Sync: {Colors.RED}✗ AHEAD of local (stale cache?){Colors.RESET}")
        
        # Check if segments are accessible
        if state['segments']:
            accessible = sum(1 for s in state['segments'][:2] if check_segment_accessible(s))
            if accessible == 2:
                print(f"  Segments Accessible: {Colors.GREEN}✓ YES{Colors.RESET}")
            else:
                print(f"  Segments Accessible: {Colors.RED}✗ {accessible}/2{Colors.RESET}")
    else:
        print(f"  Status: {Colors.RED}✗ ERROR{Colors.RESET}")
        print(f"  Details: {state.get('message', state.get('code', 'Unknown'))}")
    
    print(f"{Colors.GREEN}└──────────────────────────────────────────────────────────────┘{Colors.RESET}")
    print()


def print_pipeline_health(local_state, supabase_state):
    """Print overall pipeline health."""
    print(f"{Colors.BOLD}{Colors.YELLOW}┌─ PIPELINE HEALTH ───────────────────────────────────────────┐{Colors.RESET}")
    
    issues = []
    
    # Check FFmpeg output
    if not local_state["playlist_exists"]:
        issues.append("FFmpeg not producing HLS output")
    elif local_state["last_modified"]:
        age = (datetime.now() - local_state["last_modified"]).total_seconds()
        if age > 10:
            issues.append(f"FFmpeg output stale ({age:.0f}s old)")
    
    # Check Supabase
    if supabase_state["status"] != "ok":
        issues.append("Cannot reach Supabase Storage")
    elif local_state["playlist_sequence"] and supabase_state.get("sequence"):
        diff = local_state["playlist_sequence"] - supabase_state["sequence"]
        if diff > 2:
            issues.append(f"Upload lag: {diff} segments behind")
    
    if not issues:
        print(f"  {Colors.GREEN}✓ All systems operational{Colors.RESET}")
    else:
        for issue in issues:
            print(f"  {Colors.RED}✗ {issue}{Colors.RESET}")
    
    print(f"{Colors.YELLOW}└──────────────────────────────────────────────────────────────┘{Colors.RESET}")
    print()


def print_urls():
    """Print useful URLs."""
    print(f"{Colors.BOLD}URLs:{Colors.RESET}")
    print(f"  Playlist: {SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{STREAM_PATH}/stream.m3u8")
    print(f"  Dashboard: https://dashboard.smoothflow.ai")
    print()


def main():
    """Main monitoring loop."""
    print("Starting Stream Monitor...")
    print("Press Ctrl+C to exit\n")
    
    try:
        while True:
            print_header()
            
            # Get states
            local_state = get_local_state()
            supabase_state = get_supabase_playlist()
            
            # Print states
            print_local_state(local_state)
            print_supabase_state(supabase_state, local_state.get("playlist_sequence"))
            print_pipeline_health(local_state, supabase_state)
            print_urls()
            
            print(f"{Colors.CYAN}Refreshing in 2 seconds... (Ctrl+C to exit){Colors.RESET}")
            time.sleep(2)
            
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Monitor stopped.{Colors.RESET}")


if __name__ == "__main__":
    main()
