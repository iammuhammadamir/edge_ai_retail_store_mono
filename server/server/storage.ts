import { eq } from 'drizzle-orm';
import { db } from './db';
import { 
  users, videoClips, customers, reviews, inventoryItems, notifications 
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

export interface IStorage {
  // Users
  getUser(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(username: string, updates: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(username: string): Promise<boolean>;
  
  // Locations
  getAllLocations(): Promise<Location[]>;
  getLocationById(id: number): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: number, updates: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: number): Promise<boolean>;
  
  // Cameras
  getAllCameras(): Promise<Camera[]>;
  getCamerasByLocation(locationId: number): Promise<Camera[]>;
  getCameraById(id: number): Promise<Camera | undefined>;
  createCamera(camera: InsertCamera): Promise<Camera>;
  updateCamera(id: number, updates: Partial<InsertCamera>): Promise<Camera | undefined>;
  deleteCamera(id: number): Promise<boolean>;
  
  // Video Clips
  getAllClips(locationId?: number): Promise<VideoClip[]>;
  getClipById(id: number): Promise<VideoClip | undefined>;
  createClip(clip: InsertVideoClip): Promise<VideoClip>;
  updateClipStatus(id: number, status: string, faceDetections?: string): Promise<VideoClip | undefined>;
  deleteClip(id: number): Promise<boolean>;
  
  // Customers
  getAllCustomers(locationId?: number): Promise<Customer[]>;
  getCustomerById(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  incrementCustomerPoints(id: number): Promise<Customer | undefined>;
  updateCustomerName(id: number, name: string | null): Promise<Customer | undefined>;
  updateCustomerFlag(id: number, flag: string | null): Promise<Customer | undefined>;
  deleteCustomer(id: number): Promise<boolean>;
  
  // Reviews
  getAllReviews(): Promise<Review[]>;
  getReviewsByClipId(clipId: number): Promise<Review[]>;
  createReview(review: InsertReview): Promise<Review>;
  deleteReview(id: number): Promise<boolean>;
  
  // Inventory
  getAllInventoryItems(locationId?: number): Promise<InventoryItem[]>;
  getInventoryItemById(id: number): Promise<InventoryItem | undefined>;
  createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem>;
  updateInventoryItem(id: number, updates: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined>;
  deleteInventoryItem(id: number): Promise<boolean>;
  
  // Notifications
  getAllNotifications(): Promise<Notification[]>;
  getUnreadNotifications(): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: number): Promise<Notification | undefined>;
  markAllNotificationsAsRead(): Promise<void>;
}

// In-memory storage for development
export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private clips: Map<number, VideoClip> = new Map();
  private customers: Map<string, Customer> = new Map();
  private reviews: Map<number, Review> = new Map();
  private inventoryItems: Map<number, InventoryItem> = new Map();
  private notifications: Map<number, Notification> = new Map();
  private userIdCounter = 1;
  private clipIdCounter = 1;
  private customerIdCounter = 1;
  private reviewIdCounter = 1;
  private inventoryIdCounter = 1;
  private notificationIdCounter = 1;

  constructor() {
    this.seedData();
  }

  private seedData() {
    // Seed sample video clips using user-uploaded videos
    const now = new Date();
    const sampleClips = [
      {
        filename: "camera-1-2024-11-17-08-15.mp4",
        url: "/videos/camera-1-2024-11-17-08-15.mp4",
        status: "pending",
        uploadedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
      },
      {
        filename: "camera-2-2024-11-17-09-30.mp4",
        url: "/videos/camera-2-2024-11-17-09-30.mp4",
        status: "pending",
        uploadedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
      },
      {
        filename: "camera-3-2024-11-17-10-45.mp4",
        url: "/videos/camera-3-2024-11-17-10-45.mp4",
        status: "suspect",
        uploadedAt: new Date(now.getTime() - 45 * 60 * 1000), // 45 mins ago
      },
      {
        filename: "camera-1-2024-11-17-11-20.mp4",
        url: "/videos/camera-1-2024-11-17-11-20.mp4",
        status: "clear",
        uploadedAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 mins ago
      },
    ];

    sampleClips.forEach((clip) => {
      const newClip: VideoClip = {
        id: this.clipIdCounter++,
        ...clip,
        faceDetections: null,
      };
      this.clips.set(newClip.id, newClip);
    });

    // Seed sample customers for facial recognition
    const sampleCustomers = [
      {
        faceId: "face_001",
        name: "John Smith",
        photoUrl: "/customers/customer3.png",
        points: 12,
        isRegular: true,
        firstSeen: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        lastSeen: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
      },
      {
        faceId: "face_002",
        name: null,
        photoUrl: "/customers/customer2.png",
        points: 2,
        isRegular: false,
        firstSeen: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        lastSeen: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3 hours ago
      },
      {
        faceId: "face_003",
        name: "Sarah Johnson",
        photoUrl: "/customers/customer1.png",
        points: 8,
        isRegular: true,
        firstSeen: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        lastSeen: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
      },
    ];

    sampleCustomers.forEach((customer) => {
      const newCustomer: Customer = {
        id: this.customerIdCounter++,
        faceId: customer.faceId,
        name: customer.name,
        photoUrl: customer.photoUrl || null,
        points: customer.points,
        firstSeen: customer.firstSeen,
        lastSeen: customer.lastSeen,
        isRegular: customer.isRegular,
        flag: null, // No flag by default
      };
      this.customers.set(customer.faceId, newCustomer);
    });

    // Seed sample reviews with timestamps relative to clip upload times
    const sampleReviews = [
      {
        clipId: 3,
        reviewerRole: "manager",
        reviewerUsername: "manager",
        decision: "suspect",
        notes: "Suspicious behavior near register at 10:47 AM",
        reviewedAt: new Date(now.getTime() - 40 * 60 * 1000), // 5 mins after clip 3 upload
      },
      {
        clipId: 5,
        reviewerRole: "manager",
        reviewerUsername: "manager",
        decision: "clear",
        notes: "Regular customer, normal transaction",
        reviewedAt: new Date(now.getTime() - 10 * 60 * 1000), // 5 mins after clip 5 upload
      },
      {
        clipId: 6,
        reviewerRole: "manager",
        reviewerUsername: "manager",
        decision: "confirmed_theft",
        notes: "Clear footage of theft incident, police notified",
        reviewedAt: new Date(now.getTime() - 2 * 60 * 1000), // 3 mins after clip 6 upload
      },
    ];

    sampleReviews.forEach((review) => {
      const newReview: Review = {
        id: this.reviewIdCounter++,
        clipId: review.clipId,
        reviewerRole: review.reviewerRole,
        reviewerUsername: review.reviewerUsername,
        decision: review.decision,
        notes: review.notes,
        reviewedAt: review.reviewedAt,
      };
      this.reviews.set(newReview.id, newReview);
    });

    // Seed sample inventory items
    const sampleInventoryItems = [
      {
        itemName: "Milk (1 Gallon)",
        batchNumber: "BATCH-2024-001",
        quantity: 24,
        expirationDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        category: "Dairy",
      },
      {
        itemName: "Bread (White)",
        batchNumber: "BATCH-2024-002",
        quantity: 15,
        expirationDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        category: "Bakery",
      },
      {
        itemName: "Eggs (Dozen)",
        batchNumber: "BATCH-2024-003",
        quantity: 36,
        expirationDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        category: "Dairy",
      },
      {
        itemName: "Yogurt (Strawberry)",
        batchNumber: "BATCH-2024-004",
        quantity: 18,
        expirationDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
        category: "Dairy",
      },
      {
        itemName: "Soda (Cola 2L)",
        batchNumber: "BATCH-2024-005",
        quantity: 48,
        expirationDate: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
        category: "Beverages",
      },
      {
        itemName: "Chips (BBQ)",
        batchNumber: "BATCH-2024-006",
        quantity: 30,
        expirationDate: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000), // 45 days from now
        category: "Snacks",
      },
    ];

    sampleInventoryItems.forEach((item) => {
      const newItem: InventoryItem = {
        id: this.inventoryIdCounter++,
        itemName: item.itemName,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        expirationDate: item.expirationDate,
        category: item.category,
        createdAt: now,
        updatedAt: now,
      };
      this.inventoryItems.set(newItem.id, newItem);
    });
  }

  async getUser(username: string): Promise<User | undefined> {
    return this.users.get(username);
  }

  async createUser(user: InsertUser): Promise<User> {
    const newUser: User = {
      id: this.userIdCounter++,
      ...user,
      createdAt: new Date(),
    };
    this.users.set(user.username, newUser);
    return newUser;
  }

  async getAllClips(): Promise<VideoClip[]> {
    return Array.from(this.clips.values()).sort((a, b) => 
      b.uploadedAt.getTime() - a.uploadedAt.getTime()
    );
  }

  async getClipById(id: number): Promise<VideoClip | undefined> {
    return this.clips.get(id);
  }

  async createClip(clip: InsertVideoClip): Promise<VideoClip> {
    const newClip: VideoClip = {
      id: this.clipIdCounter++,
      filename: clip.filename,
      url: clip.url,
      status: clip.status ?? "pending",
      faceDetections: clip.faceDetections ?? null,
      uploadedAt: new Date(),
    };
    this.clips.set(newClip.id, newClip);
    return newClip;
  }

  async updateClipStatus(id: number, status: string, faceDetections?: string): Promise<VideoClip | undefined> {
    const clip = this.clips.get(id);
    if (!clip) return undefined;
    
    const updated: VideoClip = {
      ...clip,
      status,
      faceDetections: faceDetections || clip.faceDetections,
    };
    this.clips.set(id, updated);
    return updated;
  }

  async getAllCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values()).sort((a, b) => 
      b.lastSeen.getTime() - a.lastSeen.getTime()
    );
  }

  async getCustomerByFaceId(faceId: string): Promise<Customer | undefined> {
    return this.customers.get(faceId);
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const now = new Date();
    const newCustomer: Customer = {
      id: this.customerIdCounter++,
      faceId: customer.faceId,
      name: customer.name ?? null,
      photoUrl: customer.photoUrl ?? null,
      points: customer.points ?? 0,
      firstSeen: now,
      lastSeen: customer.lastSeen ?? now,
      isRegular: customer.isRegular ?? false,
      flag: customer.flag ?? null,
    };
    this.customers.set(customer.faceId, newCustomer);
    return newCustomer;
  }

  async incrementCustomerPoints(faceId: string): Promise<Customer | undefined> {
    const customer = this.customers.get(faceId);
    if (!customer) return undefined;
    
    const updated: Customer = {
      ...customer,
      points: customer.points + 1,
      lastSeen: new Date(),
      isRegular: customer.points + 1 >= 5,
    };
    this.customers.set(faceId, updated);
    return updated;
  }

  async updateCustomerFlag(id: number, flag: string | null): Promise<Customer | undefined> {
    // Find customer by ID
    const customer = Array.from(this.customers.values()).find(c => c.id === id);
    if (!customer) return undefined;
    
    const updated: Customer = {
      ...customer,
      flag: flag,
    };
    this.customers.set(customer.faceId, updated);
    return updated;
  }

  async deleteCustomer(id: number): Promise<boolean> {
    // Find customer by ID
    const customer = Array.from(this.customers.values()).find(c => c.id === id);
    if (!customer) return false;
    
    this.customers.delete(customer.faceId);
    return true;
  }

  async getCustomerById(id: number): Promise<Customer | undefined> {
    return Array.from(this.customers.values()).find(c => c.id === id);
  }

  async getAllReviews(): Promise<Review[]> {
    return Array.from(this.reviews.values()).sort((a, b) => 
      b.reviewedAt.getTime() - a.reviewedAt.getTime()
    );
  }

  async getReviewsByClipId(clipId: number): Promise<Review[]> {
    return Array.from(this.reviews.values()).filter(r => r.clipId === clipId);
  }

  async createReview(review: InsertReview): Promise<Review> {
    const newReview: Review = {
      id: this.reviewIdCounter++,
      clipId: review.clipId,
      reviewerRole: review.reviewerRole,
      reviewerUsername: review.reviewerUsername,
      decision: review.decision,
      notes: review.notes ?? null,
      reviewedAt: new Date(),
    };
    this.reviews.set(newReview.id, newReview);
    return newReview;
  }

  async getAllInventoryItems(): Promise<InventoryItem[]> {
    return Array.from(this.inventoryItems.values()).sort((a, b) => 
      a.expirationDate.getTime() - b.expirationDate.getTime()
    );
  }

  async getInventoryItemById(id: number): Promise<InventoryItem | undefined> {
    return this.inventoryItems.get(id);
  }

  async createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem> {
    const now = new Date();
    const newItem: InventoryItem = {
      id: this.inventoryIdCounter++,
      itemName: item.itemName,
      batchNumber: item.batchNumber,
      quantity: item.quantity,
      expirationDate: item.expirationDate,
      category: item.category ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.inventoryItems.set(newItem.id, newItem);
    return newItem;
  }

  async updateInventoryItem(id: number, updates: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined> {
    const item = this.inventoryItems.get(id);
    if (!item) return undefined;
    
    const updated: InventoryItem = {
      ...item,
      ...updates,
      // Ensure expirationDate is a Date object if provided
      expirationDate: updates.expirationDate 
        ? new Date(updates.expirationDate) 
        : item.expirationDate,
      updatedAt: new Date(),
    };
    this.inventoryItems.set(id, updated);
    return updated;
  }

  async deleteInventoryItem(id: number): Promise<boolean> {
    return this.inventoryItems.delete(id);
  }

  // Notification methods
  async getAllNotifications(): Promise<Notification[]> {
    return Array.from(this.notifications.values()).sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async getUnreadNotifications(): Promise<Notification[]> {
    return Array.from(this.notifications.values())
      .filter(n => !n.isRead)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const newNotification: Notification = {
      id: this.notificationIdCounter++,
      ...notification,
      createdAt: new Date(),
    };
    this.notifications.set(newNotification.id, newNotification);
    return newNotification;
  }

  async markNotificationAsRead(id: number): Promise<Notification | undefined> {
    const notification = this.notifications.get(id);
    if (!notification) return undefined;
    
    const updated: Notification = {
      ...notification,
      isRead: true,
    };
    this.notifications.set(id, updated);
    return updated;
  }

  async markAllNotificationsAsRead(): Promise<void> {
    for (const [id, notification] of this.notifications.entries()) {
      this.notifications.set(id, { ...notification, isRead: true });
    }
  }
}
