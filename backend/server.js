import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { nanoid } from "nanoid";
import { body, validationResult } from "express-validator";
import authRouter from "./routes/auth.js";
import { verifyJWT } from "./middleware/auth.js";

dotenv.config();
const app = express();

// Security + parsing
const ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173").split(",").map(s => s.trim());
const corsOptions = {
  origin: (origin, cb) => (!origin || ORIGINS.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
  credentials: true,
};
app.use(cors(corsOptions));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false }));
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth", authRouter);

// DB connect helper (exported for tests)
export async function connectDB(uri) {
  if (!uri) {
    console.warn("⚠️ MONGODB_URI is not set");
    return;
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log("✅ MongoDB Connected Successfully!");
}

// Health first
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Summary Schema
const summarySchema = new mongoose.Schema({
  note: { type: String, required: true },
  summary: { type: String, required: true },
  tags: [{ type: String, trim: true }],
  starred: { type: Boolean, default: false },
  slug: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
});
summarySchema.index({ note: "text", summary: "text", tags: "text" });

const Summary = mongoose.model("Summary", summarySchema);

// Routes
app.get("/", (_req, res) => res.send("API is running"));

/**
 * Get all summaries (array) OR paginated when page/limit provided
 */
app.get("/api/summaries", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const page = Number(req.query.page || 0); // 0 means return array (backward compatible)
    const limit = Number(req.query.limit || 0);
    const sort = req.query.sort || "-createdAt";

    const filter = q
      ? { $or: [{ note: new RegExp(q, "i") }, { summary: new RegExp(q, "i") }, { tags: new RegExp(q, "i") }] }
      : {};

    if (page > 0 && limit > 0) {
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        Summary.find(filter).sort(sort).skip(skip).limit(limit),
        Summary.countDocuments(filter),
      ]);
      return res.json({ items, page, pages: Math.ceil(total / limit), total });
    } else {
      const items = await Summary.find(filter).sort(sort);
      return res.json(items);
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Save new summary
 */
app.post(
  "/api/summaries",
  verifyJWT,
  [
    body("note").isString().isLength({ min: 1, max: 20000 }),
    body("summary").isString().isLength({ min: 1, max: 8000 }),
    body("tags").optional().isArray({ max: 10 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { note, summary, tags = [] } = req.body;
    try {
      const cleaned = tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
      const savedSummary = await new Summary({ note, summary, tags: cleaned, userId: req.user.id }).save();
      res.status(201).json(savedSummary);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

/**
 * Update summary
 */
app.put(
  "/api/summaries/:id",
  verifyJWT,
  [
    body("note").optional().isString().isLength({ min: 1, max: 20000 }),
    body("summary").optional().isString().isLength({ min: 1, max: 8000 }),
    body("tags").optional().isArray({ max: 10 }),
    body("starred").optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const updated = await Summary.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!updated) return res.status(404).json({ message: "Summary not found" });
      res.json(updated);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }
);

/**
 * Delete summary
 */
app.delete("/api/summaries/:id", verifyJWT, async (req, res) => {
  try {
    const deleted = await Summary.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Summary not found" });
    res.json({ message: "Summary deleted successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * Toggle star
 */
app.patch("/api/summaries/:id/star", async (req, res) => {
  try {
    const doc = await Summary.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Summary not found" });
    doc.starred = Boolean(req.body.starred ?? !doc.starred);
    await doc.save();
    res.json(doc);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * Create a public share slug
 */
app.post("/api/summaries/:id/share", async (req, res) => {
  try {
    const slug = nanoid(10);
    const updated = await Summary.findByIdAndUpdate(req.params.id, { slug }, { new: true });
    if (!updated) return res.status(404).json({ message: "Summary not found" });
    res.json({ slug });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Public read (no auth)
 */
app.get("/api/s/:slug", async (req, res) => {
  try {
    const doc = await Summary.findOne({ slug: req.params.slug });
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json({ note: doc.note, summary: doc.summary, tags: doc.tags, createdAt: doc.createdAt });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 404 + error handlers
app.use((req, res) => res.status(404).json({ message: "Not Found" }));
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

const PORT = Number(process.env.PORT) || 5000;

// Only auto-connect/listen when not running tests
let server;
if (process.env.NODE_ENV !== "test") {
  connectDB(process.env.MONGODB_URI)
    .catch((err) => console.error("❌ MongoDB Connection Error:", err.message));
  server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

export { app, server };