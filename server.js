// server.js — FULL (MAP + DISPLAY tab, cloud push/pull, markers, no extra text)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// IN-MEMORY STORE (No Mongo needed)
// ===============================

// Devices table (device_id => { device_id, lat, lng, last_seen, status })
const DEVICES = new Map();

// Cloud messages table (device_id => payload)
const CLOUD = new Map();

// Offline rule (important to stop flicker)
const OFFLINE_AFTER_MS = 35 * 1000; // 35 sec (ESP HB every 10s → safe)

// ===============================
// HELPERS
// ===============================
function now() {
  return Date.now();
}

function ensureDevice(device_id) {
  if (!DEVICES.has(device_id)) {
    DEVICES.set(device_id, {
      device_id,
      lat: 17.385,
      lng: 78.4867,
      last_seen: 0,
      status: "offline",
    });
  }
  return DEVICES.get(device_id);
}

function setOnline(device_id, lat, lng) {
  const d = ensureDevice(device_id);
  d.last_seen = now();
  d.status = "online";
  if (typeof lat === "number") d.lat = lat;
  if (typeof lng === "number") d.lng = lng;
}

function refreshOfflineStatuses() {
  const t = now();
  for (const d of DEVICES.values()) {
    if (!d.last_seen) {
      d.status = "offline";
      continue;
    }
    if (t - d.last_seen > OFFLINE_AFTER_MS) d.status = "offline";
    else d.status = "online";
  }
}

// ===============================
// BASIC ENDPOINTS
// ===============================
app.get("/", (req, res) => res.redirect("/dashboard"));

