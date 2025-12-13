import type { VercelRequest, VercelResponse } from '@vercel/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

const cameras = pgTable('cameras', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  streamUrl: text('stream_url').notNull(),
  locationId: integer('location_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

  // Extract path after /api/cameras/
  const url = req.url || '';
  const match = url.match(/\/api\/cameras\/?(.*)$/);
  const path = match ? match[1].split('?')[0] : '';

  try {
    // GET /api/cameras or /api/cameras?locationId=X
    if (!path || path === '') {
      if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const result = locationId
        ? await db.select().from(cameras).where(eq(cameras.locationId, locationId))
        : await db.select().from(cameras);
      return res.json(result);
    }

    // PATCH /api/cameras/:id/status
    const statusMatch = path.match(/^(\d+)\/status$/);
    if (statusMatch) {
      if (req.method !== 'PATCH') return res.status(405).json({ message: 'Method not allowed' });
      const cameraId = parseInt(statusMatch[1]);
      const { status } = req.body;
      const [updated] = await db.update(cameras).set({ status }).where(eq(cameras.id, cameraId)).returning();
      if (!updated) return res.status(404).json({ message: 'Camera not found' });
      return res.json(updated);
    }

    return res.status(404).json({ message: 'Not found' });
  } catch (error) {
    console.error('Cameras error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Internal server error' });
  }
}
