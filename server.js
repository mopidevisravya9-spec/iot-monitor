// server.js — SIMPLE CLOUD PUSH/PULL + HEARTBEAT + TEST UI
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// serve /public files (test.html)
app.use(express.static("public"));

// ======================
// DB
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err?.message || err));

// ======================
// MODELS
// ======================
const deviceSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
  last_seen: { type: Number, default: 0 },
  status: { type: String, default: "offline" },
});

const simpleMsgSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  // "AUTO" | "RED" | "AMBER" | "GREEN"
  force: { type: String, default: "AUTO" },
  // "RED" | "AMBER" | "GREEN" | "NO"
  sig: { type: String, default: "RED" },
  slot: { type: Number, default: 0 },
  line1: { type: String, default: "" },
  line2: { type: String, default: "" },
  updated_at: { type: Number, default: 0 },
});

const Device = mongoose.model("Device", deviceSchema);
const SimpleMsg = mongoose.model("SimpleMsg", simpleMsgSchema);

// ======================
// ADMIN AUTH (optional)
// ======================
function requireAdmin(req, res, next) {
  const u = req.headers["x-admin-user"];
  const p = req.headers["x-admin-pass"];
  if (u === "admin" && p === "admin123") return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// HELPERS
// ======================
async function ensureMsgRow(device_id) {
  return SimpleMsg.findOneAndUpdate(
    { device_id },
    { $setOnInsert: { device_id, updated_at: 0 } },
    { upsert: true, new: true }
  );
}

// ======================
// ROUTES
// ======================
app.get("/", (req, res) => res.send("Server Running ✅"));

// heartbeat used by ESP
app.post("/heartbeat", async (req, res) => {
  try {
    const { device_id, lat, lng } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();

    await Device.findOneAndUpdate(
      { device_id },
      {
        $setOnInsert: { device_id },
        $set: {
          last_seen: now,
          status: "online",
          ...(typeof lat === "number" ? { lat } : {}),
          ...(typeof lng === "number" ? { lng } : {}),
        },
      },
      { upsert: true, new: true }
    );

    await ensureMsgRow(device_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// list devices + stable offline rule (NO FLICKER)
app.get("/devices", async (req, res) => {
  try {
    const now = Date.now();
    const OFFLINE_AFTER_MS = 45000; // 45 seconds (stable)

    await Device.updateMany(
      { last_seen: { $lt: now - OFFLINE_AFTER_MS } },
      { $set: { status: "offline" } }
    );

    const data = await Device.find().sort({ last_seen: -1 });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// SIMPLE CLOUD API
// ======================

// Dashboard -> save message to cloud (ADMIN protected)
app.post("/api/simple", requireAdmin, async (req, res) => {
  try {
    const { device_id, force, sig, slot, line1, line2 } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const FORCE = ["AUTO", "RED", "AMBER", "GREEN"];
    const SIG = ["RED", "AMBER", "GREEN", "NO"];

    const safeForce = FORCE.includes(String(force || "").toUpperCase())
      ? String(force).toUpperCase()
      : "AUTO";

    const safeSig = SIG.includes(String(sig || "").toUpperCase())
      ? String(sig).toUpperCase()
      : "RED";

    const safeSlot = Number.isFinite(Number(slot)) ? Number(slot) : 0;

    const now = Date.now();

    const doc = await SimpleMsg.findOneAndUpdate(
      { device_id },
      {
        $setOnInsert: { device_id },
        $set: {
          force: safeForce,
          sig: safeSig,
          slot: safeSlot,
          line1: String(line1 || ""),
          line2: String(line2 || ""),
          updated_at: now,
        },
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, message: "Saved", data: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP -> pull message (NO AUTH)
// returns plain text so ESP doesn't need ArduinoJson
// format: updated_at|force|sig|slot|line1|line2
app.get("/api/pull/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const doc = await ensureMsgRow(device_id);

    const safe = (s) => String(s || "").replaceAll("\n", " ").replaceAll("|", " ");

    const out =
      String(doc.updated_at || 0) + "|" +
      safe(doc.force) + "|" +
      safe(doc.sig) + "|" +
      String(doc.slot || 0) + "|" +
      safe(doc.line1) + "|" +
      safe(doc.line2);

    res.setHeader("Content-Type", "text/plain");
    res.send(out);
  } catch (e) {
    res.status(500).send("0|AUTO|RED|0||");
  }
});

// ======================
// START (REQUIRED FOR RENDER)
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));