app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Junction Operations</title>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:#0b1020;color:#e9eefc;overflow:hidden}
  .bg{position:fixed;inset:0;background:
    radial-gradient(1200px 600px at 20% 10%, rgba(11,94,215,.35), transparent 60%),
    radial-gradient(900px 500px at 85% 25%, rgba(45,187,78,.22), transparent 55%),
    radial-gradient(700px 450px at 40% 95%, rgba(208,139,25,.18), transparent 55%),
    linear-gradient(180deg, #070b16 0%, #0b1020 60%, #070b16 100%);z-index:-2}
  .noise{position:fixed;inset:0;z-index:-1;opacity:.06;pointer-events:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");}

  .app{height:100%;display:flex;gap:12px;padding:12px}
  .sidebar{
    width:92px;background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);border-radius:18px;
    backdrop-filter: blur(10px);
    display:flex;flex-direction:column;align-items:center;padding:10px 8px;gap:10px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .navbtn{
    width:72px;height:72px;border-radius:18px;
    display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;
    cursor:pointer;user-select:none;border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.04);transition:.18s ease;
  }
  .navbtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.07)}
  .navbtn.active{
    background:linear-gradient(135deg, rgba(11,94,215,.35), rgba(255,255,255,.06));
    border-color: rgba(173,210,255,.35);
    box-shadow:0 12px 30px rgba(11,94,215,.18);
  }
  .navico{font-size:22px}
  .navtxt{font-size:11px;font-weight:900;opacity:.85;letter-spacing:.6px}

  .content{
    flex:1;display:flex;flex-direction:column;
    background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;backdrop-filter: blur(10px);
    overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35);
  }

  .topbar{
    height:62px;display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;border-bottom:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  }
  .topLeft{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.4px}
  .pill{
    padding:8px 10px;border-radius:999px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.05);
    font-size:12px;font-weight:900;opacity:.9;
  }
  .iconBtn{
    width:40px;height:40px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;transition:.18s ease;
  }
  .iconBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.09)}
  .iconBtn svg{opacity:.9}

  .cards{
    display:flex;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,.10);
    flex-wrap:wrap;background:rgba(255,255,255,.03);
  }
  .card{
    flex:0 0 240px;border-radius:16px;border:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    padding:12px 12px;box-shadow:0 14px 34px rgba(0,0,0,.25);
    position:relative;overflow:hidden;
  }
  .card:before{
    content:"";position:absolute;inset:-2px;
    background:radial-gradient(300px 100px at 20% 0%, rgba(255,255,255,.15), transparent 60%);
    opacity:.7;
  }
  .card .k{font-size:11px;opacity:.75;font-weight:900;letter-spacing:.8px;position:relative}
  .card .v{font-size:30px;font-weight:1000;margin-top:6px;position:relative}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1}

  .pane{padding:14px;max-width:1120px}
  .panel{
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;padding:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.30);
  }
  .hint{font-size:12px;opacity:.75;line-height:1.35}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}

  input,select,button{
    width:100%;padding:12px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(10,14,28,.55);
    color:#e9eefc;outline:none;font-size:14px;
  }
  button{
    cursor:pointer;
    background:linear-gradient(135deg, rgba(11,94,215,.95), rgba(11,94,215,.65));
    border-color: rgba(173,210,255,.35);
    font-weight:1000;transition:.15s ease;
  }
  button:hover{transform:translateY(-1px)}
  .status{margin-top:10px;font-weight:900;font-size:12px;opacity:.9}

  .mini{
    padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.05);font-size:12px;font-weight:900;
  }

  @media (max-width: 920px){
    .card{flex:1 1 160px}
    .grid{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="bg"></div><div class="noise"></div>

<div class="app">
  <div class="sidebar">
    <div class="navbtn active" id="navMap" onclick="showTab('map')">
      <div class="navico">🗺️</div><div class="navtxt">MAP</div>
    </div>
    <div class="navbtn" id="navDisplay" onclick="showTab('display')">
      <div class="navico">🖥️</div><div class="navtxt">DISPLAY</div>
    </div>
  </div>

  <div class="content">
    <div class="topbar">
      <div class="topLeft">
        <div class="pill">Junction Operations</div>
        <div class="pill" id="liveTag">Live</div>
      </div>

      <div style="display:flex;gap:10px">
        <div class="iconBtn" title="Refresh" onclick="loadDevices(true)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <path d="M21 3v6h-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="iconBtn" title="Logout" onclick="logout()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <path d="M15 12H3m0 0 3-3m-3 3 3 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="k">TOTAL DEVICES</div><div class="v" id="total">0</div></div>
      <div class="card"><div class="k">ONLINE</div><div class="v" id="on">0</div></div>
      <div class="card"><div class="k">OFFLINE</div><div class="v" id="off">0</div></div>
    </div>

    <div class="view active" id="viewMap">
      <div id="map"></div>
    </div>

    <div class="view" id="viewDisplay">
      <div class="pane">
        <div class="panel">
          <div style="font-weight:1000;font-size:18px">Cloud Message Control</div>
          <div class="hint" style="margin-top:6px">
            Pick device → pick signal → pick slot → messages auto-fill → send.
          </div>

          <div class="grid">
            <div>
              <div class="hint">Device</div>
              <select id="devSel"></select>
            </div>
            <div>
              <div class="hint">Force</div>
              <select id="forceSel">
                <option value="">AUTO</option>
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
              </select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Signal group</div>
              <select id="sigSel"></select>
            </div>
            <div>
              <div class="hint">Slot</div>
              <select id="slotSel"></select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Line 1</div>
              <input id="l1" />
            </div>
            <div>
              <div class="hint">Line 2</div>
              <input id="l2" />
            </div>
          </div>

          <div class="row" style="margin-top:12px">
            <button onclick="sendCloud()">Send to ESP (Cloud)</button>
          </div>

          <div class="status" id="status">Status: Idle</div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
  // ====== “Logout” is just a reload (you can add auth later) ======
  function logout(){ location.reload(); }

  function showTab(which){
    document.getElementById("navMap").classList.toggle("active", which==="map");
    document.getElementById("navDisplay").classList.toggle("active", which==="display");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewDisplay").classList.toggle("active", which==="display");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // ====== MAP ======
  const map = L.map('map').setView([17.3850,78.4867], 12);
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

  async function loadDevices(manual=false){
    try{
      const res = await fetch('/devices');
      const data = await res.json();

      // markers + counts
      let on=0, off=0;
      (data||[]).forEach(d=>{
        const isOn = (d.status==="online");
        if(isOn) on++; else off++;

        const pos = [d.lat || 0, d.lng || 0];
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

      // live tag
      const liveTag = document.getElementById("liveTag");
      liveTag.textContent = on>0 ? "Live" : "Degraded";
      liveTag.style.borderColor = on>0 ? "rgba(190,255,210,.35)" : "rgba(255,190,190,.35)";
      liveTag.style.background = on>0 ? "rgba(45,187,78,.12)" : "rgba(217,65,65,.12)";

      // device dropdown for DISPLAY tab
      const sel = document.getElementById("devSel");
      const prev = sel.value;
      sel.innerHTML = "";
      (data||[]).forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")";
        sel.appendChild(opt);
      });
      if(prev) sel.value = prev;

    }catch(e){
      console.log(e);
    }
  }

  setInterval(loadDevices, 3000);
  loadDevices(true);

  // ====== DISPLAY TAB (dynamic messages by color + slot) ======
  const PACK = {
    red: [
      ["STOP NOW. LIVE LONG.", "HIT BRAKES, NOT LIVES."],
      ["RED LIGHT = LIFE LINE.", "DON'T CROSS DESTINY."],
      ["ONE SECOND RUSH", "CAN COST A LIFETIME."],
      ["BRAKE EARLY.", "ARRIVE SAFELY."],
      ["STAY BEHIND THE LINE.", "STAY IN YOUR LIFE."],
      ["STOP HERE.", "START LIVING."],
      ["DON’T RACE THE SIGNAL.", "RACE TO HOME SAFE."],
      ["WAIT. WATCH. WIN.", "SAFETY ALWAYS."],
    ],
    amber: [
      ["SLOW DOWN.", "DANGER DOESN’T WARN."],
      ["EASE OFF SPEED.", "KEEP CONTROL."],
      ["AMBER SAYS: THINK.", "YOUR FAMILY WAITS."],
      ["NOT WORTH THE RISK.", "TAKE THE NEXT GREEN."],
      ["HOLD ON.", "SAVE A LIFE."],
      ["CAUTION MODE.", "EYES ON ROAD."],
      ["SLOW IS SMART.", "SMART IS SAFE."],
      ["BE PATIENT.", "BE ALIVE."],
    ],
    green: [
      ["GO — BUT STAY ALERT.", "SAFE DISTANCE ALWAYS."],
      ["GREEN IS NOT RACE.", "MOVE WITH CARE."],
      ["REACH HOME.", "NOT HEADLINES."],
      ["WATCH MIRRORS.", "WATCH LANE."],
      ["SMOOTH DRIVE.", "SAFE DRIVE."],
      ["FOLLOW LINES.", "FOLLOW LIFE."],
      ["NO PHONE.", "FULL FOCUS."],
      ["RESPECT SPEED.", "PROTECT LIFE."],
    ],
    no: [
      ["SIGNAL OFF.", "DRIVE SLOW."],
      ["GIVE WAY.", "NO HURRY."],
      ["KEEP LEFT.", "KEEP SAFE."],
      ["WATCH ALL SIDES.", "CROSS CAREFULLY."],
      ["NO SIGNAL.", "USE COMMON SENSE."],
      ["SLOW & STEADY.", "SAFE & READY."],
      ["BE KIND ON ROAD.", "BE SAFE AT HOME."],
      ["STOP, LOOK, GO.", "RULES SAVE YOU."],
    ]
  };

  const SIGS = [
    {key:"red",   label:"RED → STOP"},
    {key:"amber", label:"AMBER → WAIT"},
    {key:"green", label:"GREEN → GO"},
    {key:"no",    label:"NO SIGNAL"},
  ];

  const sigSel = document.getElementById("sigSel");
  SIGS.forEach(s=>{
    const o=document.createElement("option");
    o.value=s.key; o.textContent=s.label;
    sigSel.appendChild(o);
  });

  const slotSel = document.getElementById("slotSel");

  function rebuildSlots(){
    const s = sigSel.value;
    const arr = PACK[s] || [];
    slotSel.innerHTML = "";

    // Use “real” labels (not Message 1..)
    arr.forEach((pair, idx)=>{
      const o=document.createElement("option");
      o.value=String(idx);
      o.textContent = (idx+1) + ". " + pair[0];
      slotSel.appendChild(o);
    });

    slotSel.value = "0";
    fillLinesFromSlot();
  }

  function fillLinesFromSlot(){
    const s = sigSel.value;
    const i = Number(slotSel.value || 0);
    const pair = (PACK[s] && PACK[s][i]) ? PACK[s][i] : ["",""];
    document.getElementById("l1").value = pair[0];
    document.getElementById("l2").value = pair[1];
  }

  sigSel.addEventListener("change", rebuildSlots);
  slotSel.addEventListener("change", fillLinesFromSlot);
  rebuildSlots();

  async function sendCloud(){
    const device_id = document.getElementById("devSel").value || "ESP_001";
    const force = document.getElementById("forceSel").value || "";
    const sig = sigSel.value;
    const slot = Number(slotSel.value || 0);
    const line1 = document.getElementById("l1").value || "";
    const line2 = document.getElementById("l2").value || "";

    const status = document.getElementById("status");
    status.textContent = "Status: Sending...";

    try{
      const res = await fetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ device_id, force, sig, slot, line1, line2 })
      });
      const out = await res.json();
      if(res.ok){
        status.textContent = "Status: Sent ✅";
      }else{
        status.textContent = "Status: Failed ❌ " + (out.error || "");
      }
    }catch(e){
      status.textContent = "Status: Network error ❌";
    }
  }
