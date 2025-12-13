import type { VercelRequest, VercelResponse } from '@vercel/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

const inventoryItems = pgTable('inventory_items', {
  id: serial('id').primaryKey(),
  itemName: text('item_name').notNull(),
  batchNumber: text('batch_number').notNull(),
  quantity: integer('quantity').notNull().default(0),
  expirationDate: timestamp('expiration_date').notNull(),
  category: text('category'),
  locationId: integer('location_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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

  // Extract path after /api/inventory/
  const url = req.url || '';
  const match = url.match(/\/api\/inventory\/?(.*)$/);
  const path = match ? match[1].split('?')[0] : '';

  try {
    // GET/POST /api/inventory
    if (!path || path === '') {
      if (req.method === 'GET') {
        const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
        const result = locationId
          ? await db.select().from(inventoryItems).where(eq(inventoryItems.locationId, locationId))
          : await db.select().from(inventoryItems);
        return res.json(result);
      }
      if (req.method === 'POST') {
        const { itemName, batchNumber, quantity, expirationDate, category, locationId } = req.body;
        if (!itemName || !batchNumber || !expirationDate || !locationId) {
          return res.status(400).json({ message: 'itemName, batchNumber, expirationDate, and locationId required' });
        }
        const [created] = await db.insert(inventoryItems).values({
          itemName, batchNumber, quantity: quantity || 0, expirationDate: new Date(expirationDate), category, locationId
        }).returning();
        return res.json(created);
      }
      return res.status(405).json({ message: 'Method not allowed' });
    }

    // GET/PATCH/DELETE /api/inventory/:id
    const idMatch = path.match(/^(\d+)$/);
    if (idMatch) {
      const itemId = parseInt(idMatch[1]);
      
      if (req.method === 'GET') {
        const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).limit(1);
        if (!item) return res.status(404).json({ message: 'Item not found' });
        return res.json(item);
      }
      if (req.method === 'PATCH') {
        const { itemName, batchNumber, quantity, expirationDate, category } = req.body;
        const updates: any = { updatedAt: new Date() };
        if (itemName !== undefined) updates.itemName = itemName;
        if (batchNumber !== undefined) updates.batchNumber = batchNumber;
        if (quantity !== undefined) updates.quantity = quantity;
        if (expirationDate !== undefined) updates.expirationDate = new Date(expirationDate);
        if (category !== undefined) updates.category = category;
        
        const [updated] = await db.update(inventoryItems).set(updates).where(eq(inventoryItems.id, itemId)).returning();
        if (!updated) return res.status(404).json({ message: 'Item not found' });
        return res.json(updated);
      }
      if (req.method === 'DELETE') {
        const [deleted] = await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId)).returning();
        if (!deleted) return res.status(404).json({ message: 'Item not found' });
        return res.json({ message: 'Item deleted', item: deleted });
      }
      return res.status(405).json({ message: 'Method not allowed' });
    }

    return res.status(404).json({ message: 'Not found' });
  } catch (error) {
    console.error('Inventory error:', error);
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Internal server error' });
  }
}
