import type { VercelRequest, VercelResponse } from '@vercel/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

// Inline schema
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull(),
  locationId: integer('location_id'),
});

// Inline DB connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});
const db = drizzle(pool);

// Inline JWT
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
function signToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    // Find user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = signToken({
      username: user.username,
      role: user.role,
      locationId: user.locationId ?? null,
    });

    return res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        locationId: user.locationId,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
