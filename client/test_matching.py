#!/usr/bin/env python3
"""
Interactive Face Matching Test
For testing face recognition during client calls.

Usage:
    python test_matching.py

Instructions:
    1. Run the script
    2. Ask client to stand in front of camera
    3. Press ENTER to capture and process
    4. Script will show if person is NEW or RETURNING
    5. Repeat with same person or different person to test matching
    6. Press 'q' + ENTER to quit
    7. Press 'r' + ENTER to reset database (clear all visitors)
"""

import cv2
import os
import sys
from datetime import datetime

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database as db
from face_recognition import (
    extract_embeddings,
    find_best_match,
    get_face_analyzer,
    cosine_similarity,
    SIMILARITY_THRESHOLD
)

# =============================================================================
# CONFIGURATION
# =============================================================================

RTSP_URL = "rtsp://admin:SmoothFlow@10.0.0.227:554/h264Preview_01_main"
TARGET_WIDTH = 1280
DEBUG_DIR = "/home/mafiq/zmisc/debug/face_recognition"

# =============================================================================
# HELPERS
# =============================================================================

def resize_frame(frame, target_width):
    h, w = frame.shape[:2]
    scale = target_width / w
    new_h = int(h * scale)
    return cv2.resize(frame, (target_width, new_h))

def save_debug_image(frame, face_results, capture_num):
    """Save debug image with face boxes drawn."""
    os.makedirs(DEBUG_DIR, exist_ok=True)
    
    debug_frame = frame.copy()
    
    # Draw face boxes if any
    if face_results:
        for embedding, bbox, det_score in face_results:
            x1, y1, x2, y2 = bbox.astype(int)
            cv2.rectangle(debug_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(debug_frame, f"{det_score:.2f}", (x1, y1-10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    else:
        # No face - add text
        cv2.putText(debug_frame, "NO FACE DETECTED", (50, 50),
                   cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{DEBUG_DIR}/capture_{capture_num:03d}_{timestamp}.jpg"
    cv2.imwrite(filename, debug_frame)
    print(f"  Debug image saved: {filename}")
    return filename

def reset_database():
    """Clear all visitors from database."""
    if os.path.exists(db.DB_PATH):
        os.remove(db.DB_PATH)
    db.init_db()
    print("✓ Database reset - all visitors cleared")

def capture_fresh_frame():
    """Capture a truly fresh frame by reconnecting to camera."""
    # Reconnect to get fresh frame (avoids stale buffer issues)
    cap = cv2.VideoCapture(RTSP_URL)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    if not cap.isOpened():
        return None
    
    # Small flush just in case
    for _ in range(3):
        cap.grab()
    
    ret, frame = cap.read()
    cap.release()
    
    if ret:
        return resize_frame(frame, TARGET_WIDTH)
    return None

# =============================================================================
# MAIN TEST LOOP
# =============================================================================

def run_test():
    print("=" * 60)
    print("FACE MATCHING TEST")
    print("=" * 60)
    print(f"Similarity threshold: {SIMILARITY_THRESHOLD}")
    print()
    print("Commands:")
    print("  ENTER  - Capture and process face")
    print("  r      - Reset database (clear all visitors)")
    print("  q      - Quit")
    print("=" * 60)
    
    # Initialize
    print("\nLoading face recognition model...")
    get_face_analyzer()
    
    # Test camera connection
    print("Testing camera connection...")
    test_frame = capture_fresh_frame()
    if test_frame is None:
        print("ERROR: Cannot connect to camera")
        return
    
    print(f"Camera OK: {test_frame.shape[1]}x{test_frame.shape[0]}")
    print("\n" + "=" * 60)
    print("READY - Ask person to stand in front of camera, then press ENTER")
    print("=" * 60 + "\n")
    
    capture_count = 0
    
    while True:
        # Wait for user input
        user_input = input(">>> ").strip().lower()
        
        if user_input == 'q':
            break
        elif user_input == 'r':
            reset_database()
            continue
        
        # Capture fresh frame (reconnects to camera)
        print("Capturing...")
        frame = capture_fresh_frame()
        if frame is None:
            print("ERROR: Failed to capture frame")
            continue
        
        capture_count += 1
        print(f"\n--- Capture #{capture_count} ---")
        
        # Extract faces
        print(f"  Frame shape: {frame.shape}")
        face_results = extract_embeddings(frame)
        
        # Always save debug image
        save_debug_image(frame, face_results, capture_count)
        
        if not face_results:
            print("⚠ No face detected - ask person to face the camera")
            print("  Check the debug image to see what the camera captured")
            continue
        
        print(f"Detected {len(face_results)} face(s)")
        
        # Load known embeddings
        known_embeddings = db.get_all_embeddings()
        
        for i, (embedding, bbox, det_score) in enumerate(face_results):
            print(f"\nFace {i+1}:")
            print(f"  Detection confidence: {det_score:.2f}")
            print(f"  Bounding box: {bbox.astype(int).tolist()}")
            
            # Show similarity to all known visitors
            if known_embeddings:
                print(f"\n  Comparing against {len(known_embeddings)} known visitor(s):")
                similarities = []
                for visitor_id, known_emb in known_embeddings:
                    sim = cosine_similarity(embedding, known_emb)
                    similarities.append((visitor_id, sim))
                    status = "✓ MATCH" if sim >= SIMILARITY_THRESHOLD else ""
                    print(f"    Visitor #{visitor_id}: similarity = {sim:.3f} {status}")
                
                # Find best match
                match = find_best_match(embedding, known_embeddings)
                
                if match:
                    visitor_id, similarity = match
                    print(f"\n  ✅ RETURNING VISITOR #{visitor_id}")
                    print(f"     Similarity: {similarity:.3f} (threshold: {SIMILARITY_THRESHOLD})")
                    
                    # Update visit count
                    db.record_visit(visitor_id, f"test_{capture_count}", similarity)
                else:
                    best_id, best_sim = max(similarities, key=lambda x: x[1])
                    print(f"\n  ❌ NO MATCH (best was #{best_id} at {best_sim:.3f})")
                    print(f"     Creating new visitor...")
                    
                    visitor_id = db.add_visitor(embedding)
                    print(f"  ✅ NEW VISITOR #{visitor_id} enrolled")
            else:
                print("\n  No visitors in database yet")
                visitor_id = db.add_visitor(embedding)
                print(f"  ✅ FIRST VISITOR #{visitor_id} enrolled")
        
        # Show database state
        print(f"\n  Database: {db.get_visitor_count()} unique visitor(s)")
        print()
    
    print("\nTest ended.")
    print(f"Final database: {db.get_visitor_count()} unique visitor(s)")

if __name__ == "__main__":
    run_test()
