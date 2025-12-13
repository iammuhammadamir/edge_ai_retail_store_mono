import {
  type Application,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  insertVideoClipSchema,
  insertReviewSchema,
  insertCustomerSchema,
  insertInventoryItemSchema,
  insertLocationSchema,
  insertCameraSchema,
  insertUserSchema,
} from "../shared/schema";
import type { IStorage } from "./storage";
import multer from "multer";
import path from "path";
import { nanoid } from "nanoid";
import { verifyToken, extractToken, signToken, type JWTPayload } from "./lib/jwt";

// Extend Express Request type to include user from JWT
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

// Middleware to check if user is authenticated (supports both JWT and session)
function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Try JWT first
  const token = extractToken(req.headers.authorization);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      return next();
    }
    return res.status(401).json({ message: "Invalid or expired token." });
  }
  
  // Fall back to session (for backward compatibility during migration)
  if (req.session?.user) {
    req.user = {
      username: req.session.user.username,
      role: req.session.user.role,
      locationId: req.session.user.locationId ?? null,
    };
    return next();
  }
  
  return res.status(401).json({ message: "Authentication required." });
}

// Middleware to check if user is an owner
function ownerOnly(req: Request, res: Response, next: NextFunction) {
  // First ensure user is authenticated
  const token = extractToken(req.headers.authorization);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      if (payload.role !== "owner") {
        return res.status(403).json({ message: "Access denied. Owner role required." });
      }
      return next();
    }
    return res.status(401).json({ message: "Invalid or expired token." });
  }
  
  // Fall back to session
  if (req.session?.user) {
    req.user = {
      username: req.session.user.username,
      role: req.session.user.role,
      locationId: req.session.user.locationId ?? null,
    };
    if (req.session.user.role !== "owner") {
      return res.status(403).json({ message: "Access denied. Owner role required." });
    }
    return next();
  }
  
  return res.status(401).json({ message: "Authentication required." });
}

function ownerAndReviewerOnly(req: Request, res: Response, next: NextFunction) {
  // First ensure user is authenticated
  const token = extractToken(req.headers.authorization);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      if (payload.role !== "owner" && payload.role !== "reviewer") {
        return res.status(403).json({ message: "Access denied. Owner or Reviewer role required." });
      }
      return next();
    }
    return res.status(401).json({ message: "Invalid or expired token." });
  }
  
  // Fall back to session
  if (req.session?.user) {
    req.user = {
      username: req.session.user.username,
      role: req.session.user.role,
      locationId: req.session.user.locationId ?? null,
    };
    if (req.session.user.role !== "owner" && req.session.user.role !== "reviewer") {
      return res.status(403).json({ message: "Access denied. Owner or Reviewer role required." });
    }
    return next();
  }
  
  return res.status(401).json({ message: "Authentication required." });
}

// Configure multer for video file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/videos");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${nanoid()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".mp4" && ext !== ".mov" && ext !== ".avi") {
      return cb(new Error("Only video files are allowed"));
    }
    cb(null, true);
  },
});

// Helper function to verify reCAPTCHA token
async function verifyCaptcha(token: string): Promise<boolean> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    console.error("RECAPTCHA_SECRET_KEY not configured");
    return false;
  }

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `secret=${secretKey}&response=${token}`,
    });

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error("Error verifying CAPTCHA:", error);
    return false;
  }
}

