import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { LRUCache } from "./lruCache";
import { mockUsers, User } from "./mockUsers";

// cache settings, and server port
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_SIZE = 1000;

// Rate limits
const MAX_PER_MINUTE = 10;
const BURST_PER_10_SECONDS = 5;

// Simple performance metrics
const metrics = {
  totalResponseTimeMs: 0,
  totalRequests: 0
};

const app = express();
app.use(cors());
app.use(express.json());

// Metrics middleware (for avg response time)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const diffMs = Number(end - start) / 1_000_000;
    metrics.totalResponseTimeMs += diffMs;
    metrics.totalRequests += 1;
  });

  next();
});

// RATE LIMITING MIDDLEWARE (IP-based, sliding window)
 
interface RateLimitState {
  last60s: number[]; // timestamps in ms
  last10s: number[];
}

const rateLimitMap = new Map<string, RateLimitState>();

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown").toString();
  const now = Date.now();

  let state = rateLimitMap.get(ip);
  if (!state) {
    state = { last60s: [], last10s: [] };
    rateLimitMap.set(ip, state);
  }

  // prune old timestamps
  state.last60s = state.last60s.filter((t) => now - t <= 60_000);
  state.last10s = state.last10s.filter((t) => now - t <= 10_000);

  if (state.last60s.length >= MAX_PER_MINUTE || state.last10s.length >= BURST_PER_10_SECONDS) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      message:
        "You have exceeded the allowed request rate (10/minute and 5/10s burst). Please try again shortly."
    });
  }

  state.last60s.push(now);
  state.last10s.push(now);

  next();
}

app.use(rateLimiter);

/**
 * LRU CACHE FOR USERS
 */
const userCache = new LRUCache<number, User>({
  maxSize: CACHE_MAX_SIZE,
  ttlMs: CACHE_TTL_MS
});

// Background task to clear stale entries
setInterval(() => {
  userCache.purgeStale();
}, 10_000); // every 10 seconds

/**
 * ASYNC "DATABASE" QUEUE
 */
interface DbJob {
  userId: number;
  resolve: (user: User | null) => void;
  reject: (err: unknown) => void;
}

class DbQueue {
  private queue: DbJob[] = [];
  private processing = false;

  enqueue(job: DbJob) {
    this.queue.push(job);
    this.processNext();
  }

  private async processNext() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        // Simulate DB latency of 200ms
        await new Promise((resolve) => setTimeout(resolve, 200));
        const user = mockUsers[job.userId] ?? null;
        job.resolve(user);
      } catch (err) {
        job.reject(err);
      }
    }

    this.processing = false;
  }
}

const dbQueue = new DbQueue();

function fetchUserFromDb(userId: number): Promise<User | null> {
  return new Promise((resolve, reject) => {
    dbQueue.enqueue({ userId, resolve, reject });
  });
}

/**
 * CONCURRENCY HANDLING FOR SAME USER ID
 * If multiple requests for the same ID arrive and it's not cached,
 * only one "DB" fetch is performed; the others wait for the same promise.
 */
const inFlightFetches = new Map<number, Promise<User | null>>();

/**
 * HELPERS
 */
function parseUserId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid user id. Must be a positive integer." });
    return null;
  }
  return id;
}

/**
 * ROUTES
 */

// GET /users/:id
app.get("/users/:id", async (req: Request, res: Response) => {
  const id = parseUserId(req, res);
  if (id === null) return;

  // 1) Check cache
  const cached = userCache.get(id);
  if (cached) {
    return res.json({
      source: "cache",
      data: cached
    });
  }

  // 2) Handle concurrency via in-flight map
  let fetchPromise = inFlightFetches.get(id);
  if (!fetchPromise) {
    fetchPromise = fetchUserFromDb(id);
    inFlightFetches.set(id, fetchPromise);
  }

  let user: User | null;
  try {
    user = await fetchPromise;
  } finally {
    inFlightFetches.delete(id);
  }

  if (!user) {
    return res.status(404).json({
      error: "User not found",
      message: `No user exists with id=${id}`
    });
  }

  // 3) Cache result only if not already cached
  if (!userCache.has(id)) {
    userCache.set(id, user);
  }

  return res.json({
    source: "database",
    data: user
  });
});

// POST /users (User Creation + cache)
app.post("/users", (req: Request, res: Response) => {
  const { id, name, email } = req.body as Partial<User>;

  if (!id || !name || !email) {
    return res.status(400).json({
      error: "Invalid payload",
      message: "Fields id, name, and email are required."
    });
  }

  if (mockUsers[id]) {
    return res.status(409).json({
      error: "User already exists",
      message: `User with id=${id} already exists.`
    });
  }

  const newUser: User = { id, name, email };
  mockUsers[id] = newUser;

  if (!userCache.has(id)) {
    userCache.set(id, newUser);
  }

  return res.status(201).json({
    message: "User created successfully",
    data: newUser
  });
});

// DELETE /cache (Manual Cache Management)
app.delete("/cache", (req: Request, res: Response) => {
  userCache.clear();
  return res.json({
    message: "Cache cleared successfully"
  });
});

// GET /cache-status (Cache stats + avg response time)
app.get("/cache-status", (req: Request, res: Response) => {
  const stats = userCache.stats;
  const avgResponseTimeMs =
    metrics.totalRequests === 0
      ? 0
      : metrics.totalResponseTimeMs / metrics.totalRequests;

  return res.json({
    cache: {
      hits: stats.hits,
      misses: stats.misses,
      size: stats.size,
      ttlSeconds: CACHE_TTL_MS / 1000
    },
    performance: {
      totalRequests: metrics.totalRequests,
      averageResponseTimeMs: Number(avgResponseTimeMs.toFixed(2))
    }
  });
});

app.get("/", (req: Request, res: Response) => {
  res.json({ message: "User Data API is running" });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
