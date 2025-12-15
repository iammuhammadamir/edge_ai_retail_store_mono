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

    // POST /api/inventory/analyze
    if (path === 'analyze' && req.method === 'POST') {
      const { images } = req.body;
      if (!images || !Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ message: 'images array required' });
      }

      // Inline OpenAI analysis to avoid Vercel bundling issues
      const OpenAI = (await import('openai')).default;

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: 'OPENAI_API_KEY is not configured' });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Prepare messages with images
      const content: any[] = [
        {
          type: "text",
          text: `Identify the commercial products in these images and count their quantities.
          Return a STRICT JSON array of objects. Do not include markdown formatting like \`\`\`json.
          
          Schema:
          [
            {
              "itemName": "Specific Product Name (e.g. 'Coca-Cola 2L', 'Lays Classic Chip 50g')",
              "quantity": 5,
              "category": "Suggested Category (e.g. 'Beverages', 'Snacks')",
              "confidence": 0.95,
              "warnings": ["Low visibility", "Partially occluded"]
            }
          ]

          Rules:
          1. Be precise with names. Include brand and size/variant if visible.
          2. If an item appears in multiple images, try not to double count.
          3. Ignore non-product background elements.
          4. Group identical items into a single entry with summed quantity.
          `,
        },
      ];

      // Add images to content
      for (const base64 of images) {
        const dataUrl = base64.startsWith("data:image")
          ? base64
          : `data:image/jpeg;base64,${base64}`;
        content.push({
          type: "image_url",
          image_url: { url: dataUrl },
        });
      }

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: content }],
          max_tokens: 1000,
        });

        const rawContent = response.choices[0].message.content?.trim() || "[]";
        const jsonString = rawContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        const items = JSON.parse(jsonString);
        return res.json({ items });
      } catch (aiError) {
        console.error("OpenAI Analysis Error:", aiError);
        return res.status(500).json({ message: 'Failed to analyze images with AI' });
      }
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
