// server.js — MAP + DISPLAY integrated (Render ready)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // optional

// -------------------- In-memory store (stable test) --------------------
const store = new Map(); // device_id -> {device_id, force, sig, slot, l1, l2, updated_at}
const seen = new Map();  // device_id -> last_seen_ms
const pos  = new Map();  // device_id -> {lat,lng}

const now = () => Date.now();

// -------------------- Health --------------------
app.get("/", (req, res) => res.send("OK - iot-monitor running"));

// -------------------- Dashboard UI (MAP + DISPLAY tabs) --------------------
app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Junction Operations Dashboard</title>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:#070b18;color:#eaf0ff;overflow:hidden}

  .bg{position:fixed;inset:0;background:
    radial-gradient(1200px 600px at 20% 10%, rgba(11,94,215,.30), transparent 60%),
    radial-gradient(900px 500px at 85% 25%, rgba(45,187,78,.18), transparent 55%),
    radial-gradient(700px 450px at 40% 95%, rgba(208,139,25,.12), transparent 55%),
    linear-gradient(180deg, #070b16 0%, #0b1020 60%, #070b16 100%);z-index:-2}
  .app{height:100%;display:flex;flex-direction:column;padding:12px;gap:12px}

  .shell{
    flex:1;display:flex;flex-direction:column;overflow:hidden;
    background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
    backdrop-filter: blur(10px);
  }

  .topbar{
    height:64px;display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;border-bottom:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  }

  .tabs{display:flex;gap:10px;align-items:center}
  .tab{
    padding:10px 14px;border-radius:14px;cursor:pointer;user-select:none;
    border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.05);
    font-weight:900;letter-spacing:.4px;
    transition:.15s ease;
  }
  .tab:hover{transform:translateY(-1px);background:rgba(255,255,255,.08)}
  .tab.active{
    background:linear-gradient(135deg, rgba(11,94,215,.35), rgba(255,255,255,.06));
    border-color: rgba(173,210,255,.35);
    box-shadow:0 12px 30px rgba(11,94,215,.18);
  }

  .rightTools{display:flex;align-items:center;gap:10px}
  .iconBtn{
    width:40px;height:40px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;transition:.18s ease;
  }
  .iconBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.09)}

  .cards{
    display:flex;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,.10);
    flex-wrap:wrap;background:rgba(255,255,255,.03);
  }
  .card{
    flex:0 0 220px;border-radius:16px;border:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    padding:12px 12px;box-shadow:0 14px 34px rgba(0,0,0,.25);
  }
  .k{font-size:11px;opacity:.75;font-weight:1000;letter-spacing:.8px}
  .v{font-size:28px;font-weight:1100;margin-top:6px}

  .view{display:none;flex:1;overflow:hidden}
  .view.active{display:flex}
  #map{flex:1}

  .panelWrap{flex:1;overflow:auto;padding:14px}
  .panel{
    max-width:980px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.12);
    border-radius:18px;
    padding:18px;
    box-shadow:0 18px 40px rgba(0,0,0,.35);
  }

  .sub{opacity:.8;margin:0 0 16px;line-height:1.4}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  label{font-size:12px;opacity:.85}
  input,select,button{
    width:100%;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.14);
    background:rgba(8,12,22,.8);color:#eaf0ff;outline:none;font-size:14px
  }
  button{cursor:pointer;background:linear-gradient(135deg,#0b5ed7,#0b5ed799);
    border-color:rgba(173,210,255,.35);font-weight:900}
  .row{margin-top:12px}
  .ok{color:#2dbb4e;font-weight:900}
  .bad{color:#ff5b5b;font-weight:900}
  .code{font-family:Consolas,monospace;background:rgba(0,0,0,.35);padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.12)}
  .tiny{font-size:12px;opacity:.75;margin-top:10px;line-height:1.4}

  @media(max-width:920px){
    .card{flex:1 1 160px}
    .grid{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="bg"></div>

<div class="app">
  <div class="shell">

    <div class="topbar">
      <div class="tabs">
        <div class="tab active" id="tabMap" onclick="showTab('map')">MAP</div>
        <div class="tab" id="tabDisp" onclick="showTab('disp')">DISPLAY</div>
      </div>

      <div class="rightTools">
        <div class="iconBtn" title="Refresh now" onclick="loadDevices()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M21 12a9 9 0 1 1-3-6.7" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <path d="M21 3v6h-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="k">TOTAL DEVICES</div><div class="v" id="total">0</div></div>
      <div class="card"><div class="k">ONLINE</div><div class="v" id="on">0</div></div>
      <div class="card"><div class="k">OFFLINE</div><div class="v" id="off">0</div></div>
    </div>

    <!-- MAP VIEW -->
    <div class="view active" id="viewMap">
      <div id="map"></div>
    </div>

    <!-- DISPLAY VIEW -->
    <div class="view" id="viewDisp">
      <div class="panelWrap">
        <div class="panel">
          <h2 style="margin:0 0 6px">ESP Cloud Message Control</h2>
          <p class="sub">
            Dashboard sends to <span class="code">POST /api/simple</span>.
            ESP pulls from <span class="code">GET /api/pull/ESP_001</span> every ~2 sec.
          </p>

          <div class="grid">
            <div>
              <label>Device ID</label>
              <input id="device_id" value="ESP_001"/>
            </div>
            <div>
              <label>Force</label>
              <select id="force">
                <option value="AUTO">AUTO</option>
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
              </select>
            </div>
          </div>

          <div class="grid row">
            <div>
              <label>Signal group</label>
              <select id="sig">
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <label>Slot</label>
              <select id="slot">
                <option value="0">Message 1</option>
                <option value="1">Message 2</option>
                <option value="2">Message 3</option>
                <option value="3">Message 4</option>
                <option value="4">Message 5</option>
              </select>
            </div>
          </div>

          <div class="row">
            <label>Line 1</label>
            <input id="l1" value="HELLO FROM CLOUD"/>
          </div>

          <div class="row">
            <label>Line 2</label>
            <input id="l2" value="DRIVE SAFE"/>
          </div>

          <div class="row">
            <button onclick="sendNow()">Send to ESP (Cloud)</button>
          </div>

          <div class="row tiny" id="status">Status: <span class="bad">Idle</span></div>

          <div class="tiny">
            <div>Pull JSON: <span class="code">/api/pull/ESP_001</span></div>
            <div>Devices JSON: <span class="code">/devices</span></div>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
  // ---------------- Tabs ----------------
  function showTab(which){
    document.getElementById("tabMap").classList.toggle("active", which==="map");
    document.getElementById("tabDisp").classList.toggle("active", which==="disp");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewDisp").classList.toggle("active", which==="disp");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // ---------------- Map ----------------
  const map = L.map('map').setView([17.3850,78.4867], 12);

  // Google tiles
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  function pinIcon(status){
    const isOn = (status === "online");
    const fill = isOn ? "#2dbb4e" : "#d94141";
    const shadow = "rgba(0,0,0,.28)";
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

      let on=0, off=0;

      (data||[]).forEach(d=>{
        const isOn = (d.status==="online");
        if(isOn) on++; else off++;

        const lat = (typeof d.lat === "number") ? d.lat : (d.pos?.lat ?? 0);
        const lng = (typeof d.lng === "number") ? d.lng : (d.pos?.lng ?? 0);
        const pos = [lat || 0, lng || 0];

        const icon = pinIcon(d.status);

        const pop =
          "<b>"+d.device_id+"</b>" +
          "<br>Status: <b style='color:"+(isOn?"#2dbb4e":"#d94141")+"'>"+d.status+"</b>" +
          "<br>Last seen: " + (d.last_seen ? new Date(d.last_seen).toLocaleString() : "-");

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
      console.log("devices error", e);
    }
  }

  setInterval(loadDevices, 2000);
  loadDevices();

  // ---------------- Display send ----------------
  async function sendNow(){
    const device_id = document.getElementById("device_id").value.trim();
    const force = document.getElementById("force").value;
    const sig = document.getElementById("sig").value;
    const slot = Number(document.getElementById("slot").value);
    const l1 = document.getElementById("l1").value;
    const l2 = document.getElementById("l2").value;

    const status = document.getElementById("status");
    status.innerHTML = 'Status: <span class="bad">Sending...</span>';

    try{
      const res = await fetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ device_id, force, sig, slot, l1, l2 })
      });
      const out = await res.json();
      if(res.ok){
        status.innerHTML = 'Status: <span class="ok">Sent ✅</span> updated_at=' + out.saved.updated_at;
      }else{
        status.innerHTML = 'Status: <span class="bad">Failed ❌</span> ' + (out.error||"");
      }
    }catch(e){
      status.innerHTML = 'Status: <span class="bad">Network error ❌</span> ' + e;
    }
  }
</script>

</body>
</html>`);
});

// -------------------- Dashboard writes message --------------------
app.post("/api/simple", (req, res) => {
  const device_id = String(req.body?.device_id || "").trim();
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const payload = {
    device_id,
    force: String(req.body?.force || "AUTO"),
    sig: String(req.body?.sig || "red"),
    slot: Number(req.body?.slot || 0),
    l1: String(req.body?.l1 || ""),
    l2: String(req.body?.l2 || ""),
    updated_at: now(),
  };

  store.set(device_id, payload);
  res.json({ ok: true, saved: payload });
});

// -------------------- ESP pulls latest message --------------------
app.get("/api/pull/:device_id", (req, res) => {
  const device_id = String(req.params.device_id || "").trim();
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const cur = store.get(device_id);
  if (!cur) {
    return res.json({
      device_id,
      force: "AUTO",
      sig: "red",
      slot: 0,
      l1: "",
      l2: "",
      updated_at: 0,
    });
  }
  res.json(cur);
});

// -------------------- Heartbeat (ESP -> cloud) --------------------
// If ESP sends lat/lng later, this will store it too.
app.post("/heartbeat", (req, res) => {
  const device_id = String(req.body?.device_id || "").trim();
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const lat = (typeof req.body?.lat === "number") ? req.body.lat : undefined;
  const lng = (typeof req.body?.lng === "number") ? req.body.lng : undefined;

  seen.set(device_id, now());
  if (typeof lat === "number" && typeof lng === "number") {
    pos.set(device_id, { lat, lng });
  }
  res.json({ ok: true, device_id });
});

// -------------------- Devices list (MAP reads this) --------------------
app.get("/devices", (req, res) => {
  const OFFLINE_AFTER_MS = 30000; // 30 sec stable (no flicker)
  const t = now();
  const out = [];

  // devices that heartbeat
  for (const [device_id, last_seen] of seen.entries()) {
    out.push({
      device_id,
      last_seen,
      status: (t - last_seen) <= OFFLINE_AFTER_MS ? "online" : "offline",
      ...(pos.has(device_id) ? pos.get(device_id) : {}),
    });
  }

  // devices that have messages but no heartbeat yet
  for (const device_id of store.keys()) {
    if (!seen.has(device_id)) {
      out.push({ device_id, last_seen: 0, status: "offline", lat: 0, lng: 0 });
    }
  }

  out.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
  res.json(out);
});

// -------------------- START (REQUIRED FOR RENDER) --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));