// Server-side tracking of failed login attempts per IP address
const failedLoginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const FAILED_ATTEMPTS_THRESHOLD = 3;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function getClientIP(req: Request): string {
  // Use Express's req.ip which respects trust proxy configuration
  // This prevents IP spoofing - Express validates proxy headers based on trust proxy setting
  // Fallback to socket address if req.ip is unavailable
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function trackFailedAttempt(ip: string): number {
  const now = Date.now();
  const record = failedLoginAttempts.get(ip);

  if (record && (now - record.lastAttempt) < ATTEMPT_WINDOW_MS) {
    // Within the time window, increment count
    record.count += 1;
    record.lastAttempt = now;
    return record.count;
  } else {
    // First attempt or outside time window, reset
    failedLoginAttempts.set(ip, { count: 1, lastAttempt: now });
    return 1;
  }
}

function getFailedAttemptCount(ip: string): number {
  const record = failedLoginAttempts.get(ip);
  if (!record) return 0;
  
  const now = Date.now();
  if ((now - record.lastAttempt) >= ATTEMPT_WINDOW_MS) {
    // Attempts have expired
    failedLoginAttempts.delete(ip);
    return 0;
  }
  
  return record.count;
}

function clearFailedAttempts(ip: string): void {
  failedLoginAttempts.delete(ip);
}

export function registerRoutes(app: Application, storage: IStorage) {
  // ===== Authentication Routes =====
  app.post("/api/auth/login", async (req, res) => {
    const { username, password, captchaToken } = req.body;
    const clientIP = getClientIP(req);
    const failedAttempts = getFailedAttemptCount(clientIP);

    // Require CAPTCHA if failed attempts exceed threshold
    if (failedAttempts >= FAILED_ATTEMPTS_THRESHOLD) {
      if (!captchaToken) {
        // Track this as a failed attempt to prevent bypass
        trackFailedAttempt(clientIP);
        return res.status(400).json({ 
          message: "CAPTCHA verification required after multiple failed attempts.",
          requiresCaptcha: true,
        });
      }

      const captchaValid = await verifyCaptcha(captchaToken);
      if (!captchaValid) {
        // Track this as a failed attempt to prevent bypass
        trackFailedAttempt(clientIP);
        return res.status(400).json({ 
          message: "CAPTCHA verification failed. Please try again.",
          requiresCaptcha: true,
        });
      }
    }

    const user = await storage.getUser(username);

    if (!user || user.password !== password) {
      // Track failed attempt
      const newCount = trackFailedAttempt(clientIP);
      
      return res.status(401).json({ 
        message: "Invalid credentials",
        requiresCaptcha: newCount >= FAILED_ATTEMPTS_THRESHOLD,
      });
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(clientIP);

    // Generate JWT token
    const token = signToken({
      username: user.username,
      role: user.role,
      locationId: user.locationId ?? null,
    });

    // Also set session for backward compatibility
    req.session.regenerate((err) => {
      if (err) {
        // Session failed but JWT is fine, continue
        console.warn("Session regeneration failed, using JWT only");
      } else {
        req.session.user = {
          username: user.username,
          role: user.role as "owner" | "manager" | "reviewer",
          locationId: user.locationId ?? undefined,
        };
        req.session.save(() => {}); // Fire and forget
      }

      // Return JWT token and user data
      res.json({
        token,
        user: {
          username: user.username,
          role: user.role,
          locationId: user.locationId,
        },
      });
    });
  });

  // Get current user (supports both JWT and session)
  app.get("/api/auth/me", (req, res) => {
    // Try JWT first
    const token = extractToken(req.headers.authorization);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        return res.json(payload);
      }
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    
    // Fall back to session
    if (req.session?.user) {
      return res.json(req.session.user);
    }
    
    return res.status(401).json({ message: "Not authenticated" });
  });

  // Logout endpoint (clears session, client should discard JWT)
  app.post("/api/auth/logout", (req, res) => {
    // Clear session if exists
    if (req.session) {
      req.session.destroy(() => {});
    }
    res.clearCookie("connect.sid");
    // JWT is stateless - client must discard it
    res.json({ message: "Logged out successfully" });
  });

  // ===== Video Clip Routes =====
  app.post("/api/clips/upload", upload.single("video"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No video file provided" });
      }

      const videoUrl = `/videos/${req.file.filename}`;
      const locationId = parseInt(req.body.locationId || "1"); // Default to Main Store
      const cameraId = req.body.cameraId ? parseInt(req.body.cameraId) : null;

      const clipData = insertVideoClipSchema.parse({
        filename: req.file.originalname,
        url: videoUrl,
        status: "pending",
        locationId,
        cameraId,
      });

      const clip = await storage.createClip(clipData);

      // Note: Face detection is now handled by edge devices via /api/edge/identify
      // Video clips are stored for review purposes only

      res.json(clip);
    } catch (error) {
      res
        .status(400)
        .json({
          message: error instanceof Error ? error.message : "Upload failed",
        });
    }
  });

  app.get("/api/clips", async (req, res) => {
    const locationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;
    const clips = await storage.getAllClips(locationId);
    res.json(clips);
  });

  app.get("/api/clips/:id", async (req, res) => {
    const clip = await storage.getClipById(parseInt(req.params.id));
    if (!clip) {
      return res.status(404).json({ message: "Clip not found" });
    }
    res.json(clip);
  });

  // ===== Review Routes =====
  app.get("/api/reviews", requireAuth, async (req, res) => {
    const userRole = req.user!.role;
    const username = req.user!.username;
    const requestedLocationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;

    // For non-owners, enforce location-based access control
    if (userRole !== "owner" && userRole !== "reviewer") {
      const user = await storage.getUser(username);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!user.locationId) {
        return res
          .status(403)
          .json({ message: "User has no assigned location" });
      }

      // Non-owners can ONLY access reviews from their assigned location
      // Get all clips for this location, then filter reviews
      const clips = await storage.getAllClips(user.locationId);
      const clipIds = clips.map((c) => c.id);
      const allReviews = await storage.getAllReviews();
      const filteredReviews = allReviews.filter((r) =>
        r.clipId && clipIds.includes(r.clipId),
      );
      return res.json(filteredReviews);
    }

    // Owners can filter by location or see all reviews
    if (requestedLocationId) {
      const clips = await storage.getAllClips(requestedLocationId);
      const clipIds = clips.map((c) => c.id);
      const allReviews = await storage.getAllReviews();
      const filteredReviews = allReviews.filter((r) =>
        r.clipId && clipIds.includes(r.clipId),
      );
      return res.json(filteredReviews);
    }

    const reviews = await storage.getAllReviews();
    res.json(reviews);
  });

  app.post("/api/reviews", async (req, res) => {
    try {
      const reviewData = insertReviewSchema.parse(req.body);
      const review = await storage.createReview(reviewData);

      // Update clip status based on review decision
      if (reviewData.clipId) {
        await storage.updateClipStatus(reviewData.clipId, reviewData.decision);

        // Create notification for confirmed theft
        if (reviewData.decision === "confirmed_theft") {
          const clip = await storage.getClipById(reviewData.clipId);
          await storage.createNotification({
            type: "theft_confirmed",
            title: "Theft Confirmed",
            message: `Theft confirmed in ${clip?.filename || "video clip"} by ${reviewData.reviewerUsername}`,
            relatedId: review.id,
            isRead: false,
          });
        }
      }

      res.json(review);
    } catch (error) {
      res
        .status(400)
        .json({
          message: error instanceof Error ? error.message : "Review failed",
        });
    }
  });

  app.get("/api/clips/:id/reviews", async (req, res) => {
    const reviews = await storage.getReviewsByClipId(parseInt(req.params.id));
    res.json(reviews);
  });

  // ===== Camera Review Routes =====
  app.get("/api/camera-reviews", requireAuth, async (req, res) => {
    const userRole = req.user!.role;
    const username = req.user!.username;
    const requestedLocationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;

    const allReviews = await storage.getAllReviews();
    
    // Filter to only camera reviews (where cameraId is set)
    const cameraReviews = allReviews.filter((r) => r.cameraId != null);

    // For non-owners, enforce location-based access control
    if (userRole !== "owner" && userRole !== "reviewer") {
      const user = await storage.getUser(username);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!user.locationId)  {
        return res
          .status(403)
          .json({ message: "User has no assigned location" });
      }

      // Get cameras for user's location and filter reviews
      const cameras = await storage.getCamerasByLocation(user.locationId);
      const cameraIds = cameras.map((c) => c.id);
      const filteredReviews = cameraReviews.filter((r) =>
        cameraIds.includes(r.cameraId!),
      );
      return res.json(filteredReviews);
    }

    // Owners can filter by location or see all camera reviews
    if (requestedLocationId) {
      const cameras = await storage.getCamerasByLocation(requestedLocationId);
      const cameraIds = cameras.map((c) => c.id);
      const filteredReviews = cameraReviews.filter((r) =>
        cameraIds.includes(r.cameraId!),
      );
      return res.json(filteredReviews);
    }

    res.json(cameraReviews);
  });

  app.post("/api/camera-reviews", requireAuth, async (req, res) => {
    try {
      const reviewData = insertReviewSchema.parse(req.body);
      const review = await storage.createReview(reviewData);

      // Create notification for confirmed theft from camera
      if (reviewData.decision === "confirmed_theft" && reviewData.cameraId) {
        const camera = await storage.getCameraById(reviewData.cameraId);
        await storage.createNotification({
          type: "theft_confirmed",
          title: "Theft Confirmed",
          message: `Theft confirmed from camera "${camera?.name || "unknown"}" by ${reviewData.reviewerUsername}`,
          relatedId: review.id,
          isRead: false,
        });
      }

      res.json(review);
    } catch (error) {
      res
        .status(400)
        .json({
          message: error instanceof Error ? error.message : "Camera review failed",
        });
    }
  });

  // ===== Customer Routes =====
  app.get("/api/customers", requireAuth, async (req, res) => {
    const userRole = req.user!.role;
    const username = req.user!.username;
    const requestedLocationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;

    // For non-owners, enforce location-based access control
    if (userRole !== "owner" && userRole !== "reviewer") {
      const user = await storage.getUser(username);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (user.role === "manager" && !user.locationId) {
        return res
          .status(403)
          .json({ message: "User has no assigned location" });
      }

      // Non-owners can ONLY access their assigned location
      const customers = await storage.getAllCustomers(user.locationId!);
      return res.json(customers);
    }

    // Owners can filter by location or see all customers
    const customers = await storage.getAllCustomers(requestedLocationId);
    res.json(customers);
  });

  app.post("/api/customers", requireAuth, async (req, res) => {
    try {
      const userRole = req.user!.role;
      const username = req.user!.username;

      // Only owners and managers can create customers
      if (userRole !== "owner" && userRole !== "manager") {
        return res
          .status(403)
          .json({ message: "Access denied. Only owners and managers can create customers." });
      }

      const customerData = insertCustomerSchema.parse(req.body);

      // For managers, enforce location-based access control
      if (userRole === "manager") {
        const user = await storage.getUser(username);
        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }

        if (!user.locationId) {
          return res
            .status(403)
            .json({ message: "Manager has no assigned location" });
        }

        // Managers can ONLY create customers for their assigned location
        // Override the locationId from request with user's assigned location
        customerData.locationId = user.locationId;
      }

      const customer = await storage.createCustomer(customerData);
      res.json(customer);
    } catch (error) {
      res
        .status(400)
        .json({
          message: error instanceof Error ? error.message : "Customer creation failed",
        });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid customer ID" });
    }
    const customer = await storage.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    res.json(customer);
  });

  // Update customer name
  app.patch("/api/customers/:id/name", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name } = req.body;

      if (typeof name !== "string") {
        return res.status(400).json({ message: "Name must be a string" });
      }

      const customer = await storage.updateCustomerName(id, name.trim() || null);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      res.json(customer);
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Update failed",
      });
    }
  });

  app.patch("/api/customers/:id/flag", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { flag } = req.body;

      // Validate flag value
      if (
        flag !== null &&
        flag !== "red" &&
        flag !== "yellow" &&
        flag !== "green"
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid flag value. Must be 'red', 'yellow', 'green', or null",
          });
      }

      const customer = await storage.updateCustomerFlag(id, flag);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Create notification when customer is flagged (not when cleared)
      if (flag !== null) {
        const flagColors = { red: "Red", yellow: "Yellow", green: "Green" };
        await storage.createNotification({
          type: "customer_flagged",
          title: "Customer Flagged",
          message: `Customer "${customer.name || customer.faceId}" has been flagged as ${flagColors[flag as keyof typeof flagColors]}`,
          relatedId: customer.id,
          isRead: false,
        });
      }

      res.json(customer);
    } catch (error) {
      res
        .status(400)
        .json({
          message: error instanceof Error ? error.message : "Update failed",
        });
    }
  });

  app.delete("/api/customers/:id", requireAuth, async (req, res) => {
    try {
      const userRole = req.user!.role;
      const username = req.user!.username;
      const id = parseInt(req.params.id);

      // Only owners and managers can delete customers
      if (userRole !== "owner" && userRole !== "manager") {
        return res
          .status(403)
          .json({ message: "Access denied. Only owners and managers can delete customers." });
      }

      // Get the customer to verify it exists and check location
      const customer = await storage.getCustomerById(id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // For managers, enforce location-based access control
      if (userRole === "manager") {
        const user = await storage.getUser(username);
        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }

        if (!user.locationId) {
          return res
            .status(403)
            .json({ message: "Manager has no assigned location" });
        }

        // Managers can ONLY delete customers from their assigned location
        if (customer.locationId !== user.locationId) {
          return res
            .status(403)
            .json({ message: "Access denied. Cannot delete customers from other locations." });
        }
      }

      const deleted = await storage.deleteCustomer(id);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete customer" });
      }

      res.json({ success: true, message: "Customer deleted successfully" });
    } catch (error) {
      res
        .status(400)
        .json({
          message: error instanceof Error ? error.message : "Delete failed",
        });
    }
  });

  // ===== Inventory Routes =====
  app.get("/api/inventory", requireAuth, async (req, res) => {
    const userRole = req.user!.role;
    const username = req.user!.username;
    const requestedLocationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;

    // For non-owners, enforce location-based access control
    if (userRole !== "owner" && userRole !== "reviewer") {
      const user = await storage.getUser(username);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!user.locationId) {
        return res
          .status(403)
          .json({ message: "User has no assigned location" });
      }

      // Non-owners can ONLY access their assigned location
      const items = await storage.getAllInventoryItems(user.locationId);
      return res.json(items);
    }

    // Owners can filter by location or see all items
    const items = await storage.getAllInventoryItems(requestedLocationId);
    res.json(items);
  });

  app.get("/api/inventory/:id", async (req, res) => {
    const item = await storage.getInventoryItemById(parseInt(req.params.id));
    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }
    res.json(item);
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const itemData = insertInventoryItemSchema.parse(req.body);
      const item = await storage.createInventoryItem(itemData);
      res.json(item);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to create inventory item",
        });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Validate and coerce updates
      const updates: Partial<{
        itemName: string;
        batchNumber: string;
        quantity: number;
        expirationDate: Date;
        category: string | null;
      }> = {};

      if (req.body.itemName !== undefined) updates.itemName = req.body.itemName;
      if (req.body.batchNumber !== undefined)
        updates.batchNumber = req.body.batchNumber;
      if (req.body.category !== undefined) updates.category = req.body.category;
      if (req.body.quantity !== undefined) {
        const qty = parseInt(req.body.quantity);
        if (isNaN(qty) || qty < 0) {
          return res
            .status(400)
            .json({ message: "Quantity must be a non-negative number" });
        }
        updates.quantity = qty;
      }
      if (req.body.expirationDate !== undefined) {
        const date = new Date(req.body.expirationDate);
        if (isNaN(date.getTime())) {
          return res
            .status(400)
            .json({ message: "Invalid expiration date format" });
        }
        updates.expirationDate = date;
      }

      const item = await storage.updateInventoryItem(id, updates);
      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }
      res.json(item);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update inventory item",
        });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const success = await storage.deleteInventoryItem(id);
    if (!success) {
      return res.status(404).json({ message: "Inventory item not found" });
    }
    res.json({ success: true });
  });

  // Notifications routes
  app.get("/api/notifications", async (_req, res) => {
    const notifications = await storage.getAllNotifications();
    res.json(notifications);
  });

  app.get("/api/notifications/unread", async (_req, res) => {
    const notifications = await storage.getUnreadNotifications();
    res.json(notifications);
  });

  app.patch("/api/notifications/:id/read", async (req, res) => {
    const id = parseInt(req.params.id);
    const notification = await storage.markNotificationAsRead(id);
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.json(notification);
  });

  app.patch("/api/notifications/read-all", async (_req, res) => {
    await storage.markAllNotificationsAsRead();
    res.json({ success: true });
  });

  // ===== ADMIN ROUTES (Owner Only) =====

  // Location routes
  app.get("/api/admin/locations", ownerAndReviewerOnly, async (_req, res) => {
    const locations = await storage.getAllLocations();
    res.json(locations);
  });

  app.post("/api/admin/locations", ownerOnly, async (req, res) => {
    try {
      const locationData = insertLocationSchema.parse(req.body);
      const location = await storage.createLocation(locationData);
      res.json(location);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to create location",
        });
    }
  });

  app.patch("/api/admin/locations/:id", ownerOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = insertLocationSchema.partial().parse(req.body);
      const location = await storage.updateLocation(id, updates);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error
              ? error.message
              : "Failed to update location",
        });
    }
  });

  app.delete("/api/admin/locations/:id", ownerOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if location exists
      const location = await storage.getLocationById(id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Check for associated data that would prevent deletion
      const associations = [];

      // Check for users assigned to this location
      const allUsers = await storage.getAllUsers();
      const assignedUsers = allUsers.filter(u => u.locationId === id);
      if (assignedUsers.length > 0) {
        associations.push(`${assignedUsers.length} user(s)`);
      }

      // Check for cameras at this location
      const cameras = await storage.getCamerasByLocation(id);
      if (cameras.length > 0) {
        associations.push(`${cameras.length} camera(s)`);
      }

      // Check for customers at this location
      const customers = await storage.getAllCustomers(id);
      if (customers.length > 0) {
        associations.push(`${customers.length} customer(s)`);
      }

      // Check for video clips at this location
      const clips = await storage.getAllClips(id);
      if (clips.length > 0) {
        associations.push(`${clips.length} video clip(s)`);
      }

      // Check for inventory items at this location
      const inventory = await storage.getAllInventoryItems(id);
      if (inventory.length > 0) {
        associations.push(`${inventory.length} inventory item(s)`);
      }

      // If there are any associations, prevent deletion
      if (associations.length > 0) {
        return res.status(400).json({
          message: `Cannot delete location "${location.name}". Please remove the following first: ${associations.join(", ")}.`,
          associations: associations,
        });
      }

      // No associations found, safe to delete
      const success = await storage.deleteLocation(id);
      if (!success) {
        return res.status(500).json({ message: "Failed to delete location" });
      }

      res.json({ success: true, message: `Location "${location.name}" deleted successfully` });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Internal server error while deleting location",
      });
    }
  });

  // Camera routes - Public endpoint for viewing cameras (all authenticated users)
  app.get("/api/cameras", requireAuth, async (req, res) => {
    const userRole = req.user!.role;
    const username = req.user!.username;
    const requestedLocationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;

    // For non-owners, enforce location-based access control
    if (userRole !== "owner" && userRole !== "reviewer") {
      // Look up user's assigned location
      const user = await storage.getUser(username);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!user.locationId) {
        return res
          .status(403)
          .json({ message: "User has no assigned location" });
      }

      // Non-owners can ONLY access their assigned location
      // SECURITY: Ignore requestedLocationId completely and use their assigned location
      const cameras = await storage.getCamerasByLocation(user.locationId);
      return res.json(cameras);
    }

    // Owners can filter by location or see all cameras
    if (requestedLocationId) {
      const cameras = await storage.getCamerasByLocation(requestedLocationId);
      return res.json(cameras);
    }

    const allCameras = await storage.getAllCameras();
    res.json(allCameras);
  });

  // Update camera status - Authenticated users can update status
  app.patch("/api/cameras/:id/status", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const username = req.user!.username;
      
      // Validate status
      const validStatuses = ["pending", "suspect", "confirmed_theft", "clear"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      const camera = await storage.updateCamera(id, { status });
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      // Create notification for confirmed theft
      if (status === "confirmed_theft") {
        await storage.createNotification({
          type: "theft_confirmed",
          title: "Theft Confirmed",
          message: `Theft confirmed from camera "${camera.name}" by ${username}`,
          relatedId: camera.id,
          isRead: false,
        });
      }

      res.json(camera);
    } catch (error) {
      console.error("Error updating camera status:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  // Admin camera routes - Owner only
  app.get("/api/admin/cameras", ownerOnly, async (req, res) => {
    const locationId = req.query.locationId
      ? parseInt(req.query.locationId as string)
      : undefined;
    if (locationId) {
      const cameras = await storage.getCamerasByLocation(locationId);
      return res.json(cameras);
    }
    // Get all cameras if no locationId specified
    const allCameras = await storage.getAllCameras();
    res.json(allCameras);
  });

  app.post("/api/admin/cameras", ownerOnly, async (req, res) => {
    try {
      const cameraData = insertCameraSchema.parse(req.body);
      const camera = await storage.createCamera(cameraData);
      res.json(camera);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error ? error.message : "Failed to create camera",
        });
    }
  });

  app.patch("/api/admin/cameras/:id", ownerOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = insertCameraSchema.partial().parse(req.body);
      const camera = await storage.updateCamera(id, updates);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json(camera);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error ? error.message : "Failed to update camera",
        });
    }
  });

  app.delete("/api/admin/cameras/:id", ownerOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // Check if camera exists
      const camera = await storage.getCameraById(id);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      // Delete all associated video clips
      const allClips = await storage.getAllClips(camera.locationId);
      const cameraClips = allClips.filter(clip => clip.cameraId === id);
      for (const clip of cameraClips) {
        await storage.deleteClip(clip.id);
      }

      // Delete all associated reviews
      const allReviews = await storage.getAllReviews();
      const cameraReviews = allReviews.filter(review => review.cameraId === id);
      for (const review of cameraReviews) {
        await storage.deleteReview(review.id);
      }

      // Now delete the camera
      const success = await storage.deleteCamera(id);
      if (!success) {
        return res.status(500).json({ message: "Failed to delete camera" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to delete camera",
      });
    }
  });

  // User admin routes
  app.get("/api/admin/users", ownerOnly, async (_req, res) => {
    const users = await storage.getAllUsers();
    // Remove password from response for security
    const usersWithoutPasswords = users.map(({ password, ...user }) => user);
    res.json(usersWithoutPasswords);
  });

  app.post("/api/admin/users", ownerOnly, async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      const existingUser = await storage.getUser(userData.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const user = await storage.createUser(userData);
      // Remove password from response for security
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error ? error.message : "Failed to create user",
        });
    }
  });

  app.patch("/api/admin/users/:username", ownerOnly, async (req, res) => {
    try {
      const username = req.params.username;
      const updates = insertUserSchema.partial().parse(req.body);
      // Don't allow password updates through this endpoint for security
      if ("password" in updates) {
        delete updates.password;
      }
      const user = await storage.updateUser(username, updates);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove password from response for security
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res
        .status(400)
        .json({
          message:
            error instanceof Error ? error.message : "Failed to update user",
        });
    }
  });

  app.delete("/api/admin/users/:username", ownerOnly, async (req, res) => {
    const username = req.params.username;
    const success = await storage.deleteUser(username);
    if (!success) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ success: true });
  });
}
