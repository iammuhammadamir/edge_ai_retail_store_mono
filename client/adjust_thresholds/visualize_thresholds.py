#!/usr/bin/env python3
"""
Threshold Visualization Tool

Captures a frame from the camera and draws fixed-size boxes to help
visualize what different pixel sizes look like, and measures brightness/sharpness
at different locations in the image.

NO face detection - just draws boxes of known sizes and measures metrics.

Usage:
    python visualize_thresholds.py

Output:
    - size_boxes.jpg: Shows boxes of different pixel sizes (50, 70, 100, 130px)
    - brightness_samples.jpg: Shows brightness values at 4-5 locations
    - sharpness_samples.jpg: Shows sharpness values at 4-5 locations
"""

import cv2
import numpy as np
import os
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config as cfg

# =============================================================================
# CONFIGURATION
# =============================================================================

RTSP_URL = cfg.RTSP_URL
TARGET_WIDTH = cfg.TARGET_WIDTH
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Cropping values (same as visitor_counter.py)
CROP_LEFT = 0.30
CROP_RIGHT = 0.30
CROP_TOP = 0.10
CROP_BOTTOM = 0.30

# Box sizes to visualize (in pixels)
BOX_SIZES = [50, 70, 100, 130, 150]

# Medium box size for brightness/sharpness sampling
SAMPLE_BOX_SIZE = 80

# =============================================================================
# HELPERS
# =============================================================================

def crop_frame(frame, crop_left=0.30, crop_right=0.30, crop_top=0.10, crop_bottom=0.30):
    """Crop frame to remove edges."""
    h, w = frame.shape[:2]
    x1 = int(w * crop_left)
    x2 = int(w * (1 - crop_right))
    y1 = int(h * crop_top)
    y2 = int(h * (1 - crop_bottom))
    return frame[y1:y2, x1:x2]


def resize_frame(frame, target_width):
    """Resize frame maintaining aspect ratio."""
    h, w = frame.shape[:2]
    scale = target_width / w
    new_h = int(h * scale)
    return cv2.resize(frame, (target_width, new_h))


def compute_sharpness(roi):
    """Compute Laplacian variance (sharpness)."""
    if roi.size == 0:
        return 0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    return laplacian.var()


def compute_brightness(roi):
    """Compute mean brightness."""
    if roi.size == 0:
        return 0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
    return np.mean(gray)


def compute_contrast(roi):
    """Compute contrast (std dev)."""
    if roi.size == 0:
        return 0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if len(roi.shape) == 3 else roi
    return np.std(gray)


