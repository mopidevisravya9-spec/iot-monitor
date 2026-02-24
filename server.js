const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ======================
// DATABASE (Local + Render)
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err));

// ======================
// MODEL
// ======================
const deviceSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
  last_seen: { type: Number, default: 0 },
  status: { type: String, default: "offline" }
});

const Device = mongoose.model("Device", deviceSchema);

// ======================
// HOME
// ======================
app.get("/", (req, res) => {
  res.send("Server Running");
});

// ======================
// REGISTER / ADD DEVICE (use POST, supports dynamic id + lat/lng)
// ======================
// Call once per device (or whenever you want to update location):
// POST /register  JSON: { "device_id":"ESP_001", "lat":17.385, "lng":78.4867 }
app.post("/register", async (req, res) => {
  try {
    const { device_id, lat, lng } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();

    const doc = await Device.findOneAndUpdate(
      { device_id },
      {
        $setOnInsert: { device_id },
        $set: {
          lat: typeof lat === "number" ? lat : 0,
          lng: typeof lng === "number" ? lng : 0,
          last_seen: now,
          status: "online"
        }
      },
      { upsert: true, new: true }
    );

    res.json({ message: "Registered", device: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// KEEP /add (optional, for your old testing - fixed to avoid duplicates)
// ======================
app.get("/add", async (req, res) => {
  try {
    const device_id = "ESP_001";
    const now = Date.now();

    await Device.findOneAndUpdate(
      { device_id },
      {
        $setOnInsert: { device_id },
        $set: { lat: 17.3850, lng: 78.4867, last_seen: now, status: "online" }
      },
      { upsert: true, new: true }
    );

    res.send("Device Added/Updated");
  } catch (e) {
    res.status(500).send("Error: " + String(e.message || e));
  }
});

// ======================
// GET DEVICES (also auto-mark offline based on last_seen)
// ======================
app.get("/devices", async (req, res) => {
  try {
    const now = Date.now();
    const OFFLINE_AFTER_MS = 30000; // 30 sec

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
// HEARTBEAT (ESP calls this repeatedly)
// ======================
// POST /heartbeat JSON: { "device_id":"ESP_001" }
app.post("/heartbeat", async (req, res) => {
  try {
    const { device_id } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();

    await Device.findOneAndUpdate(
      { device_id },
      { $set: { last_seen: now, status: "online" } },
      { upsert: true, new: true }
    );

    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// AUTO OFFLINE (background)
// ======================
setInterval(async () => {
  try {
    const now = Date.now();
    await Device.updateMany(
      { last_seen: { $lt: now - 30000 } },
      { $set: { status: "offline" } }
    );
  } catch (e) {
    // keep silent to avoid spam
  }
}, 5000);

// ======================
// DASHBOARD (Google tiles in Leaflet + only top cards + map)
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Traffic Monitor</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial}
  .top{
    display:flex;gap:14px;align-items:center;
    padding:12px 14px;background:#0b2a3a;color:#fff
  }
  .card{
    background:#143e55;padding:10px 14px;border-radius:14px;
    min-width:160px; box-shadow:0 6px 18px rgba(0,0,0,.18)
  }
  .label{opacity:.9;font-size:12px;letter-spacing:.5px}
  .n{font-size:28px;font-weight:800;margin-top:4px}
  #map{height:calc(100% - 70px)}
</style>
</head>

<body>
  <div class="top">
    <div class="card"><div class="label">TOTAL DEVICES</div><div class="n" id="total">0</div></div>
    <div class="card"><div class="label">ONLINE</div><div class="n" id="on">0</div></div>
    <div class="card"><div class="label">OFFLINE</div><div class="n" id="off">0</div></div>
  </div>

  <div id="map"></div>

<script>
  const map = L.map('map').setView([17.3850,78.4867], 11);

  // Google-like tiles (free endpoint used commonly)
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  function makeIcon(color){
    return L.divIcon({
      className: "",
      html: '<div style="width:14px;height:14px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.35)"></div>',
      iconSize:[14,14],
      iconAnchor:[7,7]
    });
  }

  async function load(){
    const res = await fetch('/devices');
    const data = await res.json();

    let on = 0, off = 0;
    document.getElementById("total").innerText = data.length;

    data.forEach(d => {
      const isOn = (d.status === "online");
      if(isOn) on++; else off++;

      const pos = [d.lat || 0, d.lng || 0];
      const pop =
        "<b>"+(d.device_id||"")+"</b>" +
        "<br>Status: "+(d.status||"") +
        "<br>Last seen: "+ new Date(d.last_seen||0).toLocaleString();

      const icon = makeIcon(isOn ? "lime" : "red");

      if(markers.has(d.device_id)){
        markers.get(d.device_id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
      } else {
        const m = L.marker(pos, {icon}).addTo(map).bindPopup(pop);
        markers.set(d.device_id, m);
      }
    });

    document.getElementById("on").innerText = on;
    document.getElementById("off").innerText = off;
  }

  load();
  setInterval(load, 5000);
</script>
</body>
</html>
  `);
});

// ======================
// START (Render needs env PORT)
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});