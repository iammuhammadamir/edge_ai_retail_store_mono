import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { 
  users, videoClips, customers, reviews, inventoryItems, notifications,
  locations, cameras
} from '../shared/schema';
import type {
  User, InsertUser,
  VideoClip, InsertVideoClip,
  Customer, InsertCustomer,
  Review, InsertReview,
  InventoryItem, InsertInventoryItem,
  Notification, InsertNotification,
  Location, InsertLocation,
  Camera, InsertCamera
} from "../shared/schema";
import type { IStorage } from './storage';

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.username);
  }

  async updateUser(username: string, updates: Partial<InsertUser>): Promise<User | undefined> {
    const result = await db.update(users)
      .set(updates)
      .where(eq(users.username, username))
      .returning();
    return result[0];
  }

  async deleteUser(username: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.username, username)).returning();
    return result.length > 0;
  }

  // Location methods
  async getAllLocations(): Promise<Location[]> {
    return db.select().from(locations).orderBy(locations.name);
  }

  async getLocationById(id: number): Promise<Location | undefined> {
    const result = await db.select().from(locations).where(eq(locations.id, id));
    return result[0];
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const result = await db.insert(locations).values(location).returning();
    return result[0];
  }

  async updateLocation(id: number, updates: Partial<InsertLocation>): Promise<Location | undefined> {
    const result = await db.update(locations)
      .set(updates)
      .where(eq(locations.id, id))
      .returning();
    return result[0];
  }

  async deleteLocation(id: number): Promise<boolean> {
    const result = await db.delete(locations).where(eq(locations.id, id)).returning();
    return result.length > 0;
  }

  // Camera methods
  async getAllCameras(): Promise<Camera[]> {
    return db.select().from(cameras).orderBy(cameras.name);
  }

  async getCamerasByLocation(locationId: number): Promise<Camera[]> {
    return db.select().from(cameras).where(eq(cameras.locationId, locationId));
  }

  async getCameraById(id: number): Promise<Camera | undefined> {
    const result = await db.select().from(cameras).where(eq(cameras.id, id));
    return result[0];
  }

  async createCamera(camera: InsertCamera): Promise<Camera> {
    const result = await db.insert(cameras).values(camera).returning();
    return result[0];
  }

  async updateCamera(id: number, updates: Partial<InsertCamera>): Promise<Camera | undefined> {
    const result = await db.update(cameras)
      .set(updates)
      .where(eq(cameras.id, id))
      .returning();
    return result[0];
  }

  async deleteCamera(id: number): Promise<boolean> {
    const result = await db.delete(cameras).where(eq(cameras.id, id)).returning();
    return result.length > 0;
  }

  // Video Clip methods
  async getAllClips(locationId?: number): Promise<VideoClip[]> {
    if (locationId) {
      return db.select().from(videoClips)
        .where(eq(videoClips.locationId, locationId))
        .orderBy(desc(videoClips.uploadedAt));
    }
    return db.select().from(videoClips).orderBy(desc(videoClips.uploadedAt));
  }

  async getClipById(id: number): Promise<VideoClip | undefined> {
    const result = await db.select().from(videoClips).where(eq(videoClips.id, id));
    return result[0];
  }

  async createClip(clip: InsertVideoClip): Promise<VideoClip> {
    const result = await db.insert(videoClips).values(clip).returning();
    return result[0];
  }

  async updateClipStatus(id: number, status: string, faceDetections?: string): Promise<VideoClip | undefined> {
    const result = await db.update(videoClips)
      .set({ status, faceDetections: faceDetections || null })
      .where(eq(videoClips.id, id))
      .returning();
    return result[0];
  }

  async deleteClip(id: number): Promise<boolean> {
    const result = await db.delete(videoClips).where(eq(videoClips.id, id)).returning();
    return result.length > 0;
  }

  // Customer methods
  async getAllCustomers(locationId?: number): Promise<Customer[]> {
    if (locationId) {
      return db.select().from(customers)
        .where(eq(customers.locationId, locationId))
        .orderBy(desc(customers.points));
    }
    return db.select().from(customers).orderBy(desc(customers.points));
  }

  async getCustomerById(id: number): Promise<Customer | undefined> {
    const result = await db.select().from(customers).where(eq(customers.id, id));
    return result[0];
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const result = await db.insert(customers).values(customer).returning();
    return result[0];
  }

  async incrementCustomerPoints(id: number): Promise<Customer | undefined> {
    const customer = await this.getCustomerById(id);
    if (!customer) return undefined;
    
    const newPoints = customer.points + 1;
    
    const result = await db.update(customers)
      .set({ points: newPoints, lastSeen: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return result[0];
  }

  async updateCustomerName(id: number, name: string | null): Promise<Customer | undefined> {
    const result = await db.update(customers)
      .set({ name })
      .where(eq(customers.id, id))
      .returning();
    return result[0];
  }

  async updateCustomerFlag(id: number, flag: string | null): Promise<Customer | undefined> {
    const result = await db.update(customers)
      .set({ flag })
      .where(eq(customers.id, id))
      .returning();
    return result[0];
  }

  async deleteCustomer(id: number): Promise<boolean> {
    const result = await db.delete(customers).where(eq(customers.id, id)).returning();
    return result.length > 0;
  }

  // Review methods
  async getAllReviews(): Promise<Review[]> {
    return db.select().from(reviews).orderBy(desc(reviews.reviewedAt));
  }

  async getReviewsByClipId(clipId: number): Promise<Review[]> {
    return db.select().from(reviews).where(eq(reviews.clipId, clipId));
  }

  async createReview(review: InsertReview): Promise<Review> {
    const result = await db.insert(reviews).values(review).returning();
    return result[0];
  }

  async deleteReview(id: number): Promise<boolean> {
    const result = await db.delete(reviews).where(eq(reviews.id, id)).returning();
    return result.length > 0;
  }

  // Inventory methods
  async getAllInventoryItems(locationId?: number): Promise<InventoryItem[]> {
    if (locationId) {
      return db.select().from(inventoryItems)
        .where(eq(inventoryItems.locationId, locationId))
        .orderBy(inventoryItems.expirationDate);
    }
    return db.select().from(inventoryItems).orderBy(inventoryItems.expirationDate);
  }

  async getInventoryItemById(id: number): Promise<InventoryItem | undefined> {
    const result = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    return result[0];
  }

  async createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem> {
    const result = await db.insert(inventoryItems).values(item).returning();
    return result[0];
  }

  async updateInventoryItem(id: number, updates: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined> {
    const result = await db.update(inventoryItems)
      .set({ 
        ...updates, 
        updatedAt: new Date() 
      })
      .where(eq(inventoryItems.id, id))
      .returning();
    return result[0];
  }

  async deleteInventoryItem(id: number): Promise<boolean> {
    const result = await db.delete(inventoryItems).where(eq(inventoryItems.id, id)).returning();
    return result.length > 0;
  }

  // Notification methods
  async getAllNotifications(): Promise<Notification[]> {
    return db.select().from(notifications).orderBy(desc(notifications.createdAt));
  }

  async getUnreadNotifications(): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.isRead, false))
      .orderBy(desc(notifications.createdAt));
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const result = await db.insert(notifications).values(notification).returning();
    return result[0];
  }

  async markNotificationAsRead(id: number): Promise<Notification | undefined> {
    const result = await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning();
    return result[0];
  }

  async markAllNotificationsAsRead(): Promise<void> {
    await db.update(notifications).set({ isRead: true });
  }
}

