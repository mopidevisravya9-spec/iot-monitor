// server.js  (SAMPLE CLOUD: /api/simple + /api/pull + /heartbeat + /devices + /test.html)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (public/test.html)
app.use(express.static("public"));

/**
 * In-memory store (fastest test).
 * Later you can swap this to MongoDB.
 */
const devices = new Map(); // device_id -> { last_seen, lat, lng }
const messages = new Map(); // device_id -> { force, sig, slot, l1, l2, ver }

/**
 * Tuning:
 * ESP heartbeat interval: 10s
 * Offline timeout: 35s (>= 3 heartbeats buffer)
 */
const OFFLINE_AFTER_MS = 35000;

function now() {
  return Date.now();
}
function getDeviceRow(device_id) {
  if (!devices.has(device_id)) {
    devices.set(device_id, { device_id, last_seen: 0, lat: 0, lng: 0 });
  }
  return devices.get(device_id);
}
function getMsgRow(device_id) {
  if (!messages.has(device_id)) {
    messages.set(device_id, {
      device_id,
      force: "",
      sig: "red",
      slot: 0,
      l1: "HELLO FROM CLOUD",
      l2: "DRIVE SAFE",
      ver: 0,
    });
  }
  return messages.get(device_id);
}

// Health check
app.get("/", (req, res) => res.send("OK - iot-monitor sample running"));

// Heartbeat (ESP -> cloud)
app.post("/heartbeat", (req, res) => {
  const { device_id, lat, lng } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const d = getDeviceRow(device_id);
  d.last_seen = now();
  if (typeof lat === "number") d.lat = lat;
  if (typeof lng === "number") d.lng = lng;

  // ensure msg row exists
  getMsgRow(device_id);

  res.json({ ok: true });
});

// Devices list (dashboard uses this)
app.get("/devices", (req, res) => {
  const t = now();
  const out = [];

  for (const d of devices.values()) {
    const age = t - (d.last_seen || 0);
    const status = d.last_seen && age < OFFLINE_AFTER_MS ? "online" : "offline";
    out.push({
      device_id: d.device_id,
      last_seen: d.last_seen || 0,
      lat: d.lat || 0,
      lng: d.lng || 0,
      status,
      age_ms: age,
    });
  }

  out.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
  res.json(out);
});

/**
 * DASHBOARD -> CLOUD (write message)
 * This is what your test dashboard button should call.
 */
app.post("/api/simple", (req, res) => {
  const { device_id, force, sig, slot, l1, l2 } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const m = getMsgRow(device_id);

  if (typeof force === "string") m.force = force; // "" or "red/amber/green"
  if (typeof sig === "string") m.sig = sig;       // "red/amber/green/no"
  if (Number.isFinite(slot)) m.slot = slot;
  if (typeof l1 === "string") m.l1 = l1;
  if (typeof l2 === "string") m.l2 = l2;

  m.ver = now();

  res.json({ ok: true, saved: m });
});

/**
 * ESP <- CLOUD (pull latest message)
 * ESP will call this every ~2 seconds.
 */
app.get("/api/pull/:device_id", (req, res) => {
  const device_id = req.params.device_id;
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const m = getMsgRow(device_id);
  res.json(m);
});

// Optional: quick view in browser
app.get("/api/peek/:device_id", (req, res) => {
  res.json(getMsgRow(req.params.device_id));
});

// START SERVER (Render needs this)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));