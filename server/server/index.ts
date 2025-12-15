import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createProxyMiddleware } from "http-proxy-middleware";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "./routes";
import { registerEdgeRoutes } from "./edgeRoutes";
import { DatabaseStorage, seedDatabase } from "./dbStorage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PgSession = connectPgSimple(session);

const app = express();
const isDevelopment = false;

// Validate required environment variables
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: SESSION_SECRET environment variable is required in production");
    process.exit(1);
  }
  console.warn("WARNING: SESSION_SECRET not set. Using default (insecure for production)");
}
if (!process.env.RECAPTCHA_SECRET_KEY) {
  console.warn("WARNING: RECAPTCHA_SECRET_KEY not set. CAPTCHA verification will fail.");
}
if (!process.env.RECAPTCHA_SITE_KEY) {
  console.warn("WARNING: RECAPTCHA_SITE_KEY not set. CAPTCHA widget will not render.");
}

// =========================
// 1) HEALTH CHECK ENDPOINTS - MUST BE FIRST
// =========================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Lightweight root health check for platforms that ping "/"
app.get("/", (req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  if (ua.includes("GoogleHC") || req.headers["x-health-check"]) {
    return res.status(200).send("OK");
  }
  next();
});

// =========================
// 2) MIDDLEWARE
// =========================
// Trust proxy for secure cookies and proper IP detection
// Replit and most cloud platforms use reverse proxies
// Setting to 1 means we trust the first proxy in the chain
app.set("trust proxy", 1);

app.use(cors({
  origin: isDevelopment ? true : process.env.FRONTEND_URL || true,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Session middleware with PostgreSQL store
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Get session secret from environment or use default in development
const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change-in-production";

app.use(
  session({
    store: new PgSession({
      pool: pgPool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

// Static assets
app.use("/videos", express.static(path.join(__dirname, "../public/videos")));
app.use("/customers", express.static(path.join(__dirname, "../public/customers")));
app.use("/data/clips", express.static(path.join(__dirname, "../data/clips")));

if (!isDevelopment) {
  const distPath = path.resolve(__dirname, "../client/dist");
  app.use("/assets", express.static(path.join(distPath, "assets")));
  app.use("/vite.svg", express.static(path.join(distPath, "vite.svg")));
}

// =========================
// 3) INITIALIZE STORAGE & ROUTES (SYNCHRONOUS)
// =========================
// Initialize storage BEFORE app.listen so routes can be registered immediately
const storage = new DatabaseStorage();

// Register API routes immediately (health checks already registered above)
registerRoutes(app, storage);

// Register edge device API routes (for Jetson integration)
registerEdgeRoutes(app, storage);

// =========================
// 4) DATABASE INITIALIZATION (ASYNC, NON-BLOCKING)
// =========================
async function initializeDefaultLocations() {
  // Create locations first (needed for manager assignments)
  const locations = await storage.getAllLocations();

  if (locations.length === 0) {
    console.log("Creating default locations...");
    const mainSt = await storage.createLocation({
      name: "Main St",
    });
    console.log("Created Main St location with ID:", mainSt.id);

    const pedroSt = await storage.createLocation({
      name: "Pedro St",
    });
    console.log("Created Pedro St location with ID:", pedroSt.id);

    return { mainStId: mainSt.id, pedroStId: pedroSt.id };
  } else if (locations.length === 1) {
    const pedroSt = await storage.createLocation({
      name: "Pedro St",
    });
    return { mainStId: locations[0].id, pedroStId: pedroSt.id };
  }

  // Locations already exist
  return { mainStId: locations[0].id, pedroStId: locations[1].id };
}

async function initializeDefaultUsers(mainStId: number, pedroStId: number) {
  const manager1 = await storage.getUser("manager1");
  if (!manager1) {
    console.log("Creating manager1 for location", mainStId);
    await storage.createUser({
      username: "manager1",
      password: "manager1",
      role: "manager",
      locationId: mainStId,
    });
  }

  const manager2 = await storage.getUser("manager2");
  if (!manager2) {
    console.log("Creating manager2 for location", pedroStId);
    await storage.createUser({
      username: "manager2",
      password: "manager2",
      role: "manager",
      locationId: pedroStId,
    });
  }

  const reviewer = await storage.getUser("reviewer");
  if (!reviewer) {
    await storage.createUser({
      username: "reviewer",
      password: "reviewer123",
      role: "reviewer",
    });
  }

  const owner = await storage.getUser("owner");
  if (!owner) {
    await storage.createUser({
      username: "owner",
      password: "owner123",
      role: "owner",
    });
  }
}

async function initializeDatabase() {
  console.log("Initializing database...");
  try {
    const locationIds = await initializeDefaultLocations(); // Create locations first
    await initializeDefaultUsers(locationIds.mainStId, locationIds.pedroStId); // Then users (managers need locationId)
    // Skip seeding for Supabase - only face recognition tables exist
    // await seedDatabase(storage);        // Then seed data
    console.log("Database initialization complete");
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

// =========================
// 5) FRONTEND ROUTING
// =========================
if (isDevelopment) {
  app.use(
    createProxyMiddleware({
      target: "http://localhost:3001",
      changeOrigin: true,
      ws: true,
      pathFilter: (pathname: string) => {
        return (
          !pathname.startsWith("/api") &&
          !pathname.startsWith("/videos") &&
          !pathname.startsWith("/data/clips") &&
          !pathname.startsWith("/health")
        );
      },
    })
  );
} else {
  if (!isDevelopment) {
    const distPath = path.resolve(__dirname, "../client/dist");
    app.use(express.static(distPath)); // serve all assets
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

// =========================
// 6) START SERVER
// =========================
const PORT = parseInt(process.env.PORT || "5000", 10);
const HOST = "0.0.0.0";

// Only start server if not running on Vercel (Vercel handles this)
if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`Environment: ${isDevelopment ? "development" : "production"}`);
    console.log("Health checks ready at /health and /");
    console.log("API routes registered and ready");

    // Fire-and-forget database initialization (doesn't block health checks)
    void initializeDatabase().catch((error) => {
      console.error("Background database initialization failed:", error);
    });
  });
} else {
  // On Vercel, initialize database immediately
  void initializeDatabase().catch((error) => {
    console.error("Database initialization failed:", error);
  });
}

// Export for Vercel
export default app;
