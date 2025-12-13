import type { VercelRequest, VercelResponse } from '@vercel/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';

// Inline schema
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

// Inline DB connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});
const db = drizzle(pool);

// Inline matching
const SIMILARITY_THRESHOLD = 0.45;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

interface CustomerWithEmbedding {
  id: number;
  faceId: string;
  embedding: string | null;
  points: number | null;
}

function findBestMatch(
  embedding: number[],
  customerList: CustomerWithEmbedding[],
  threshold: number = 0.45
): { id: number; faceId: string; similarity: number } | null {
  let bestMatch = null;
  let bestSimilarity = threshold;
  
  for (const customer of customerList) {
    if (!customer.embedding) continue;
    try {
      const customerEmbedding: number[] = JSON.parse(customer.embedding);
      const similarity = cosineSimilarity(embedding, customerEmbedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { id: customer.id, faceId: customer.faceId, similarity };
      }
    } catch { /* skip invalid */ }
  }
  return bestMatch;
}

const EDGE_API_KEY = process.env.EDGE_API_KEY;

// Supabase client for file storage
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

async function uploadImage(base64Data: string, faceId: string): Promise<string | null> {
  if (!supabase) {
    console.log('[EDGE] Supabase not configured, skipping image upload');
    return null;
  }
  
  try {
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `customers/${faceId}.jpg`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('photos')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (error) {
      console.error('[EDGE] Upload error:', error.message);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('photos')
      .getPublicUrl(fileName);
    
    return urlData.publicUrl;
  } catch (err) {
    console.error('[EDGE] Upload failed:', err);
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Verify API key
  const apiKey = req.headers['x-api-key'];
  if (!EDGE_API_KEY || apiKey !== EDGE_API_KEY) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }

  try {
    const { embedding, imageBase64, locationId } = req.body;

    // Validate required fields
    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({
        success: false,
        message: 'embedding is required and must be an array'
      });
    }

    if (!locationId) {
      return res.status(400).json({
        success: false,
        message: 'locationId is required'
      });
    }

    const locId = parseInt(locationId);

    // Get all customers with embeddings for this location
    const allCustomers = await db
      .select({
        id: customers.id,
        faceId: customers.faceId,
        embedding: customers.embedding,
        points: customers.points,
        photoUrl: customers.photoUrl,
      })
      .from(customers)
      .where(eq(customers.locationId, locId));

    // Find best match using cosine similarity
    const match = findBestMatch(embedding, allCustomers, SIMILARITY_THRESHOLD);

    if (match) {
      // Returning customer - increment visit count
      const customer = allCustomers.find(c => c.id === match.id);
      const newPoints = (customer?.points || 0) + 1;

      await db
        .update(customers)
        .set({ 
          points: newPoints,
          lastSeen: new Date()
        })
        .where(eq(customers.id, match.id));

      console.log(`[EDGE] Returning customer #${match.id} (similarity: ${match.similarity.toFixed(3)}, visits: ${newPoints})`);

      return res.json({
        success: true,
        status: 'returning',
        customerId: match.id,
        visitCount: newPoints,
        similarity: match.similarity
      });
    } else {
      // New customer - create record with embedding
      const faceId = `visitor_${Date.now()}`;

      // Upload image to Supabase Storage
      const photoUrl = imageBase64 ? await uploadImage(imageBase64, faceId) : null;

      const [newCustomer] = await db
        .insert(customers)
        .values({
          faceId,
          name: null,
          photoUrl,
          points: 1,
          lastSeen: new Date(),
          locationId: locId,
          embedding: JSON.stringify(embedding),
        })
        .returning();

      console.log(`[EDGE] New customer enrolled: ${faceId} (ID: ${newCustomer.id})`);

      return res.json({
        success: true,
        status: 'new',
        customerId: newCustomer.id,
        visitCount: 1
      });
    }
  } catch (error) {
    console.error('[EDGE] Identify error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
