import type { VercelRequest, VercelResponse } from '@vercel/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';
import jwt from 'jsonwebtoken';

const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

const cameras = pgTable('cameras', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  streamUrl: text('stream_url').notNull(),
  locationId: integer('location_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull(),
  locationId: integer('location_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

function requireOwner(req: VercelRequest, res: VercelResponse): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return false;
  }
  try {
    const user = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
    if (user.role !== 'owner') {
      res.status(403).json({ message: 'Owner access required' });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ message: 'Invalid token' });
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireOwner(req, res)) return;

  // Extract path after /api/admin/
  const url = req.url || '';
  const match = url.match(/\/api\/admin\/?(.*)$/);
  const path = match ? match[1].split('?')[0] : '';

  try {
    // /api/admin/locations
    if (path === 'locations') {
      if (req.method === 'GET') {
        const result = await db.select().from(locations);
        return res.json(result);
      }
      if (req.method === 'POST') {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'Name required' });
        const [created] = await db.insert(locations).values({ name }).returning();
        return res.json(created);
      }
    }

    // /api/admin/cameras
    if (path === 'cameras') {
      if (req.method === 'GET') {
        const result = await db.select().from(cameras);
        return res.json(result);
      }
      if (req.method === 'POST') {
        const { name, streamUrl, locationId, isActive } = req.body;
        if (!name || !streamUrl || !locationId) {
          return res.status(400).json({ message: 'Name, streamUrl, and locationId required' });
        }
        const [created] = await db.insert(cameras).values({ name, streamUrl, locationId, isActive: isActive ?? true }).returning();
        return res.json(created);
      }
    }

    // /api/admin/users
    if (path === 'users') {
      if (req.method === 'GET') {
        const result = await db.select({
          id: users.id, username: users.username, role: users.role,
          locationId: users.locationId, createdAt: users.createdAt,
        }).from(users);
        return res.json(result);
      }
      if (req.method === 'POST') {
        const { username, password, role, locationId } = req.body;
        if (!username || !password || !role) {
          return res.status(400).json({ message: 'Username, password, and role required' });
        }
        const [created] = await db.insert(users).values({ username, password, role, locationId }).returning({
          id: users.id, username: users.username, role: users.role, locationId: users.locationId, createdAt: users.createdAt,
        });
        return res.json(created);
      }
    }

    return res.status(404).json({ message: 'Not found' });
  } catch (error) {
    console.error('Admin error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Internal server error' });
  }
}
