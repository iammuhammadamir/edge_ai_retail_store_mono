"""
API Client for ClientBridge Website Integration

This module handles communication between the edge device (Jetson/Mac)
and the ClientBridge website backend.
"""

import requests
import base64
import cv2
import numpy as np
from typing import Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class APIResponse:
    """Response from the API"""
    success: bool
    message: str
    status: Optional[str] = None  # "new" or "returning"
    customer_id: Optional[int] = None
    visit_count: Optional[int] = None
    similarity: Optional[float] = None  # For returning customers


class ClientBridgeAPI:
    """
    Client for the ClientBridge website API.
    
    Server-side matching: The edge device sends embeddings to the server,
    and the server decides if it's a new or returning customer.
    
    Usage:
        api = ClientBridgeAPI(
            base_url="https://clientbridge-ten.vercel.app",
            api_key="dev-edge-api-key",
            location_id=1
        )
        
        # Send embedding for identification (server decides new/returning)
        response = api.identify(embedding, frame)
        if response.status == "new":
            print(f"New customer #{response.customer_id}")
        else:
            print(f"Returning customer (visit #{response.visit_count})")
    """
    
    def __init__(
        self,
        base_url: str = "https://clientbridge-ten.vercel.app",
        api_key: str = "dev-edge-api-key",
        location_id: int = 1,
        timeout: int = 10
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.location_id = location_id
        self.timeout = timeout
        
    def _get_headers(self) -> Dict[str, str]:
        """Get headers for API requests"""
        return {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key
        }
    
    def _crop_face_with_bbox(self, frame: np.ndarray, bbox: tuple, padding: float = 0.5) -> np.ndarray:
        """
        Crop frame to face region using provided bounding box.
        
        Args:
            frame: Full frame image
            bbox: (x1, y1, x2, y2) bounding box from face detection
            padding: Extra padding around face (0.5 = 50% on each side)
        
        Returns:
            Cropped face image
        """
        try:
            # Convert to integers (InsightFace returns floats)
            x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
            w = x2 - x1
            h = y2 - y1
            
            # Add padding
            pad_w = int(w * padding)
            pad_h = int(h * padding)
            
            # Calculate crop bounds with padding
            img_h, img_w = frame.shape[:2]
            crop_x1 = max(0, x1 - pad_w)
            crop_y1 = max(0, y1 - pad_h)
            crop_x2 = min(img_w, x2 + pad_w)
            crop_y2 = min(img_h, y2 + pad_h)
            
            cropped = frame[crop_y1:crop_y2, crop_x1:crop_x2]
            
            # Resize to reasonable size for storage (max 400px wide)
            if cropped.shape[1] > 400:
                scale = 400 / cropped.shape[1]
                new_h = int(cropped.shape[0] * scale)
                cropped = cv2.resize(cropped, (400, new_h))
            
            return cropped
            
        except Exception as e:
            print(f"[API] Face crop failed: {e}")
            return frame
    
    def _frame_to_base64(self, frame: np.ndarray, bbox: tuple = None) -> str:
        """
        Convert OpenCV frame to base64 JPEG string, optionally cropping to face.
        
        Args:
            frame: Full frame image
            bbox: (x1, y1, x2, y2) bounding box for face crop. If None, sends full frame.
        """
        if bbox is not None:
            frame = self._crop_face_with_bbox(frame, bbox)
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return base64.b64encode(buffer).decode('utf-8')
    
    def health_check(self) -> bool:
        """
        Check if the API is reachable.
        
        Returns:
            True if API is healthy, False otherwise
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/edge/health",
                headers=self._get_headers(),
                timeout=self.timeout
            )
            return response.status_code == 200 and response.json().get("success", False)
        except Exception as e:
            print(f"[API] Health check failed: {e}")
            return False
    
    def enroll_visitor(
        self,
        person_id: str,
        frame: Optional[np.ndarray] = None,
        timestamp: Optional[str] = None
    ) -> APIResponse:
        """
        Enroll a new visitor in the system.
        
        Args:
            person_id: Unique identifier for the visitor (from face recognition)
            frame: Best frame of the visitor's face (OpenCV BGR image)
            timestamp: ISO format timestamp (optional, defaults to server time)
            
        Returns:
            APIResponse with success status and customer details
        """
        try:
            payload = {
                "personId": person_id,
                "locationId": self.location_id
            }
            
            if frame is not None:
                payload["imageBase64"] = self._frame_to_base64(frame)
                
            if timestamp:
                payload["timestamp"] = timestamp
            
            response = requests.post(
                f"{self.base_url}/api/edge/enroll",
                json=payload,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            data = response.json()
            
            return APIResponse(
                success=data.get("success", False),
                message=data.get("message", "Unknown error"),
                customer_id=data.get("customerId"),
                visit_count=data.get("visitCount"),
                is_regular=data.get("isRegular")
            )
            
        except requests.exceptions.Timeout:
            return APIResponse(success=False, message="Request timed out")
        except requests.exceptions.ConnectionError:
            return APIResponse(success=False, message="Could not connect to server")
        except Exception as e:
            return APIResponse(success=False, message=str(e))
    
    def record_visit(
        self,
        person_id: str,
        frame: Optional[np.ndarray] = None,
        timestamp: Optional[str] = None
    ) -> APIResponse:
        """
        Record a visit from a returning visitor.
        
        Args:
            person_id: Unique identifier for the visitor
            frame: Latest frame of the visitor (optional, for photo update)
            timestamp: ISO format timestamp (optional)
            
        Returns:
            APIResponse with success status and updated visit count
        """
        try:
            payload = {
                "personId": person_id,
                "locationId": self.location_id
            }
            
            if frame is not None:
                payload["imageBase64"] = self._frame_to_base64(frame)
                
            if timestamp:
                payload["timestamp"] = timestamp
            
            response = requests.post(
                f"{self.base_url}/api/edge/visit",
                json=payload,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            data = response.json()
            
            return APIResponse(
                success=data.get("success", False),
                message=data.get("message", "Unknown error"),
                customer_id=data.get("customerId"),
                visit_count=data.get("visitCount"),
                is_regular=data.get("isRegular")
            )
            
        except requests.exceptions.Timeout:
            return APIResponse(success=False, message="Request timed out")
        except requests.exceptions.ConnectionError:
            return APIResponse(success=False, message="Could not connect to server")
        except Exception as e:
            return APIResponse(success=False, message=str(e))

    def identify(
        self,
        embedding: np.ndarray,
        frame: Optional[np.ndarray] = None,
        bbox: tuple = None
    ) -> APIResponse:
        """
        Send embedding to server for identification.
        Server performs matching and decides if new or returning customer.
        
        This is the PRIMARY method for the new server-side matching architecture.
        
        Args:
            embedding: 512-dimensional face embedding from InsightFace
            frame: Best frame of the visitor's face (optional, for photo storage)
            bbox: (x1, y1, x2, y2) bounding box for face crop (from InsightFace detection)
            
        Returns:
            APIResponse with:
                - status: "new" or "returning"
                - customer_id: Database ID of the customer
                - visit_count: Total number of visits
                - similarity: Match similarity (only for returning customers)
        """
        try:
            payload = {
                "embedding": embedding.tolist(),  # Convert numpy to list
                "locationId": self.location_id
            }
            
            if frame is not None:
                payload["imageBase64"] = self._frame_to_base64(frame, bbox)
            
            response = requests.post(
                f"{self.base_url}/api/edge/identify",
                json=payload,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            
            data = response.json()
            
            return APIResponse(
                success=data.get("success", False),
                message=data.get("message", ""),
                status=data.get("status"),  # "new" or "returning"
                customer_id=data.get("customerId"),
                visit_count=data.get("visitCount"),
                similarity=data.get("similarity")
            )
            
        except requests.exceptions.Timeout:
            return APIResponse(success=False, message="Request timed out")
        except requests.exceptions.ConnectionError:
            return APIResponse(success=False, message="Could not connect to server")
        except Exception as e:
            return APIResponse(success=False, message=str(e))


# Singleton instance for easy import
_api_instance: Optional[ClientBridgeAPI] = None


def init_api(
    base_url: str = "https://clientbridge-ten.vercel.app",
    api_key: str = "dev-edge-api-key",
    location_id: int = 1
) -> ClientBridgeAPI:
    """
    Initialize the global API client.
    
    Call this once at startup with your configuration.
    """
    global _api_instance
    _api_instance = ClientBridgeAPI(
        base_url=base_url,
        api_key=api_key,
        location_id=location_id
    )
    return _api_instance


def get_api() -> Optional[ClientBridgeAPI]:
    """Get the global API client instance."""
    return _api_instance


# Quick test
if __name__ == "__main__":
    print("Testing API client...")
    
    api = ClientBridgeAPI()
    
    # Test health check
    if api.health_check():
        print("✓ API is healthy")
        
        # Test identify with a fake embedding (512 random floats)
        fake_embedding = np.random.randn(512).astype(np.float32)
        
        # First call - should be "new"
        response = api.identify(fake_embedding)
        print(f"First identify: status={response.status}, customer_id={response.customer_id}")
        
        # Second call with same embedding - should be "returning"
        response = api.identify(fake_embedding)
        print(f"Second identify: status={response.status}, visits={response.visit_count}, similarity={response.similarity:.3f}")
        
        # Test with different embedding - should be "new" again
        different_embedding = np.random.randn(512).astype(np.float32)
        response = api.identify(different_embedding)
        print(f"Different person: status={response.status}, customer_id={response.customer_id}")
    else:
        print("✗ API is not reachable. Is the server running?")