// Seed data function for initial database setup
export async function seedDatabase(storage: DatabaseStorage) {
  // Check if data already exists by looking for cameras (created in this function)
  const existingCameras = await storage.getAllCameras();
  if (existingCameras.length > 0) {
    console.log("Database already seeded, skipping...");
    return;
  }

  console.log("Seeding database with initial data...");

  // Get the actual location IDs from the database
  const locations = await storage.getAllLocations();
  const mainSt = locations.find(l => l.name === "Main St");
  const pedroSt = locations.find(l => l.name === "Pedro St");
  
  if (!mainSt || !pedroSt) {
    throw new Error("Required locations not found");
  }
  
  const mainStId = mainSt.id;
  const pedroStId = pedroSt.id;
  console.log(`Using location IDs: Main St=${mainStId}, Pedro St=${pedroStId}`);

  // Seed cameras for each location (one per location)
  const mainCamera = await storage.createCamera({
    name: "Main St - Front Camera",
    streamUrl: "/videos/camera-1-2024-11-17-08-15.mp4",
    locationId: mainStId,
    isActive: true,
  });

  const pedroCamera = await storage.createCamera({
    name: "Pedro St - Front Camera",
    streamUrl: "/videos/camera-2-2024-11-17-09-30.mp4",
    locationId: pedroStId,
    isActive: true,
  });

  // Seed sample video clips using user-uploaded videos
  const now = new Date();
  const sampleClips = [
    {
      filename: "camera-1-2024-11-17-08-15.mp4",
      url: "/videos/camera-1-2024-11-17-08-15.mp4",
      status: "pending",
      uploadedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      locationId: mainStId,
      cameraId: mainCamera.id,
    },
    {
      filename: "camera-2-2024-11-17-09-30.mp4",
      url: "/videos/camera-2-2024-11-17-09-30.mp4",
      status: "pending",
      uploadedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      locationId: pedroStId,
      cameraId: pedroCamera.id,
    },
  ];

  for (const clip of sampleClips) {
    await storage.createClip(clip);
  }

  // Seed sample customers with facial recognition data
  const sampleCustomers = [
    {
      faceId: "face_main_001",
      name: "Main St - Sarah Johnson",
      points: 12,
      isRegular: true,
      photoUrl: "https://www.google.com/url?sa=i&url=https%3A%2F%2Fwww.istockphoto.com%2Fphotos%2Fwhite-house&psig=AOvVaw1GAMfAtzcrJCzsaCX-lbHZ&ust=1763797233909000&source=images&cd=vfe&opi=89978449&ved=0CBIQjRxqFwoTCLDU2e7egpEDFQAAAAAdAAAAABAE",
      flag: null,
      locationId: mainStId,
      lastSeen: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    },
    {
      faceId: "face_main_002",
      name: "Main St - Michael Chen",
      points: 8,
      isRegular: true,
      photoUrl: "https://cdn.web.imagine.art/imagine-frontend/assets/images/ai-image-generator-hero-image.png",
      flag: null,
      locationId: mainStId,
      lastSeen: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    },
    {
      faceId: "face_main_003",
      name: "Main St - Emily Rodriguez",
      points: 3,
      isRegular: false,
      photoUrl: "https://www.google.com/url?sa=i&url=https%3A%2F%2Fwww.istockphoto.com%2Fphotos%2Fwhite-house&psig=AOvVaw1GAMfAtzcrJCzsaCX-lbHZ&ust=1763797233909000&source=images&cd=vfe&opi=89978449&ved=0CBIQjRxqFwoTCLDU2e7egpEDFQAAAAAdAAAAABAE",
      flag: null,
      locationId: mainStId,
      lastSeen: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    },
    {
      faceId: "face_pedro_001",
      name: "Pedro St - David Kim",
      points: 15,
      isRegular: true,
      photoUrl: "https://cdn.web.imagine.art/imagine-frontend/assets/images/ai-image-generator-hero-image.png",
      flag: null,
      locationId: pedroStId,
      lastSeen: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    },
    {
      faceId: "face_pedro_002",
      name: "Pedro St - Lisa Anderson",
      points: 2,
      isRegular: false,
      photoUrl: "https://www.google.com/url?sa=i&url=https%3A%2F%2Fwww.istockphoto.com%2Fphotos%2Fwhite-house&psig=AOvVaw1GAMfAtzcrJCzsaCX-lbHZ&ust=1763797233909000&source=images&cd=vfe&opi=89978449&ved=0CBIQjRxqFwoTCLDU2e7egpEDFQAAAAAdAAAAABAE",
      flag: null,
      locationId: pedroStId,
      lastSeen: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    },
    {
      faceId: "face_pedro_003",
      name: "Pedro St - James Martinez",
      points: 7,
      isRegular: true,
      photoUrl: "https://cdn.web.imagine.art/imagine-frontend/assets/images/ai-image-generator-hero-image.png",
      flag: null,
      locationId: pedroStId,
      lastSeen: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    },
  ];

  for (const customer of sampleCustomers) {
    await storage.createCustomer(customer);
  }

  // Seed sample inventory items
  const sampleInventory = [
    {
      itemName: "Main St - Milk (1 Gallon)",
      batchNumber: "BATCH-2024-001",
      quantity: 24,
      expirationDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
      category: "Dairy",
      locationId: mainStId,
    },
    {
      itemName: "Main St - Bread (White)",
      batchNumber: "BATCH-2024-002",
      quantity: 15,
      expirationDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      category: "Bakery",
      locationId: mainStId,
    },
    {
      itemName: "Main St - Soda (Cola 2L)",
      batchNumber: "BATCH-2024-005",
      quantity: 48,
      expirationDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      category: "Beverages",
      locationId: mainStId,
    },
    {
      itemName: "Pedro St - Eggs (Dozen)",
      batchNumber: "BATCH-2024-003",
      quantity: 36,
      expirationDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
      category: "Dairy",
      locationId: pedroStId,
    },
    {
      itemName: "Pedro St - Yogurt (Strawberry)",
      batchNumber: "BATCH-2024-004",
      quantity: 18,
      expirationDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago (expired)
      category: "Dairy",
      locationId: pedroStId,
    },
    {
      itemName: "Pedro St - Chips (BBQ)",
      batchNumber: "BATCH-2024-006",
      quantity: 30,
      expirationDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      category: "Snacks",
      locationId: pedroStId,
    },
  ];

  for (const item of sampleInventory) {
    await storage.createInventoryItem(item);
  }

  console.log("Database seeding complete!");
}
