const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve logo/static assets
app.use("/assets", express.static(path.join(__dirname, "public")));

// ======================
// DATABASE
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
// HEARTBEAT
// ======================
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
// DEVICES (fast offline)
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
// DASHBOARD (LEFT TABS + LOGIN + LOGO + PINS)
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>ARCADIS - Live PMU Status</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  :root{
    --bg:#f4f6f9;
    --panel:#ffffff;
    --stroke:#e6eaf0;
    --txt:#0f172a;
    --muted:#64748b;
    --accent:#1d4ed8;
    --green:#22c55e;
    --red:#ef4444;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:var(--bg);color:var(--txt)}
  a{color:inherit}

  /* Top brand bar */
  .topbar{
    height:60px;display:flex;align-items:center;gap:12px;
    background:var(--panel);border-bottom:1px solid var(--stroke);
    padding:0 16px;
  }
  .brandRow{display:flex;align-items:center;gap:10px}
  .brandTitle{font-weight:900;font-size:20px;letter-spacing:.5px}
  .brandSub{font-size:12px;color:var(--muted);margin-top:2px}

  /* Main layout */
  .main{height:calc(100% - 60px);display:flex}
  .sidebar{
    width:220px;background:var(--panel);border-right:1px solid var(--stroke);
    padding:12px;display:flex;flex-direction:column;gap:10px;
  }
  .tabBtn{
    padding:12px 12px;border-radius:10px;border:1px solid var(--stroke);
    background:#f8fafc;cursor:pointer;font-weight:800;
    display:flex;align-items:center;gap:10px;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .tabBtn:hover{transform:translateY(-1px);box-shadow:0 10px 18px rgba(15,23,42,.08)}
  .tabBtn.active{background:var(--accent);color:#fff;border-color:var(--accent)}

  .content{flex:1;display:flex;flex-direction:column}
  .cardsRow{
    padding:12px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;
  }
  .card{
    background:var(--panel);border:1px solid var(--stroke);border-radius:12px;
    padding:12px 14px;
  }
  .cardLabel{font-size:12px;color:var(--muted);font-weight:700}
  .cardValue{font-size:26px;font-weight:900;margin-top:6px}

  .view{display:none;flex:1;padding:0 16px 16px 16px}
  .view.active{display:block}
  #map{height:100%;border-radius:14px;border:1px solid var(--stroke);overflow:hidden}

  /* PMU list tab */
  .panel{
    background:var(--panel);border:1px solid var(--stroke);border-radius:14px;
    padding:12px;
  }
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .search{
    flex:1;min-width:220px;
    padding:12px;border:1px solid var(--stroke);border-radius:10px;outline:none;
  }
  .btn{
    padding:12px 14px;border-radius:10px;border:1px solid var(--stroke);
    background:var(--accent);color:#fff;font-weight:900;cursor:pointer;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .btn:hover{transform:translateY(-1px);box-shadow:0 12px 18px rgba(29,78,216,.18)}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{padding:10px;border-bottom:1px solid var(--stroke);text-align:left}
  th{color:var(--muted);font-size:12px}
  .pill{
    display:inline-flex;align-items:center;gap:6px;
    padding:4px 10px;border-radius:999px;font-weight:900;font-size:12px;
  }
  .pill.on{background:rgba(34,197,94,.12);color:var(--green)}
  .pill.off{background:rgba(239,68,68,.12);color:var(--red)}
  .dot{width:8px;height:8px;border-radius:50%}
  .dot.on{background:var(--green)} .dot.off{background:var(--red)}

  /* Bottom-left logo */
  .footerBrand{
    position:fixed;left:14px;bottom:12px;
    display:flex;align-items:center;gap:10px;
    background:rgba(255,255,255,.92);
    border:1px solid var(--stroke);
    border-radius:12px;padding:8px 10px;
    box-shadow:0 16px 26px rgba(15,23,42,.10);
    backdrop-filter: blur(6px);
  }
  .footerBrand img{height:26px;width:auto;display:block}
  .footerText{font-size:12px;color:var(--muted);font-weight:800}
  .footerText b{color:var(--txt)}

  /* LOGIN overlay */
  .loginOverlay{
    position:fixed;inset:0;
    background:linear-gradient(135deg,#0b1220, #0b2a3a);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;
  }
  .loginCard{
    width:min(420px,92vw);
    background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.18);
    border-radius:18px;
    padding:18px;
    color:#fff;
    box-shadow:0 22px 70px rgba(0,0,0,.45);
    animation: pop .28s ease;
    backdrop-filter: blur(10px);
  }
  @keyframes pop{from{transform:scale(.97);opacity:.0}to{transform:scale(1);opacity:1}}
  .loginTitle{font-size:20px;font-weight:900;letter-spacing:.6px}
  .loginSub{margin-top:6px;font-size:12px;opacity:.85}
  .loginGrid{display:grid;gap:10px;margin-top:14px}
  .loginInput{
    width:100%;padding:12px 12px;border-radius:12px;
    border:1px solid rgba(255,255,255,.22);
    background:rgba(0,0,0,.20);
    color:#fff;outline:none;
  }
  .loginBtn{
    width:100%;padding:12px 12px;border-radius:12px;border:0;
    background:#2b8cff;color:#fff;font-weight:900;cursor:pointer;
  }
  .loginErr{margin-top:10px;font-size:12px;color:#ffb4b4;display:none}
</style>
</head>

<body>

<!-- LOGIN -->
<div class="loginOverlay" id="loginOverlay">
  <div class="loginCard">
    <div class="loginTitle">ARCADIS PMU Dashboard</div>
    <div class="loginSub">Sign in to access live junction status</div>
    <div class="loginGrid">
      <input class="loginInput" id="u" placeholder="Username" autocomplete="off">
      <input class="loginInput" id="p" placeholder="Password" type="password">
      <button class="loginBtn" onclick="doLogin()">Login</button>
      <div class="loginErr" id="loginErr">Invalid username or password</div>
    </div>
  </div>
</div>

<!-- APP -->
<div class="topbar">
  <div class="brandRow">
    <div style="font-size:26px;font-weight:900;color:#0f172a;">ARCADIS</div>
    <div>
      <div class="brandSub">Live pmu data processing and junction status</div>
    </div>
  </div>
  <div style="margin-left:auto;display:flex;gap:10px;align-items:center;">
    <button class="btn" onclick="manualRefresh()">Refresh</button>
    <button class="btn" style="background:#0f172a" onclick="logout()">Logout</button>
  </div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="tabBtn active" id="btnMap" onclick="showView('map')">🗺️ Map</div>
    <div class="tabBtn" id="btnPmu" onclick="showView('pmu')">📋 PMU Info</div>
  </div>

  <div class="content">
    <div class="cardsRow">
      <div class="card">
        <div class="cardLabel">Total PMUs</div>
        <div class="cardValue" id="total">0</div>
      </div>
      <div class="card">
        <div class="cardLabel">Online PMUs</div>
        <div class="cardValue" id="on">0</div>
      </div>
      <div class="card">
        <div class="cardLabel">Offline PMUs</div>
        <div class="cardValue" id="off">0</div>
      </div>
    </div>

    <div class="view active" id="viewMap">
      <div id="map"></div>
    </div>

    <div class="view" id="viewPmu">
      <div class="panel">
        <div class="row">
          <input class="search" id="search" placeholder="Search Junction Name / Device ID..." oninput="renderTable()">
          <button class="btn" onclick="manualRefresh()">Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Lat</th>
              <th>Lng</th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- Bottom-left logo -->
<div class="footerBrand">
  <img src="/assets/image.png" alt="Arcadis Logo">
  <div class="footerText"><b>Powered by</b> Arcadis</div>
</div>

<script>
  // ===== LOGIN (UI-level) =====
  // Note: this is client-side only. For real security, we add server sessions later.
  const ADMIN_USER = "admin";
  const ADMIN_PASS = "admin123";

  function doLogin(){
    const u = (document.getElementById("u").value || "").trim();
    const p = (document.getElementById("p").value || "").trim();
    const err = document.getElementById("loginErr");

    if(u === ADMIN_USER && p === ADMIN_PASS){
      localStorage.setItem("arcadis_auth", "1");
      document.getElementById("loginOverlay").style.display = "none";
      err.style.display = "none";
      setTimeout(()=>{ map.invalidateSize(); }, 150);
    }else{
      err.style.display = "block";
    }
  }

  function logout(){
    localStorage.removeItem("arcadis_auth");
    location.reload();
  }

  // auto-check
  if(localStorage.getItem("arcadis_auth") === "1"){
    document.getElementById("loginOverlay").style.display = "none";
  }

  // Enter key login
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Enter" && document.getElementById("loginOverlay").style.display !== "none"){
      doLogin();
    }
  });

  // ===== Views =====
  function showView(which){
    document.getElementById("btnMap").classList.toggle("active", which==="map");
    document.getElementById("btnPmu").classList.toggle("active", which==="pmu");

    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewPmu").classList.toggle("active", which==="pmu");

    if(which==="map") setTimeout(()=>map.invalidateSize(), 150);
  }

  // ===== MAP =====
  const map = L.map('map').setView([17.3850,78.4867], 11);

  // Google tiles
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  // Pin icon like screenshot
  function pinIcon(status){
    const isOn = (status === "online");
    const color = isOn ? "#22c55e" : "#ef4444";
    return L.divIcon({
      className: "",
      html: \`
        <div style="position:relative;width:30px;height:40px;">
          <div style="
            position:absolute;left:50%;top:0;
            width:22px;height:22px;border-radius:50%;
            background:\${color};
            transform:translateX(-50%);
            box-shadow:0 10px 18px rgba(0,0,0,.25);
            border:2px solid #ffffff;
          "></div>
          <div style="
            position:absolute;left:50%;top:16px;
            width:0;height:0;
            border-left:11px solid transparent;
            border-right:11px solid transparent;
            border-top:20px solid \${color};
            transform:translateX(-50%);
            filter:drop-shadow(0 10px 14px rgba(0,0,0,.25));
          "></div>
          <div style="
            position:absolute;left:50%;top:6px;
            width:8px;height:8px;border-radius:50%;
            background:#fff;
            transform:translateX(-50%);
          "></div>
        </div>\`,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    });
  }

  const markers = new Map();
  let latestData = [];

  async function fetchDevices(){
    const res = await fetch("/devices", { cache: "no-store" });
    const data = await res.json();
    latestData = Array.isArray(data) ? data : [];
    return latestData;
  }

  function updateCounters(data){
    let on = 0, off = 0;
    data.forEach(d => (d.status === "online") ? on++ : off++);
    document.getElementById("total").innerText = data.length;
    document.getElementById("on").innerText = on;
    document.getElementById("off").innerText = off;
  }

  function updateMap(data){
    data.forEach(d => {
      const id = d.device_id || "";
      const pos = [d.lat || 0, d.lng || 0];
      const icon = pinIcon(d.status);
      const pop =
        "<b>"+id+"</b>" +
        "<br>Status: <b style='color:"+(d.status==="online"?"#22c55e":"#ef4444")+"'>"+d.status+"</b>" +
        "<br>Last seen: "+ new Date(d.last_seen||0).toLocaleString();

      if(markers.has(id)){
        markers.get(id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
      }else{
        const m = L.marker(pos, { icon }).addTo(map).bindPopup(pop);
        markers.set(id, m);
      }
    });
  }

  function renderTable(){
    const q = (document.getElementById("search").value || "").trim().toLowerCase();
    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";

    latestData
      .filter(d => !q || (String(d.device_id||"").toLowerCase().includes(q)))
      .slice(0, 800) // safety cap
      .forEach(d => {
        const tr = document.createElement("tr");

        const status = d.status === "online" ? "on" : "off";
        tr.innerHTML = \`
          <td><b>\${d.device_id || ""}</b></td>
          <td>
            <span class="pill \${status}">
              <span class="dot \${status}"></span>
              \${d.status}
            </span>
          </td>
          <td>\${new Date(d.last_seen||0).toLocaleString()}</td>
          <td>\${(d.lat ?? 0).toFixed(6)}</td>
          <td>\${(d.lng ?? 0).toFixed(6)}</td>
        \`;
        tbody.appendChild(tr);
      });
  }

  async function loadAll(){
    try{
      const data = await fetchDevices();
      updateCounters(data);
      updateMap(data);
      renderTable();
    }catch(e){
      // keep silent
    }
  }

  function manualRefresh(){
    loadAll();
  }

  loadAll();
  setInterval(loadAll, 1000); // 1 sec refresh
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