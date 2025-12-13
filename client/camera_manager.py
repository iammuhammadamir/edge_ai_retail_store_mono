#!/usr/bin/env python3
"""
Camera Manager Module
Loads and validates camera configuration from cameras.yaml.
Provides typed access to camera settings.
"""

import os
import yaml
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class FaceRecognitionSettings:
    """Settings for face recognition use case."""
    target_width: int = 1280
    process_every_n_frames: int = 5
    quality_capture_duration: float = 5.0
    quality_frame_skip: int = 3
    similarity_threshold: float = 0.45
    cooldown_seconds: int = 10
    min_quality_score: float = 350
    min_detection_score: float = 0.70


@dataclass
class LiveStreamSettings:
    """Settings for live streaming use case."""
    target_width: int = 854  # 480p
    target_fps: int = 15
    jpeg_quality: int = 80


@dataclass
class CameraConfig:
    """Configuration for a single camera."""
    id: str
    name: str
    rtsp_url: str
    use_case: str  # "face_recognition" or "live_stream"
    enabled: bool = True
    settings: Dict[str, Any] = field(default_factory=dict)
    
    def get_face_recognition_settings(self) -> FaceRecognitionSettings:
        """Get typed face recognition settings."""
        if self.use_case != "face_recognition":
            raise ValueError(f"Camera {self.id} is not configured for face_recognition")
        return FaceRecognitionSettings(
            target_width=self.settings.get('target_width', 1280),
            process_every_n_frames=self.settings.get('process_every_n_frames', 5),
            quality_capture_duration=self.settings.get('quality_capture_duration', 5.0),
            quality_frame_skip=self.settings.get('quality_frame_skip', 3),
            similarity_threshold=self.settings.get('similarity_threshold', 0.45),
            cooldown_seconds=self.settings.get('cooldown_seconds', 10),
            min_quality_score=self.settings.get('min_quality_score', 350),
            min_detection_score=self.settings.get('min_detection_score', 0.70),
        )
    
    def get_live_stream_settings(self) -> LiveStreamSettings:
        """Get typed live stream settings."""
        if self.use_case != "live_stream":
            raise ValueError(f"Camera {self.id} is not configured for live_stream")
        return LiveStreamSettings(
            target_width=self.settings.get('target_width', 854),
            target_fps=self.settings.get('target_fps', 15),
            jpeg_quality=self.settings.get('jpeg_quality', 80),
        )


@dataclass
class LocationConfig:
    """Location configuration."""
    id: int
    name: str


@dataclass
class ApiConfig:
    """API configuration."""
    base_url: str
    key: str


@dataclass
class SystemConfig:
    """Complete system configuration."""
    location: LocationConfig
    api: ApiConfig
    cameras: List[CameraConfig]
    
    def get_enabled_cameras(self) -> List[CameraConfig]:
        """Get only enabled cameras."""
        return [c for c in self.cameras if c.enabled]
    
    def get_cameras_by_use_case(self, use_case: str) -> List[CameraConfig]:
        """Get enabled cameras for a specific use case."""
        return [c for c in self.cameras if c.enabled and c.use_case == use_case]
    
    def get_camera_by_id(self, camera_id: str) -> Optional[CameraConfig]:
        """Get camera by ID."""
        for c in self.cameras:
            if c.id == camera_id:
                return c
        return None


# =============================================================================
# CONFIGURATION LOADING
# =============================================================================

_config: Optional[SystemConfig] = None
_config_path: Optional[str] = None


def find_config_file() -> str:
    """Find the cameras.yaml config file."""
    # Check common locations
    search_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "cameras.yaml"),
        os.path.expanduser("~/cameras.yaml"),
        "/etc/smoothflow/cameras.yaml",
    ]
    
    for path in search_paths:
        if os.path.exists(path):
            return path
    
    raise FileNotFoundError(
        f"cameras.yaml not found. Searched: {search_paths}"
    )