def create_size_visualization(frame, output_path):
    """
    Draw boxes of different sizes in the center of the frame
    so you can see what 50px, 70px, 100px, etc. actually look like.
    """
    vis = frame.copy()
    h, w = frame.shape[:2]
    
    # Center of frame
    cx, cy = w // 2, h // 2
    
    # Colors for each size (rainbow-ish)
    colors = [
        (0, 0, 255),    # Red - 50px
        (0, 165, 255),  # Orange - 70px
        (0, 255, 255),  # Yellow - 100px
        (0, 255, 0),    # Green - 130px
        (255, 0, 0),    # Blue - 150px
    ]
    
    # Draw boxes centered, largest first (so smaller ones are visible on top)
    for i, size in enumerate(reversed(BOX_SIZES)):
        color = colors[len(BOX_SIZES) - 1 - i]
        x1 = cx - size // 2
        y1 = cy - size // 2
        x2 = cx + size // 2
        y2 = cy + size // 2
        
        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
    
    # Add legend on the side
    legend_x = 20
    legend_y = 50
    cv2.putText(vis, "Box Sizes:", (legend_x, legend_y), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    
    for i, size in enumerate(BOX_SIZES):
        color = colors[i]
        y = legend_y + 35 + i * 30
        cv2.rectangle(vis, (legend_x, y - 15), (legend_x + 20, y + 5), color, -1)
        cv2.putText(vis, f"{size}x{size} px", (legend_x + 30, y), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    
    # Add title
    cv2.putText(vis, "Face Size Reference (centered boxes)", (w // 2 - 200, 30), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    
    cv2.imwrite(output_path, vis)
    print(f"  Saved: {output_path}")
    return vis


def create_brightness_visualization(frame, output_path):
    """
    Draw medium-sized boxes at 4-5 different locations and show
    the brightness value at each location.
    """
    vis = frame.copy()
    h, w = frame.shape[:2]
    box_size = SAMPLE_BOX_SIZE
    
    # Sample locations (spread across the frame)
    locations = [
        (w // 4, h // 4, "Top-Left"),
        (3 * w // 4, h // 4, "Top-Right"),
        (w // 2, h // 2, "Center"),
        (w // 4, 3 * h // 4, "Bottom-Left"),
        (3 * w // 4, 3 * h // 4, "Bottom-Right"),
    ]
    
    # Colors
    colors = [
        (255, 100, 100),  # Light blue
        (100, 255, 100),  # Light green
        (100, 100, 255),  # Light red
        (255, 255, 100),  # Cyan
        (255, 100, 255),  # Magenta
    ]
    
    for i, (cx, cy, label) in enumerate(locations):
        x1 = cx - box_size // 2
        y1 = cy - box_size // 2
        x2 = cx + box_size // 2
        y2 = cy + box_size // 2
        
        # Clamp to frame bounds
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        
        # Extract ROI and compute brightness
        roi = frame[y1:y2, x1:x2]
        brightness = compute_brightness(roi)
        
        # Draw box
        color = colors[i]
        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
        
        # Draw label with brightness value
        text = f"{label}: {brightness:.1f}"
        cv2.putText(vis, text, (x1, y1 - 10), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    
    # Add title and legend
    cv2.putText(vis, f"Brightness Samples ({box_size}x{box_size}px boxes)", (20, 30), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    
    # Add threshold reference
    thresholds = cfg.QUALITY_THRESHOLDS['brightness']
    cv2.putText(vis, f"Thresholds: critical={thresholds['critical_low']}-{thresholds['critical_high']}, good={thresholds['good_low']}-{thresholds['good_high']}", 
               (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    
    cv2.imwrite(output_path, vis)
    print(f"  Saved: {output_path}")
    return vis


def create_sharpness_visualization(frame, output_path):
    """
    Draw medium-sized boxes at 4-5 different locations and show
    the sharpness (Laplacian variance) at each location.
    """
    vis = frame.copy()
    h, w = frame.shape[:2]
    box_size = SAMPLE_BOX_SIZE
    
    # Sample locations (spread across the frame)
    locations = [
        (w // 4, h // 4, "Top-Left"),
        (3 * w // 4, h // 4, "Top-Right"),
        (w // 2, h // 2, "Center"),
        (w // 4, 3 * h // 4, "Bottom-Left"),
        (3 * w // 4, 3 * h // 4, "Bottom-Right"),
    ]
    
    # Colors
    colors = [
        (255, 100, 100),  # Light blue
        (100, 255, 100),  # Light green
        (100, 100, 255),  # Light red
        (255, 255, 100),  # Cyan
        (255, 100, 255),  # Magenta
    ]
    
    for i, (cx, cy, label) in enumerate(locations):
        x1 = cx - box_size // 2
        y1 = cy - box_size // 2
        x2 = cx + box_size // 2
        y2 = cy + box_size // 2
        
        # Clamp to frame bounds
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        
        # Extract ROI and compute sharpness
        roi = frame[y1:y2, x1:x2]
        sharpness = compute_sharpness(roi)
        
        # Draw box
        color = colors[i]
        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
        
        # Draw label with sharpness value
        text = f"{label}: {sharpness:.1f}"
        cv2.putText(vis, text, (x1, y1 - 10), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    
    # Add title
    cv2.putText(vis, f"Sharpness Samples ({box_size}x{box_size}px boxes)", (20, 30), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    
    # Add threshold reference
    thresholds = cfg.QUALITY_THRESHOLDS['sharpness']
    cv2.putText(vis, f"Thresholds: critical={thresholds['critical']}, good={thresholds['good']}", 
               (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    
    cv2.imwrite(output_path, vis)
    print(f"  Saved: {output_path}")
    return vis


def create_contrast_visualization(frame, output_path):
    """
    Draw medium-sized boxes at 4-5 different locations and show
    the contrast (std dev) at each location.
    """
    vis = frame.copy()
    h, w = frame.shape[:2]
    box_size = SAMPLE_BOX_SIZE
    
    # Sample locations (spread across the frame)
    locations = [
        (w // 4, h // 4, "Top-Left"),
        (3 * w // 4, h // 4, "Top-Right"),
        (w // 2, h // 2, "Center"),
        (w // 4, 3 * h // 4, "Bottom-Left"),
        (3 * w // 4, 3 * h // 4, "Bottom-Right"),
    ]
    
    # Colors
    colors = [
        (255, 100, 100),  # Light blue
        (100, 255, 100),  # Light green
        (100, 100, 255),  # Light red
        (255, 255, 100),  # Cyan
        (255, 100, 255),  # Magenta
    ]
    
    for i, (cx, cy, label) in enumerate(locations):
        x1 = cx - box_size // 2
        y1 = cy - box_size // 2
        x2 = cx + box_size // 2
        y2 = cy + box_size // 2
        
        # Clamp to frame bounds
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        
        # Extract ROI and compute contrast
        roi = frame[y1:y2, x1:x2]
        contrast = compute_contrast(roi)
        
        # Draw box
        color = colors[i]
        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
        
        # Draw label with contrast value
        text = f"{label}: {contrast:.1f}"
        cv2.putText(vis, text, (x1, y1 - 10), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    
    # Add title
    cv2.putText(vis, f"Contrast Samples ({box_size}x{box_size}px boxes)", (20, 30), 
               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    
    # Add threshold reference
    thresholds = cfg.QUALITY_THRESHOLDS['contrast']
    cv2.putText(vis, f"Thresholds: critical={thresholds['critical']}, good={thresholds['good']}", 
               (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    
    cv2.imwrite(output_path, vis)
    print(f"  Saved: {output_path}")
    return vis


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 60)
    print("Threshold Visualization Tool")
    print("=" * 60)
    print("\nThis tool draws fixed-size boxes (no face detection)")
    print("to help you visualize what different pixel sizes look like,")
    print("and measures brightness/sharpness at various locations.")
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Connect to camera
    print(f"\nConnecting to camera: {RTSP_URL.split('@')[1] if '@' in RTSP_URL else RTSP_URL}")
    
    if isinstance(RTSP_URL, str) and RTSP_URL.startswith("rtsp://"):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    
    cap = cv2.VideoCapture(RTSP_URL)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    if not cap.isOpened():
        print("ERROR: Cannot connect to camera")
        return
    
    # Capture frame
    print("Capturing frame...")
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        print("ERROR: Cannot read frame")
        return
    
    print(f"Original resolution: {frame.shape[1]}x{frame.shape[0]}")
    
    # Apply cropping
    frame_cropped = crop_frame(frame, CROP_LEFT, CROP_RIGHT, CROP_TOP, CROP_BOTTOM)
    print(f"After crop (30%L/R, 10%T, 30%B): {frame_cropped.shape[1]}x{frame_cropped.shape[0]}")
    
    # Resize
    frame_resized = resize_frame(frame_cropped, TARGET_WIDTH)
    print(f"After resize: {frame_resized.shape[1]}x{frame_resized.shape[0]}")
    
    # Save original cropped frame
    orig_path = os.path.join(OUTPUT_DIR, f"original_{timestamp}.jpg")
    cv2.imwrite(orig_path, frame_resized)
    print(f"\nSaved original: {orig_path}")
    
    # Create visualizations
    print("\nGenerating visualizations...")
    
    # 1. Box sizes
    print("\n1. Box Size Reference:")
    size_path = os.path.join(OUTPUT_DIR, f"size_boxes_{timestamp}.jpg")
    create_size_visualization(frame_resized, size_path)
    
    # 2. Brightness samples
    print("\n2. Brightness Samples:")
    bright_path = os.path.join(OUTPUT_DIR, f"brightness_samples_{timestamp}.jpg")
    create_brightness_visualization(frame_resized, bright_path)
    
    # 3. Sharpness samples
    print("\n3. Sharpness Samples:")
    sharp_path = os.path.join(OUTPUT_DIR, f"sharpness_samples_{timestamp}.jpg")
    create_sharpness_visualization(frame_resized, sharp_path)
    
    # 4. Contrast samples
    print("\n4. Contrast Samples:")
    contrast_path = os.path.join(OUTPUT_DIR, f"contrast_samples_{timestamp}.jpg")
    create_contrast_visualization(frame_resized, contrast_path)
    
    print("\n" + "=" * 60)
    print("Done! Check the output folder:")
    print(f"  {OUTPUT_DIR}")
    print("\nOutput files:")
    print(f"  - size_boxes_{timestamp}.jpg      (box size reference)")
    print(f"  - brightness_samples_{timestamp}.jpg")
    print(f"  - sharpness_samples_{timestamp}.jpg")
    print(f"  - contrast_samples_{timestamp}.jpg")
    print("=" * 60)


if __name__ == "__main__":
    main()
