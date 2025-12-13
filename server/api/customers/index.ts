import type { VercelRequest, VercelResponse } from '@vercel/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  faceId: text('face_id').notNull(),
  name: text('name'),
  photoUrl: text('photo_url'),
  points: integer('points').default(0),
  lastSeen: timestamp('last_seen'),
  flag: text('flag'),
  locationId: integer('location_id'),
  embedding: text('embedding'),
});

const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull(),
  locationId: integer('location_id'),
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

function requireAuth(req: VercelRequest, res: VercelResponse): any {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return null;
  }
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    res.status(401).json({ message: 'Invalid token' });
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = requireAuth(req, res);
  if (!user) return;

  // Extract path after /api/customers/
  const url = req.url || '';
  const match = url.match(/\/api\/customers\/?(.*)$/);
  const path = match ? match[1].split('?')[0] : '';

  try {
    // GET /api/customers
    if (!path || path === '') {
      if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
      
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      
      // For non-owners, enforce location-based access
      if (user.role !== 'owner' && user.role !== 'reviewer') {
        const [dbUser] = await db.select().from(users).where(eq(users.username, user.username)).limit(1);
        if (!dbUser?.locationId) return res.status(403).json({ message: 'User has no assigned location' });
        const result = await db.select().from(customers).where(eq(customers.locationId, dbUser.locationId));
        return res.json(result);
      }
      
      // Owners/reviewers can filter or see all
      if (locationId) {
        const result = await db.select().from(customers).where(eq(customers.locationId, locationId));
        return res.json(result);
      }
      const result = await db.select().from(customers);
      return res.json(result);
    }

    // GET/DELETE /api/customers/:id
    const idMatch = path.match(/^(\d+)$/);
    if (idMatch) {
      const customerId = parseInt(idMatch[1]);
      
      if (req.method === 'GET') {
        const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
        if (!customer) return res.status(404).json({ message: 'Customer not found' });
        return res.json(customer);
      }
      if (req.method === 'DELETE') {
        const [deleted] = await db.delete(customers).where(eq(customers.id, customerId)).returning();
        if (!deleted) return res.status(404).json({ message: 'Customer not found' });
        return res.json({ message: 'Customer deleted successfully', customer: deleted });
      }
      return res.status(405).json({ message: 'Method not allowed' });
    }

    // PATCH /api/customers/:id/name
    const nameMatch = path.match(/^(\d+)\/name$/);
    if (nameMatch) {
      if (req.method !== 'PATCH') return res.status(405).json({ message: 'Method not allowed' });
      const customerId = parseInt(nameMatch[1]);
      const { name } = req.body;
      const [updated] = await db.update(customers).set({ name }).where(eq(customers.id, customerId)).returning();
      if (!updated) return res.status(404).json({ message: 'Customer not found' });
      return res.json(updated);
    }

    // PATCH /api/customers/:id/flag
    const flagMatch = path.match(/^(\d+)\/flag$/);
    if (flagMatch) {
      if (req.method !== 'PATCH') return res.status(405).json({ message: 'Method not allowed' });
      const customerId = parseInt(flagMatch[1]);
      const { flag } = req.body;
      const validFlags = ['red', 'yellow', 'green', null];
      if (!validFlags.includes(flag)) return res.status(400).json({ message: 'Invalid flag value' });
      const [updated] = await db.update(customers).set({ flag }).where(eq(customers.id, customerId)).returning();
      if (!updated) return res.status(404).json({ message: 'Customer not found' });
      return res.json(updated);
    }

    return res.status(404).json({ message: 'Not found' });
  } catch (error) {
    console.error('Customers error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Internal server error' });
  }
}
