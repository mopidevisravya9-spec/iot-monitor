const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve static files from /public
// Put your logo at: public/image.png
app.use(express.static("public"));

// ======================
// DATABASE
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err));

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

const commandSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  type: { type: String, default: "no" },        // red/amber/green/no
  msg1: { type: String, default: "" },
  msg2: { type: String, default: "" },
  force: { type: String, default: "" },         // red/amber/green/""
  updated_at: { type: Number, default: 0 },
});

const Device = mongoose.model("Device", deviceSchema);
const Command = mongoose.model("Command", commandSchema);

// ======================
// HOME
// ======================
app.get("/", (req, res) => {
  res.send("Server Running");
});

// ======================
// REGISTER
// ======================
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
          status: "online",
        },
      },
      { upsert: true, new: true }
    );

    // ensure command row exists
    await Command.findOneAndUpdate(
      { device_id },
      { $setOnInsert: { device_id, updated_at: 0 } },
      { upsert: true, new: true }
    );

    res.json({ message: "Registered", device: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// HEARTBEAT
// ======================
app.post("/heartbeat", async (req, res) => {
  try {
    const { device_id, lat, lng } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();

    await Device.findOneAndUpdate(
      { device_id },
      {
        $set: {
          last_seen: now,
          status: "online",
          ...(typeof lat === "number" ? { lat } : {}),
          ...(typeof lng === "number" ? { lng } : {}),
        },
      },
      { upsert: true, new: true }
    );

    // ensure command row exists
    await Command.findOneAndUpdate(
      { device_id },
      { $setOnInsert: { device_id, updated_at: 0 } },
      { upsert: true, new: true }
    );

    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DEVICES (auto-offline FAST)
// ======================
app.get("/devices", async (req, res) => {
  try {
    const now = Date.now();
    const OFFLINE_AFTER_MS = 5000; // 5 sec

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
// COMMAND API (REMOTE CONTROL)
// Dashboard -> POST /api/command
// ESP -> GET /api/command/:device_id
// ======================

// Simple admin auth (dashboard uses this)
// header: x-admin-user: admin
// header: x-admin-pass: admin123
function requireAdmin(req, res, next) {
  const u = req.headers["x-admin-user"];
  const p = req.headers["x-admin-pass"];
  if (u === "admin" && p === "admin123") return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// Dashboard sends command
app.post("/api/command", requireAdmin, async (req, res) => {
  try {
    const { device_id, type, msg1, msg2, force } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();
    const doc = await Command.findOneAndUpdate(
      { device_id },
      {
        $set: {
          device_id,
          type: type || "no",
          msg1: msg1 || "",
          msg2: msg2 || "",
          force: force || "",
          updated_at: now,
        },
      },
      { upsert: true, new: true }
    );

    res.json({ message: "Command saved", command: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP reads command (no auth so ESP can fetch easily)
app.get("/api/command/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const doc = await Command.findOne({ device_id });
    if (!doc) return res.json({ device_id, updated_at: 0, type: "no", msg1: "", msg2: "", force: "" });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DASHBOARD (LOGIN + LEFT TABS + PINS + REMOTE CONTROL)
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Arcadis - Junction Status</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:#f4f6f9}

  /* Layout */
  .app{height:100%;display:flex}
  .sidebar{
    width:220px;background:#ffffff;border-right:1px solid #e6e8ee;
    display:flex;flex-direction:column;gap:8px;padding:12px;
  }
  .logoTop{
    display:flex;align-items:center;gap:10px;padding:6px 6px 12px 6px;
    border-bottom:1px solid #eef0f6;
  }
  .logoTop img{height:34px}
  .logoTop .t1{font-weight:900;letter-spacing:.5px}
  .logoTop .t2{font-size:12px;color:#6b7280;margin-top:2px}

  .navbtn{
    display:flex;align-items:center;gap:10px;
    padding:10px 12px;border-radius:10px;
    cursor:pointer;user-select:none;
    border:1px solid transparent;
    font-weight:700;color:#111827;
  }
  .navbtn.active{background:#eef6ff;border-color:#cfe5ff;color:#0b5ed7}
  .navbtn:hover{background:#f6f7fb}

  .content{flex:1;display:flex;flex-direction:column}
  .topbar{
    height:58px;background:#ffffff;border-bottom:1px solid #e6e8ee;
    display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;
  }
  .title{font-weight:900}
  .logout{
    padding:8px 12px;border-radius:10px;border:1px solid #e6e8ee;
    background:#fff;cursor:pointer;font-weight:800;
  }

  .cards{
    display:flex;gap:12px;padding:12px;background:#ffffff;border-bottom:1px solid #e6e8ee;
  }
  .card{
    flex:0 0 210px;background:#f8fafc;border:1px solid #e6e8ee;border-radius:12px;
    padding:10px 12px;
  }
  .card .k{font-size:12px;color:#6b7280;font-weight:800}
  .card .v{font-size:26px;font-weight:900;margin-top:4px}

  #map{flex:1}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}

  /* Control page */
  .ctlwrap{padding:14px;max-width:900px}
  .panel{
    background:#ffffff;border:1px solid #e6e8ee;border-radius:14px;padding:14px;
  }
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .grid1{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
  input,select,button{
    width:100%;padding:12px;border-radius:12px;border:1px solid #e6e8ee;outline:none;
    font-size:14px;
  }
  button{background:#0b5ed7;color:#fff;border-color:#0b5ed7;font-weight:900;cursor:pointer}
  .hint{font-size:12px;color:#6b7280}

  /* Bottom-left watermark */
  .watermark{
    position:fixed;left:10px;bottom:10px;
    background:rgba(255,255,255,.9);
    border:1px solid #e6e8ee;border-radius:12px;
    padding:8px 10px;display:flex;align-items:center;gap:10px;
    box-shadow:0 10px 20px rgba(0,0,0,.08);
    z-index:9999;
  }
  .watermark img{height:26px}
  .watermark .p{font-size:12px;font-weight:900;color:#111827}
  .watermark .s{font-size:11px;color:#6b7280;margin-top:1px}

  /* Login overlay */
  .loginOverlay{
    position:fixed;inset:0;background:linear-gradient(135deg,#0b5ed7,#061a3a);
    display:flex;align-items:center;justify-content:center;z-index:10000;
  }
  .loginCard{
    width:min(420px,92vw);
    background:rgba(255,255,255,.96);
    border-radius:18px;border:1px solid rgba(255,255,255,.5);
    padding:18px;box-shadow:0 30px 60px rgba(0,0,0,.35);
    animation:pop .35s ease;
  }
  @keyframes pop{from{transform:scale(.96);opacity:.5}to{transform:scale(1);opacity:1}}
  .loginTop{display:flex;align-items:center;gap:12px}
  .loginTop img{height:34px}
  .loginTop .h{font-size:18px;font-weight:1000}
  .err{color:#b91c1c;font-size:12px;font-weight:800;margin-top:8px;display:none}
</style>
</head>

<body>

<!-- LOGIN -->
<div class="loginOverlay" id="loginOverlay">
  <div class="loginCard">
    <div class="loginTop">
      <img src="/image.png" onerror="this.style.display='none'"/>
      <div>
        <div class="h">Arcadis Junction Dashboard</div>
        <div class="hint">Login required</div>
      </div>
    </div>

    <div style="margin-top:12px">
      <div class="hint">Username</div>
      <input id="u" placeholder="admin"/>
    </div>
    <div style="margin-top:10px">
      <div class="hint">Password</div>
      <input id="p" type="password" placeholder="admin123"/>
    </div>
    <div class="err" id="err">Invalid login</div>
    <div style="margin-top:12px">
      <button onclick="doLogin()">Login</button>
    </div>
  </div>
</div>

<div class="app">

  <!-- LEFT SIDEBAR -->
  <div class="sidebar">
    <div class="logoTop">
      <img src="/image.png" onerror="this.style.display='none'"/>
      <div>
        <div class="t1">ARCADIS</div>
        <div class="t2">Junction status & control</div>
      </div>
    </div>

    <div class="navbtn active" id="navMap" onclick="showTab('map')">🗺️ Map</div>
    <div class="navbtn" id="navCtl" onclick="showTab('ctl')">🕹️ Control</div>
  </div>

  <!-- MAIN -->
  <div class="content">
    <div class="topbar">
      <div class="title">Live Junction Status</div>
      <button class="logout" onclick="logout()">Logout</button>
    </div>

    <div class="cards">
      <div class="card"><div class="k">TOTAL DEVICES</div><div class="v" id="total">0</div></div>
      <div class="card"><div class="k">ONLINE</div><div class="v" id="on">0</div></div>
      <div class="card"><div class="k">OFFLINE</div><div class="v" id="off">0</div></div>
      <div class="card"><div class="k">REFRESH</div><div class="v" style="font-size:18px;margin-top:10px">1 second</div></div>
    </div>

    <!-- MAP -->
    <div class="view active" id="viewMap">
      <div id="map"></div>
    </div>

    <!-- CONTROL -->
    <div class="view" id="viewCtl">
      <div class="ctlwrap">
        <div class="panel">
          <div style="font-weight:1000;font-size:16px">Remote Control (Works from anywhere)</div>
          <div class="hint" style="margin-top:6px">
            This sends command to server → ESP reads it → display updates (no need to connect PC to ESP Wi-Fi).
          </div>

          <div class="grid">
            <div>
              <div class="hint">Device</div>
              <select id="deviceSelect"></select>
            </div>
            <div>
              <div class="hint">Signal Type</div>
              <select id="type">
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Force Signal (optional)</div>
              <select id="force">
                <option value="">No Force</option>
                <option value="red">Force RED</option>
                <option value="amber">Force AMBER</option>
                <option value="green">Force GREEN</option>
              </select>
            </div>
            <div>
              <div class="hint">Command status</div>
              <input id="statusBox" readonly value="Idle"/>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Message Line 1</div>
              <input id="msg1" placeholder="Enter message line 1"/>
            </div>
            <div>
              <div class="hint">Message Line 2</div>
              <input id="msg2" placeholder="Enter message line 2"/>
            </div>
          </div>

          <div class="grid1">
            <button onclick="sendCommand()">Send to Device</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Bottom-left Powered by -->
<div class="watermark">
  <img src="/image.png" onerror="this.style.display='none'"/>
  <div>
    <div class="p">Powered by Arcadis</div>
    <div class="s">Live monitoring</div>
  </div>
</div>

<script>
  // ===== LOGIN (UI only) =====
  function doLogin(){
    const u = document.getElementById("u").value.trim();
    const p = document.getElementById("p").value.trim();
    const ok = (u==="admin" && p==="admin123");
    document.getElementById("err").style.display = ok ? "none" : "block";
    if(ok){
      localStorage.setItem("arcadis_auth_user","admin");
      localStorage.setItem("arcadis_auth_pass","admin123");
      document.getElementById("loginOverlay").style.display="none";
      loadDevices();
    }
  }
  function logout(){
    localStorage.removeItem("arcadis_auth_user");
    localStorage.removeItem("arcadis_auth_pass");
    location.reload();
  }
  (function boot(){
    const u = localStorage.getItem("arcadis_auth_user");
    const p = localStorage.getItem("arcadis_auth_pass");
    if(u==="admin" && p==="admin123"){
      document.getElementById("loginOverlay").style.display="none";
      loadDevices();
    }
  })();

  function authHeaders(){
    return {
      "x-admin-user": localStorage.getItem("arcadis_auth_user") || "",
      "x-admin-pass": localStorage.getItem("arcadis_auth_pass") || ""
    };
  }

  // ===== TABS =====
  function showTab(which){
    document.getElementById("navMap").classList.toggle("active", which==="map");
    document.getElementById("navCtl").classList.toggle("active", which==="ctl");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewCtl").classList.toggle("active", which==="ctl");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // ===== MAP =====
  const map = L.map('map').setView([17.3850,78.4867], 12);

  // Google tiles
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  // ✅ Marker pins like your screenshot (red/green pin with white circle)
  function pinIcon(status){
    const isOn = (status === "online");
    const fill = isOn ? "#2dbb4e" : "#d94141"; // green/red
    const shadow = "rgba(0,0,0,.25)";
    const html = \`
      <div style="width:28px;height:28px;transform:translate(-14px,-28px);">
        <svg width="28" height="28" viewBox="0 0 64 64">
          <path d="M32 2C20 2 10.5 11.6 10.5 23.5 10.5 40.5 32 62 32 62S53.5 40.5 53.5 23.5C53.5 11.6 44 2 32 2Z"
                fill="\${fill}" stroke="white" stroke-width="4" style="filter:drop-shadow(0 6px 6px \${shadow});"/>
          <circle cx="32" cy="24" r="10" fill="white" opacity="0.95"/>
        </svg>
      </div>\`;
    return L.divIcon({ className:"", html, iconSize:[28,28], iconAnchor:[14,28] });
  }

  async function loadDevices(){
    try{
      const res = await fetch('/devices');
      const data = await res.json();

      // fill dropdown
      const sel = document.getElementById("deviceSelect");
      const current = sel.value;
      sel.innerHTML = "";
      (data||[]).forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")";
        sel.appendChild(opt);
      });
      if(current) sel.value = current;

      let on=0, off=0;
      (data||[]).forEach(d=>{
        const isOn = (d.status==="online");
        if(isOn) on++; else off++;

        const pos = [d.lat || 0, d.lng || 0];
        const icon = pinIcon(d.status);

        const pop =
          "<b>"+d.device_id+"</b>" +
          "<br>Status: <b style='color:"+(isOn?"#2dbb4e":"#d94141")+"'>"+d.status+"</b>" +
          "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

        if(markers.has(d.device_id)){
          markers.get(d.device_id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
        }else{
          const m = L.marker(pos,{icon}).addTo(map).bindPopup(pop);
          markers.set(d.device_id,m);
        }
      });

      document.getElementById("total").innerText = (data||[]).length;
      document.getElementById("on").innerText = on;
      document.getElementById("off").innerText = off;
    }catch(e){
      console.log(e);
    }
  }

  // refresh every 1 sec
  setInterval(loadDevices, 1000);

  // ===== REMOTE CONTROL =====
  async function sendCommand(){
    const device_id = document.getElementById("deviceSelect").value;
    const type = document.getElementById("type").value;
    const force = document.getElementById("force").value;
    const msg1 = document.getElementById("msg1").value || "";
    const msg2 = document.getElementById("msg2").value || "";

    const statusBox = document.getElementById("statusBox");
    statusBox.value = "Sending...";

    try{
      const res = await fetch("/api/command", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          ...authHeaders()
        },
        body: JSON.stringify({ device_id, type, force, msg1, msg2 })
      });

      const out = await res.json();
      if(res.ok){
        statusBox.value = "Sent ✅";
      }else{
        statusBox.value = "Failed ❌ " + (out.error || "");
      }
    }catch(e){
      statusBox.value = "Error ❌";
    }
  }
</script>

</body>
</html>
  `);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});