def load_config(config_path: Optional[str] = None) -> SystemConfig:
    """
    Load configuration from cameras.yaml.
    
    Args:
        config_path: Optional path to config file. If None, searches default locations.
    
    Returns:
        SystemConfig object with all settings
    """
    global _config, _config_path
    
    if config_path is None:
        config_path = find_config_file()
    
    logger.info(f"Loading configuration from: {config_path}")
    
    with open(config_path, 'r') as f:
        raw = yaml.safe_load(f)
    
    # Parse location
    loc_data = raw.get('location', {})
    location = LocationConfig(
        id=loc_data.get('id', 1),
        name=loc_data.get('name', 'Unknown Location')
    )
    
    # Parse API config
    api_data = raw.get('api', {})
    api = ApiConfig(
        base_url=api_data.get('base_url', 'https://dashboard.smoothflow.ai'),
        key=api_data.get('key', 'dev-edge-api-key')
    )
    
    # Parse cameras
    cameras = []
    for cam_data in raw.get('cameras', []):
        camera = CameraConfig(
            id=cam_data.get('id', 'unknown'),
            name=cam_data.get('name', 'Unknown Camera'),
            rtsp_url=cam_data.get('rtsp_url', ''),
            use_case=cam_data.get('use_case', 'face_recognition'),
            enabled=cam_data.get('enabled', True),
            settings=cam_data.get('settings', {})
        )
        cameras.append(camera)
    
    _config = SystemConfig(
        location=location,
        api=api,
        cameras=cameras
    )
    _config_path = config_path
    
    # Log summary
    enabled = _config.get_enabled_cameras()
    logger.info(f"Location: {location.name} (ID: {location.id})")
    logger.info(f"API: {api.base_url}")
    logger.info(f"Cameras: {len(cameras)} total, {len(enabled)} enabled")
    for cam in enabled:
        logger.info(f"  - {cam.name} ({cam.id}): {cam.use_case}")
    
    return _config


def get_config() -> SystemConfig:
    """Get the loaded configuration (loads if not already loaded)."""
    global _config
    if _config is None:
        _config = load_config()
    return _config


def reload_config() -> SystemConfig:
    """Reload configuration from file."""
    global _config, _config_path
    _config = None
    return load_config(_config_path)


# =============================================================================
# VALIDATION
# =============================================================================

def validate_config(config: SystemConfig) -> List[str]:
    """
    Validate configuration and return list of errors.
    
    Returns:
        List of error messages (empty if valid)
    """
    errors = []
    
    # Check location
    if config.location.id <= 0:
        errors.append("Location ID must be positive")
    
    # Check API
    if not config.api.base_url:
        errors.append("API base_url is required")
    if not config.api.key:
        errors.append("API key is required")
    
    # Check cameras
    if not config.cameras:
        errors.append("At least one camera must be configured")
    
    camera_ids = set()
    for cam in config.cameras:
        # Check for duplicate IDs
        if cam.id in camera_ids:
            errors.append(f"Duplicate camera ID: {cam.id}")
        camera_ids.add(cam.id)
        
        # Check required fields
        if not cam.rtsp_url:
            errors.append(f"Camera {cam.id}: rtsp_url is required")
        
        # Check use case
        if cam.use_case not in ("face_recognition", "live_stream"):
            errors.append(f"Camera {cam.id}: invalid use_case '{cam.use_case}'")
    
    return errors


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    import sys
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s'
    )
    
    # Load and validate config
    try:
        config_path = sys.argv[1] if len(sys.argv) > 1 else None
        config = load_config(config_path)
        
        errors = validate_config(config)
        if errors:
            print("\n Configuration errors:")
            for err in errors:
                print(f"  - {err}")
            sys.exit(1)
        else:
            print("\n Configuration is valid")
            
            # Print summary
            print(f"\nLocation: {config.location.name} (ID: {config.location.id})")
            print(f"API: {config.api.base_url}")
            print(f"\nCameras ({len(config.get_enabled_cameras())} enabled):")
            for cam in config.cameras:
                status = "✓" if cam.enabled else "✗"
                print(f"  [{status}] {cam.name} ({cam.id})")
                print(f"      Use case: {cam.use_case}")
                print(f"      RTSP: {cam.rtsp_url.split('@')[-1] if '@' in cam.rtsp_url else cam.rtsp_url}")
                
    except FileNotFoundError as e:
        print(f" {e}")
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"YAML parsing error: {e}")
        sys.exit(1)
