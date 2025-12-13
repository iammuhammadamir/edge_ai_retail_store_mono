import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Locations table for multi-store support
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, createdAt: true });
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

// Cameras table for live camera feeds
export const cameras = pgTable("cameras", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  streamUrl: text("stream_url").notNull(), // RTSP/HLS/MP4 URL
  locationId: integer("location_id").notNull().references(() => locations.id),
  isActive: boolean("is_active").notNull().default(true),
  status: text("status").notNull().default("pending"), // 'pending', 'suspect', 'confirmed_theft', 'clear'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCameraSchema = createInsertSchema(cameras).omit({ id: true, createdAt: true });
export type InsertCamera = z.infer<typeof insertCameraSchema>;
export type Camera = typeof cameras.$inferSelect;

// Users table for authentication and role management
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(), // 'owner', 'manager', or 'reviewer'
  locationId: integer("location_id").references(() => locations.id), // null for owners (all access), specific for managers/reviewers
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Video clips from security cameras
export const videoClips = pgTable("video_clips", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'suspect', 'confirmed_theft', 'clear'
  faceDetections: text("face_detections"), // JSON string of detected face IDs
  locationId: integer("location_id").notNull().references(() => locations.id),
  cameraId: integer("camera_id")
    .references(() => cameras.id, { onDelete: "cascade" }),

});

export const insertVideoClipSchema = createInsertSchema(videoClips).omit({ id: true, uploadedAt: true });
export type InsertVideoClip = z.infer<typeof insertVideoClipSchema>;
export type VideoClip = typeof videoClips.$inferSelect;

// Customer tracking with facial recognition
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  faceId: text("face_id").notNull(), // Identifier from edge device (unique per location)
  name: text("name"), // Optional, can be assigned later
  photoUrl: text("photo_url"), // Face image path
  points: integer("points").notNull().default(0), // Visit count
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  flag: text("flag"), // Manager can flag as 'red', 'yellow', 'green' or null
  locationId: integer("location_id").notNull().references(() => locations.id),
  embedding: text("embedding"), // 512-dim face embedding as JSON string
  // Note: Unique constraint is (location_id, face_id) - same face_id can exist in different locations
});

export const insertCustomerSchema = createInsertSchema(customers)
  .omit({ id: true })
  .extend({
    photoUrl: z.string().optional().nullable(),
    lastSeen: z.coerce.date().optional(),
  });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// Review decisions made by managers/reviewers (for both cameras and clips)
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  clipId: integer("clip_id").references(() => videoClips.id), // nullable - for clip reviews
  cameraId: integer("camera_id").references(() => cameras.id), // nullable - for camera reviews
  reviewerRole: text("reviewer_role").notNull(), // 'manager' or 'reviewer'
  reviewerUsername: text("reviewer_username").notNull(),
  decision: text("decision").notNull(), // 'suspect', 'confirmed_theft', 'clear'
  notes: text("notes"),
  reviewedAt: timestamp("reviewed_at").defaultNow().notNull(),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, reviewedAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

// Inventory items for store management
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  itemName: text("item_name").notNull(),
  batchNumber: text("batch_number").notNull(),
  quantity: integer("quantity").notNull().default(0),
  expirationDate: timestamp("expiration_date").notNull(),
  category: text("category"), // Optional category for organization
  locationId: integer("location_id").notNull().references(() => locations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    quantity: z.number().int().min(0, "Quantity must be at least 0"),
    expirationDate: z.coerce.date(),
  });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;

// Notifications for important events
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'customer_flagged', 'theft_confirmed', 'inventory_expired'
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedId: integer("related_id"), // ID of the related entity (customer, review, or inventory item)
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;
