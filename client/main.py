#!/usr/bin/env python3
"""
Main Entry Point - Multi-Camera System

Loads camera configuration and spawns workers for each enabled camera.
Each use case (face_recognition, live_stream) runs in its own process.

Usage:
    python main.py                    # Run all enabled cameras
    python main.py --camera cam_entrance  # Run specific camera
    python main.py --validate         # Validate config only
    python main.py --list             # List configured cameras
"""

import os
import sys
import argparse
import logging
import signal
import time
from multiprocessing import Process, Event
from typing import List, Dict

from camera_manager import (
    load_config,
    validate_config,
    SystemConfig,
    CameraConfig
)

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("main")

# =============================================================================
# WORKER PROCESSES
# =============================================================================

def run_face_recognition_worker(
    camera: CameraConfig,
    api_base_url: str,
    api_key: str,
    location_id: int,
    shutdown_event: Event,
    debug_mode: bool = False
) -> None:
    """
    Run face recognition worker for a camera.
    
    This function runs in a separate process.
    """
    from visitor_counter import run_visitor_counter
    
    logger.info(f"Starting face_recognition worker for: {camera.name}")
    
    try:
        run_visitor_counter(
            camera_config=camera,
            api_base_url=api_base_url,
            api_key=api_key,
            location_id=location_id,
            debug_mode=debug_mode
        )
    except Exception as e:
        logger.error(f"Worker {camera.id} crashed: {e}")
        raise


def run_live_stream_worker(
    camera: CameraConfig,
    api_base_url: str,
    api_key: str,
    location_id: int,
    shutdown_event: Event,
    debug_mode: bool = False
) -> None:
    """
    Run live streaming worker for a camera.
    
    This function runs in a separate process.
    Generates HLS segments and uploads to Supabase Storage.
    """
    from live_stream import run_live_stream_worker as run_stream
    
    logger.info(f"Starting live_stream worker for: {camera.name}")
    
    try:
        run_stream(
            camera_config=camera,
            location_id=location_id,
            shutdown_event=shutdown_event,
            debug_mode=debug_mode
        )
    except Exception as e:
        logger.error(f"Live stream worker {camera.id} crashed: {e}")
        raise


# =============================================================================
# PROCESS MANAGEMENT
# =============================================================================

class WorkerManager:
    """Manages worker processes for all cameras."""
    
    def __init__(self, config: SystemConfig, debug_mode: bool = False):
        self.config = config
        self.debug_mode = debug_mode
        self.processes: Dict[str, Process] = {}
        self.shutdown_event = Event()
    
    def start_worker(self, camera: CameraConfig) -> None:
        """Start a worker process for a camera."""
        if camera.id in self.processes:
            logger.warning(f"Worker {camera.id} already running")
            return
        
        # Select worker function based on use case
        if camera.use_case == "face_recognition":
            target = run_face_recognition_worker
        elif camera.use_case == "live_stream":
            target = run_live_stream_worker
        else:
            logger.error(f"Unknown use case: {camera.use_case}")
            return
        
        process = Process(
            target=target,
            args=(
                camera,
                self.config.api.base_url,
                self.config.api.key,
                self.config.location.id,
                self.shutdown_event,
                self.debug_mode
            ),
            name=f"worker-{camera.id}"
        )
        process.start()
        self.processes[camera.id] = process
        logger.info(f"Started worker: {camera.id} (PID: {process.pid})")
    
    def start_all(self, camera_ids: List[str] = None) -> None:
        """Start workers for specified cameras (or all enabled)."""
        cameras = self.config.get_enabled_cameras()
        
        if camera_ids:
            cameras = [c for c in cameras if c.id in camera_ids]
        
        if not cameras:
            logger.error("No cameras to start")
            return
        
        logger.info(f"Starting {len(cameras)} camera worker(s)...")
        for camera in cameras:
            self.start_worker(camera)
    
    def stop_all(self) -> None:
        """Stop all worker processes."""
        logger.info("Stopping all workers...")
        self.shutdown_event.set()
        
        for camera_id, process in self.processes.items():
            if process.is_alive():
                logger.info(f"Terminating worker: {camera_id}")
                process.terminate()
                process.join(timeout=5)
                
                if process.is_alive():
                    logger.warning(f"Force killing worker: {camera_id}")
                    process.kill()
        
        self.processes.clear()
        logger.info("All workers stopped")
    
    def monitor(self) -> None:
        """Monitor workers and restart if they crash."""
        while not self.shutdown_event.is_set():
            for camera_id, process in list(self.processes.items()):
                if not process.is_alive():
                    exit_code = process.exitcode
                    if exit_code != 0:
                        logger.warning(f"Worker {camera_id} exited with code {exit_code}")
                        # Could implement auto-restart here
                    del self.processes[camera_id]
            
            time.sleep(1)
    
    def wait(self) -> None:
        """Wait for all workers to complete."""
        try:
            self.monitor()
        except KeyboardInterrupt:
            logger.info("\nReceived shutdown signal")
        finally:
            self.stop_all()


# =============================================================================
# CLI
# =============================================================================

def list_cameras(config: SystemConfig) -> None:
    """Print list of configured cameras."""
    print(f"\nLocation: {config.location.name} (ID: {config.location.id})")
    print(f"API: {config.api.base_url}\n")
    print("Cameras:")
    print("-" * 70)
    
    for cam in config.cameras:
        status = "✓ enabled" if cam.enabled else "✗ disabled"
        rtsp_display = cam.rtsp_url.split('@')[-1] if '@' in cam.rtsp_url else cam.rtsp_url
        
        print(f"  [{cam.id}] {cam.name}")
        print(f"      Status: {status}")
        print(f"      Use case: {cam.use_case}")
        print(f"      RTSP: {rtsp_display}")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Multi-Camera System - Main Entry Point",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py                      # Run all enabled cameras
  python main.py --camera cam_entrance    # Run specific camera
  python main.py --list               # List configured cameras
  python main.py --validate           # Validate configuration
  python main.py --debug              # Enable debug mode
        """
    )
    parser.add_argument("--config", type=str, help="Path to cameras.yaml")
    parser.add_argument("--camera", type=str, action="append", 
                        help="Camera ID to run (can specify multiple)")
    parser.add_argument("--list", action="store_true", help="List configured cameras")
    parser.add_argument("--validate", action="store_true", help="Validate config and exit")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    
    args = parser.parse_args()
    
    # Load configuration
    try:
        config = load_config(args.config)
    except FileNotFoundError as e:
        logger.error(f"Configuration file not found: {e}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Failed to load configuration: {e}")
        sys.exit(1)
    
    # Validate configuration
    errors = validate_config(config)
    if errors:
        logger.error("Configuration errors:")
        for err in errors:
            logger.error(f"  - {err}")
        sys.exit(1)
    
    # Handle --validate
    if args.validate:
        print("✅ Configuration is valid")
        list_cameras(config)
        sys.exit(0)
    
    # Handle --list
    if args.list:
        list_cameras(config)
        sys.exit(0)
    
    # Start workers
    manager = WorkerManager(config, debug_mode=args.debug)
    
    # Setup signal handlers
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}")
        manager.stop_all()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start specified cameras or all
    manager.start_all(args.camera)
    
    # Wait for workers
    manager.wait()


if __name__ == "__main__":
    main()
