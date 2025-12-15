#!/usr/bin/env python3
"""
Face Recognition Module
Extracts face embeddings and matches against known visitors.
Uses InsightFace with buffalo_s/buffalo_l model (ArcFace).
"""

import cv2
import numpy as np
import logging
import os
from typing import Optional, Tuple, List

# Suppress InsightFace download messages
os.environ['INSIGHTFACE_LOG_LEVEL'] = '50'

import insightface
from insightface.app import FaceAnalysis

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION (from config.py or defaults)
# =============================================================================

try:
    import config as cfg
    MODEL_NAME = cfg.INSIGHTFACE_MODEL
    MODEL_DIR = cfg.MODEL_DIR
    SIMILARITY_THRESHOLD = cfg.SIMILARITY_THRESHOLD
except ImportError:
    MODEL_NAME = "buffalo_s"
    MODEL_DIR = "/home/mafiq/zmisc/models/insightface"
    SIMILARITY_THRESHOLD = 0.45

# =============================================================================
# FACE ANALYZER
# =============================================================================

_face_app = None

def get_face_analyzer():
    """Get or initialize the face analyzer (singleton)."""
    global _face_app
    
    if _face_app is None:
        logger.info("Initializing InsightFace model (first run downloads ~100MB)...")
        
        os.makedirs(MODEL_DIR, exist_ok=True)
        
        # Use CPU to prevent OOM on Jetson Orin Nano (shared memory)
        # GPU works for lightweight YuNet detection, but InsightFace detection/recognition
        # is too heavy for the remaining memory budget.
        _face_app = FaceAnalysis(
            name=MODEL_NAME,
            root=MODEL_DIR,
            providers=['CPUExecutionProvider']
        )
        
        # det_size affects detection accuracy vs speed
        # ctx_id=-1 uses CPU
        _face_app.prepare(ctx_id=-1, det_size=(640, 640))
        
        logger.info(f"InsightFace model '{MODEL_NAME}' loaded")
    
    return _face_app

# =============================================================================
# EMBEDDING EXTRACTION
# =============================================================================

def extract_embeddings(frame: np.ndarray) -> List[Tuple[np.ndarray, np.ndarray, float]]:
    """
    Extract face embeddings from a frame.
    
    Args:
        frame: BGR image (OpenCV format)
    
    Returns:
        List of (embedding, bbox, det_score) tuples for each detected face
        - embedding: 512-dim normalized vector
        - bbox: [x1, y1, x2, y2] face bounding box
        - det_score: detection confidence
    """
    app = get_face_analyzer()
    
    # InsightFace expects BGR (OpenCV default)
    faces = app.get(frame)
    
    results = []
    for face in faces:
        if hasattr(face, 'embedding') and face.embedding is not None:
            results.append((
                face.embedding,
                face.bbox,
                face.det_score
            ))
    
    return results

def extract_single_embedding(frame: np.ndarray) -> Optional[Tuple[np.ndarray, float]]:
    """
    Extract embedding for the largest/most prominent face in frame.
    
    Returns:
        (embedding, det_score) or None if no face found
    """
    results = extract_embeddings(frame)
    
    if not results:
        return None
    
    # Return the face with highest detection score
    best = max(results, key=lambda x: x[2])
    return (best[0], best[2])

# =============================================================================
# SIMILARITY MATCHING
# =============================================================================

def cosine_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
    """
    Compute cosine similarity between two embeddings.
    
    Returns:
        Similarity score in range [-1, 1], higher = more similar
    """
    # Normalize embeddings to unit vectors
    norm1 = np.linalg.norm(emb1)
    norm2 = np.linalg.norm(emb2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(np.dot(emb1, emb2) / (norm1 * norm2))

def find_best_match(
    query_embedding: np.ndarray,
    known_embeddings: List[Tuple[int, np.ndarray]],
    threshold: float = SIMILARITY_THRESHOLD
) -> Optional[Tuple[int, float]]:
    """
    Find the best matching visitor for a query embedding.
    
    Args:
        query_embedding: 512-dim embedding of detected face
        known_embeddings: List of (visitor_id, embedding) tuples
        threshold: Minimum similarity to consider a match
    
    Returns:
        (visitor_id, similarity) if match found, None otherwise
    """
    if not known_embeddings:
        return None
    
    best_match = None
    best_similarity = -1
    
    for visitor_id, known_emb in known_embeddings:
        similarity = cosine_similarity(query_embedding, known_emb)
        
        if similarity > best_similarity:
            best_similarity = similarity
            best_match = visitor_id
    
    if best_similarity >= threshold:
        return (best_match, best_similarity)
    
    return None

# =============================================================================
# TESTING
# =============================================================================

def test_on_image(image_path: str):
    """Test face recognition on a single image."""
    logger.info(f"Testing on: {image_path}")
    
    frame = cv2.imread(image_path)
    if frame is None:
        logger.error(f"Cannot read image: {image_path}")
        return
    
    results = extract_embeddings(frame)
    
    logger.info(f"Found {len(results)} face(s)")
    for i, (emb, bbox, score) in enumerate(results):
        logger.info(f"  Face {i+1}: bbox={bbox.astype(int).tolist()}, score={score:.3f}")
        logger.info(f"           embedding shape={emb.shape}, norm={np.linalg.norm(emb):.3f}")

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    
    if len(sys.argv) > 1:
        test_on_image(sys.argv[1])
    else:
        print("Usage: python face_recognition.py <image_path>")
        print("\nInitializing model to verify installation...")
        get_face_analyzer()
        print("Model loaded successfully!")
