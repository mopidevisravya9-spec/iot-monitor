const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// -------- DATABASE --------
mongoose.connect("mongodb://127.0.0.1:27017/iot-monitor")
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

// -------- MODEL --------
const deviceSchema = new mongoose.Schema({
  device_id: { type: String, unique: true },
  lat: Number,
  lng: Number,
  last_seen: Number,
  status: String
});

const Device = mongoose.model("Device", deviceSchema);

// -------- HOME --------
app.get("/", (req, res) => {
  res.send("Server Running");
});

// -------- ADD DEVICE (one time) --------
app.get("/add", async (req, res) => {
  try {
    const d = new Device({
      device_id: "ESP_001",
      lat: 17.3850,
      lng: 78.4867,
      last_seen: 0,
      status: "offline"
    });

    await d.save();
    res.send("Device Added");
  } catch (e) {
    res.send("Already Exists");
  }
});

// -------- GET DEVICES --------
app.get("/devices", async (req, res) => {
  const data = await Device.find();
  res.json(data);
});

// -------- HEARTBEAT --------
app.post("/heartbeat", async (req, res) => {
  const { device_id } = req.body;

  const d = await Device.findOne({ device_id });

  if (!d) return res.send("Device Not Found");

  d.last_seen = Date.now();
  d.status = "online";
  await d.save();

  res.send("OK");
});

// -------- AUTO OFFLINE --------
setInterval(async () => {
  const now = Date.now();

  await Device.updateMany(
    { last_seen: { $lt: now - 30000 } },
    { $set: { status: "offline" } }
  );
}, 5000);

// -------- DASHBOARD --------
app.get("/dashboard", (req, res) => {
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Traffic Monitor</title>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
body{margin:0;font-family:Arial}
.top{display:flex;gap:20px;padding:10px;background:#111;color:#fff}
.card{background:#222;padding:10px;border-radius:8px}
#map{height:90vh}
</style>
</head>

<body>

<div class="top">
  <div class="card">Total: <span id="total">0</span></div>
  <div class="card">Online: <span id="on">0</span></div>
  <div class="card">Offline: <span id="off">0</span></div>
</div>

<div id="map"></div>

<script>

const map = L.map('map').setView([17.3850,78.4867],11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let markers = [];

async function load(){

  const res = await fetch('/devices');
  const data = await res.json();

  markers.forEach(m => map.removeLayer(m));
  markers = [];

  let on=0, off=0;

  data.forEach(d => {

    if(d.status=="online") on++; else off++;

    const color = d.status=="online" ? "green" : "red";

    const marker = L.circleMarker([d.lat,d.lng],{
      radius:8,
      color:color,
      fillColor:color,
      fillOpacity:1
    }).addTo(map);

    marker.bindPopup(
      "<b>"+d.device_id+"</b><br>Status: "+d.status+
      "<br>"+new Date(d.last_seen).toLocaleString()
    );

    markers.push(marker);
  });

  document.getElementById("total").innerText=data.length;
  document.getElementById("on").innerText=on;
  document.getElementById("off").innerText=off;
}

load();
setInterval(load,5000);

</script>

</body>
</html>
`);
});

// -------- START --------
app.listen(5000, () => {
  console.log("Server started on port 5000");
});