/**
 * Edge Device API Routes
 * 
 * These endpoints are called by the Jetson edge device to report visitor data.
 * Authentication: API Key in X-API-Key header
 */

import { type Application, type Request, type Response, type NextFunction } from "express";
import type { IStorage } from "./storage";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { findBestMatch, SIMILARITY_THRESHOLD } from "./matching";

// API Key for edge device authentication
// In production, this should come from environment variable
const EDGE_API_KEY = process.env.EDGE_API_KEY || "dev-edge-api-key-change-in-production";

/**
 * Middleware to verify API key for edge device requests
 */
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"];
  
  if (!apiKey || apiKey !== EDGE_API_KEY) {
    return res.status(401).json({ 
      success: false, 
      message: "Invalid or missing API key" 
    });
  }
  
  next();
}

/**
 * Save base64 image to filesystem
 * Returns the URL path to access the image
 */
function saveBase64Image(base64Data: string, personId: string): string | null {
  try {
    // Remove data URL prefix if present
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");
    
    // Create customers directory if it doesn't exist
    const customersDir = path.join(process.cwd(), "public", "customers");
    if (!fs.existsSync(customersDir)) {
      fs.mkdirSync(customersDir, { recursive: true });
    }
    
    // Generate unique filename
    const filename = `${personId}_${Date.now()}.jpg`;
    const filepath = path.join(customersDir, filename);
    
    fs.writeFileSync(filepath, buffer);
    
    // Return URL path (relative to static serving)
    return `/customers/${filename}`;
  } catch (error) {
    console.error("Failed to save image:", error);
    return null;
  }
}

export function registerEdgeRoutes(app: Application, storage: IStorage) {
  
  /**
   * POST /api/edge/identify
   * 
   * Unified endpoint for face identification.
   * Server performs matching and decides if new or returning customer.
   * 
   * Request body:
   * {
   *   "embedding": [0.1, 0.2, ...],  // 512 floats
   *   "imageBase64": "...",          // Face image (optional)
   *   "locationId": 1
   * }
   * 
   * Response:
   * {
   *   "success": true,
   *   "status": "new" | "returning",
   *   "customerId": 123,
   *   "visitCount": 5,
   *   "similarity": 0.87  // Only for returning customers
   * }
   */
  app.post("/api/edge/identify", requireApiKey, async (req: Request, res: Response) => {
    try {
      const { embedding, imageBase64, locationId } = req.body;
      
      // Validate required fields
      if (!embedding || !Array.isArray(embedding)) {
        return res.status(400).json({ 
          success: false, 
          message: "embedding is required and must be an array" 
        });
      }
      
      if (!locationId) {
        return res.status(400).json({ 
          success: false, 
          message: "locationId is required" 
        });
      }
      
      // Get all customers with embeddings for this location
      const customers = await storage.getAllCustomers(parseInt(locationId));
      const customersWithEmbeddings = customers.map((c: { id: number; faceId: string; embedding: string | null }) => ({
        id: c.id,
        faceId: c.faceId,
        embedding: c.embedding
      }));
      
      // Find best match using cosine similarity
      const match = findBestMatch(embedding, customersWithEmbeddings, SIMILARITY_THRESHOLD);
      
      if (match) {
        // Returning customer - increment visit count
        const updatedCustomer = await storage.incrementCustomerPoints(match.id);
        
        if (!updatedCustomer) {
          return res.status(500).json({ 
            success: false, 
            message: "Failed to update customer" 
          });
        }
        
        console.log(`[EDGE] Returning customer #${match.id} (similarity: ${match.similarity.toFixed(3)}, visits: ${updatedCustomer.points})`);
        
        return res.json({
          success: true,
          status: "returning",
          customerId: updatedCustomer.id,
          visitCount: updatedCustomer.points,
          similarity: match.similarity
        });
      } else {
        // New customer - create record with embedding
        const faceId = `visitor_${Date.now()}`;
        
        // Save image if provided
        let photoUrl: string | null = null;
        if (imageBase64) {
          photoUrl = saveBase64Image(imageBase64, faceId);
        }
        
        const customer = await storage.createCustomer({
          faceId,
          name: null,
          photoUrl,
          points: 1,
          lastSeen: new Date(),
          locationId: parseInt(locationId),
          embedding: JSON.stringify(embedding),
        });
        
        console.log(`[EDGE] New customer enrolled: ${faceId} (ID: ${customer.id})`);
        
        return res.json({
          success: true,
          status: "new",
          customerId: customer.id,
          visitCount: 1
        });
      }
      
    } catch (error) {
      console.error("[EDGE] Identify error:", error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : "Internal server error" 
      });
    }
  });

  /**
   * GET /api/edge/health
   * 
   * Health check endpoint for edge device to verify connectivity
   */
  app.get("/api/edge/health", requireApiKey, (req: Request, res: Response) => {
    res.json({
      success: true,
      message: "Edge API is healthy",
      timestamp: new Date().toISOString()
    });
  });
  
  console.log("[EDGE] Edge device routes registered: /api/edge/identify, /api/edge/health");
}