</script>
</body>
</html>`);
});

// ===============================
// REGISTER + HEARTBEAT (ESP calls these)
// ===============================

// optional: register
app.post("/register", (req, res) => {
  const { device_id, lat, lng } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "device_id required" });
  setOnline(device_id, lat, lng);
  res.json({ ok: true });
});

app.post("/heartbeat", (req, res) => {
  const { device_id, lat, lng } = req.body || {};
  if (!device_id) return res.status(400).json({ error: "device_id required" });
  setOnline(device_id, lat, lng);
  res.json({ ok: true });
});

// ===============================
// DEVICES LIST (Dashboard uses this)
// ===============================
app.get("/devices", (req, res) => {
  refreshOfflineStatuses();
  const out = Array.from(DEVICES.values()).sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
  res.json(out);
});

// ===============================
// CLOUD SIMPLE API (Dashboard -> Server)
// ===============================
app.post("/api/simple", (req, res) => {
  try {
    const { device_id, force, sig, slot, line1, line2 } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    // Save cloud payload for ESP pull
    CLOUD.set(device_id, {
      device_id,
      force: force || "",
      sig: sig || "red",
      slot: Number.isFinite(slot) ? slot : 0,
      line1: String(line1 || ""),
      line2: String(line2 || ""),
      updated_at: Date.now(),
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ===============================
// CLOUD PULL API (ESP -> Server)
// ===============================
app.get("/api/pull/:device_id", (req, res) => {
  const device_id = req.params.device_id;
  const payload =
    CLOUD.get(device_id) ||
    {
      device_id,
      force: "",
      sig: "red",
      slot: 0,
      line1: "DEFAULT MESSAGE",
      line2: "DRIVE SAFE",
      updated_at: 0,
    };
  res.json(payload);
});

// ===============================
// START SERVER (Render needs this)
// ===============================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));