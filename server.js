// server.js — FULL INTEGRATED (MAP + DISPLAY) + /dashboard + markers + slots/messages

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ======================
// DATABASE
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err?.message || err));

// ======================
// SETTINGS
// ======================
const OFFLINE_AFTER_MS = 30000; // device becomes offline if no heartbeat in 30 sec
const MSG_SLOTS = 5;

// ======================
// DEFAULT MESSAGES (slots per signal)
// ======================
const PRESETS = {
  red: [
    { l1: "STOP. LIFE HAS RIGHT OF WAY.", l2: "BRAKE NOW — LIVE LONG." },
    { l1: "RED LIGHT: NO SHORTCUTS.", l2: "ONE MISTAKE = ONE LIFETIME." },
    { l1: "WAIT HERE. WIN LIFE.", l2: "DON'T TRADE TIME FOR TROUBLE." },
    { l1: "HOLD ON. STAY SAFE.", l2: "SAFETY IS ALWAYS ON TIME." },
    { l1: "STOP MEANS SMART.", l2: "SMART DRIVERS REACH HOME." },
  ],
  amber: [
    { l1: "SLOW DOWN. THINK AHEAD.", l2: "CONTROL THE SPEED." },
    { l1: "EASE OFF. STAY ALIVE.", l2: "RUSH = RISK." },
    { l1: "READY TO STOP.", l2: "DON'T PUSH YOUR LUCK." },
    { l1: "CALM DRIVE. CLEAN LIFE.", l2: "YOUR FAMILY IS WAITING." },
    { l1: "PAUSE THE THRILL.", l2: "SAVE A LIFE TODAY." },
  ],
  green: [
    { l1: "GO — BUT STAY ALERT.", l2: "SAFE DISTANCE ALWAYS." },
    { l1: "MOVE SMART, NOT FAST.", l2: "EYES ON ROAD." },
    { l1: "GREEN IS NOT A RACE.", l2: "RESPECT EVERY LANE." },
    { l1: "DRIVE LIKE A PRO.", l2: "INDICATE. CHECK. MOVE." },
    { l1: "REACH HOME, NOT HEADLINES.", l2: "SAFETY FIRST." },
  ],
  no: [
    { l1: "SIGNAL OFF — DRIVE SLOW.", l2: "GIVE WAY. STAY SAFE." },
    { l1: "NO SIGNAL — USE SENSE.", l2: "FOLLOW LANE DISCIPLINE." },
    { l1: "BE PATIENT.", l2: "AVOID HONKING & RUSHING." },
    { l1: "WEAR HELMET.", l2: "WEAR SEAT BELT." },
    { l1: "STOP. LOOK. GO.", l2: "SAFETY IS THE RULE." },
  ],
};

function clampSlot(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n >= MSG_SLOTS) return MSG_SLOTS - 1;
  return n;
}

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
const Device = mongoose.model("Device", deviceSchema);

const simpleSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  force: { type: String, default: "" }, // ""|"red"|"amber"|"green"
  sig: { type: String, default: "red" }, // "red"|"amber"|"green"|"no"
  slot: { type: Number, default: 0 },
  l1: { type: String, default: "" },
  l2: { type: String, default: "" },
  updated_at: { type: Number, default: 0 },
});
const SimpleCmd = mongoose.model("SimpleCmd", simpleSchema);

async function ensureSimple(device_id) {
  return SimpleCmd.findOneAndUpdate(
    { device_id },
    {
      $setOnInsert: {
        device_id,
        force: "",
        sig: "red",
        slot: 0,
        l1: PRESETS.red[0].l1,
        l2: PRESETS.red[0].l2,
        updated_at: 0,
      },
    },
    { upsert: true, new: true }
  );
}

// ======================
// BASIC ROUTES
// ======================
app.get("/", (req, res) => res.redirect("/dashboard"));

app.get("/health", (req, res) => res.json({ ok: true }));

// ESP register (optional)
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

    await ensureSimple(device_id);
    res.json({ message: "Registered", device: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP heartbeat
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

    await ensureSimple(device_id);
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Devices list + auto offline
app.get("/devices", async (req, res) => {
  try {
    const now = Date.now();
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
// SIMPLE CLOUD CONTROL (what your ESP is using)
// ======================

// Dashboard sends message to cloud (NO AUTH in this test build)
app.post("/api/simple", async (req, res) => {
  try {
    const device_id = String(req.body.device_id || "").trim();
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const force = String(req.body.force || "").trim(); // "" | red | amber | green
    const sig = String(req.body.sig || "red").trim(); // red|amber|green|no
    const slot = clampSlot(req.body.slot);

    let l1 = String(req.body.l1 || "");
    let l2 = String(req.body.l2 || "");

    // If user didn’t type lines, auto use preset lines based on sig+slot
    const s = ["red", "amber", "green", "no"].includes(sig) ? sig : "red";
    const preset = (PRESETS[s] && PRESETS[s][slot]) ? PRESETS[s][slot] : PRESETS.red[0];
    if (!l1) l1 = preset.l1;
    if (!l2) l2 = preset.l2;

    const now = Date.now();
    const doc = await SimpleCmd.findOneAndUpdate(
      { device_id },
      { $set: { force, sig: s, slot, l1, l2, updated_at: now } },
      { upsert: true, new: true }
    );

    res.json({ ok: true, config: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP pulls latest command
app.get("/api/pull/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const doc = await ensureSimple(device_id);

    res.json({
      device_id: doc.device_id,
      force: doc.force || "",
      sig: doc.sig || "red",
      slot: Number.isFinite(doc.slot) ? doc.slot : 0,
      l1: doc.l1 || "",
      l2: doc.l2 || "",
      updated_at: doc.updated_at || 0,
      slots: MSG_SLOTS,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// (Optional) expose presets so UI can auto-fill
app.get("/api/presets", (req, res) => {
  res.json({ slots: MSG_SLOTS, presets: PRESETS });
});

// ======================
// DASHBOARD UI
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IoT Monitor</title>

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
    width:240px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    backdrop-filter: blur(10px);
    box-shadow:0 18px 50px rgba(0,0,0,.35);
    display:flex;flex-direction:column;
    padding:12px;
  }
  .brand{
    display:flex;align-items:center;gap:10px;
    padding:10px 10px 14px 10px;
    border-bottom:1px solid rgba(255,255,255,.10);
    margin-bottom:10px;
  }
  .dot{width:10px;height:10px;border-radius:50%;background:rgba(45,187,78,.9);box-shadow:0 0 14px rgba(45,187,78,.6)}
  .brand .t{font-weight:900;letter-spacing:.4px}
  .brand .s{font-size:12px;opacity:.7;margin-top:2px}

  .nav{
    display:flex;flex-direction:column;gap:6px;margin-top:10px;
  }
  .nav a{
    text-decoration:none;color:#e9eefc;
    display:flex;align-items:center;gap:10px;
    padding:12px 12px;
    border-radius:14px;
    border:1px solid transparent;
    transition:.15s ease;
    opacity:.92;
  }
  .nav a:hover{background:rgba(255,255,255,.06)}
  .nav a.active{
    background:linear-gradient(135deg, rgba(11,94,215,.32), rgba(255,255,255,.05));
    border-color: rgba(173,210,255,.25);
    box-shadow:0 12px 30px rgba(11,94,215,.16);
    opacity:1;
  }
  .ico{width:28px;height:28px;border-radius:10px;display:grid;place-items:center;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10)}
  .lbl{font-weight:800;letter-spacing:.2px}
  .sub{font-size:12px;opacity:.7;margin-top:2px}

  .content{
    flex:1;display:flex;flex-direction:column;
    background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    backdrop-filter: blur(10px);
    overflow:hidden;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .topbar{
    height:62px;display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;border-bottom:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  }
  .rightActions{display:flex;gap:10px;align-items:center}
  .iconBtn{
    width:42px;height:42px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;transition:.15s ease;
  }
  .iconBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.10)}

  .cards{
    display:flex;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,.10);
    flex-wrap:wrap;background:rgba(255,255,255,.03);
  }
  .card{
    flex:0 0 260px;border-radius:16px;border:1px solid rgba(255,255,255,.10);
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
  .card .v{font-size:28px;font-weight:1000;margin-top:6px;position:relative}

  .view{display:none;flex:1;min-height:0}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1;min-height:0}

  .panelWrap{padding:14px;overflow:auto}
  .panel{
    max-width:1100px;
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;padding:16px;
    box-shadow:0 18px 50px rgba(0,0,0,.30);
  }
  .panelTitle{font-size:22px;font-weight:1000;margin-bottom:6px}
  .panelHint{font-size:13px;opacity:.75;margin-bottom:12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  label{font-size:12px;opacity:.8;font-weight:900;letter-spacing:.6px}
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
  .statusLine{margin-top:10px;font-size:13px;opacity:.85}
  .ok{color:#2dbb4e;font-weight:900}
  .bad{color:#d94141;font-weight:900}

  @media (max-width: 980px){
    .sidebar{width:86px;padding:10px}
    .brand{display:none}
    .lbl,.sub{display:none}
    .cards .card{flex:1 1 180px}
    .grid{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="bg"></div><div class="noise"></div>

<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="dot"></div>
      <div>
        <div class="t">IoT Monitor</div>
        <div class="s">Operations Console</div>
      </div>
    </div>

    <nav class="nav">
      <a href="#" id="navMap" class="active" onclick="showTab('map');return false;">
        <div class="ico">🗺️</div>
        <div>
          <div class="lbl">MAP</div>
          <div class="sub">Markers + status</div>
        </div>
      </a>

      <a href="#" id="navDisp" onclick="showTab('disp');return false;">
        <div class="ico">🖥️</div>
        <div>
          <div class="lbl">DISPLAY</div>
          <div class="sub">Cloud messages</div>
        </div>
      </a>
    </nav>
  </aside>

  <main class="content">
    <div class="topbar">
      <div style="font-weight:1000;letter-spacing:.3px;opacity:.9"> </div>
      <div class="rightActions">
        <div class="iconBtn" title="Refresh now" onclick="loadDevices(true)">
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

    <section class="view active" id="viewMap">
      <div id="map"></div>
    </section>

    <section class="view" id="viewDisp">
      <div class="panelWrap">
        <div class="panel">
          <div class="panelTitle">Cloud Message Control</div>
          <div class="panelHint">Pick device → pick signal → pick slot → lines auto-fill → send.</div>

          <div class="grid">
            <div>
              <label>Device</label>
              <select id="devSel"></select>
            </div>
            <div>
              <label>Force</label>
              <select id="forceSel">
                <option value="">AUTO</option>
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
              </select>
            </div>
          </div>

          <div style="height:10px"></div>

          <div class="grid">
            <div>
              <label>Signal group</label>
              <select id="sigSel">
                <option value="red">RED → STOP</option>
                <option value="amber">AMBER → WAIT</option>
                <option value="green">GREEN → GO</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <label>Slot</label>
              <select id="slotSel"></select>
            </div>
          </div>

          <div style="height:10px"></div>

          <div class="grid">
            <div>
              <label>Line 1</label>
              <input id="l1" />
            </div>
            <div>
              <label>Line 2</label>
              <input id="l2" />
            </div>
          </div>

          <div style="height:12px"></div>

          <button onclick="sendToCloud()">Send to ESP (Cloud)</button>
          <div class="statusLine" id="sendStatus">Status: <span>Idle</span></div>
        </div>
      </div>
    </section>
  </main>
</div>

<script>
  // ========= auth stub (kept minimal)
  function logout(){
    localStorage.clear();
    location.reload();
  }

  // ========= tabs
  function showTab(which){
    document.getElementById("navMap").classList.toggle("active", which==="map");
    document.getElementById("navDisp").classList.toggle("active", which==="disp");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewDisp").classList.toggle("active", which==="disp");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // ========= map
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

  // ========= presets
  let PRESETS = null;
  async function loadPresets(){
    const r = await fetch("/api/presets");
    PRESETS = await r.json();
  }

  function buildSlotOptions(sig){
    const slotSel = document.getElementById("slotSel");
    slotSel.innerHTML = "";
    const list = (PRESETS && PRESETS.presets && PRESETS.presets[sig]) ? PRESETS.presets[sig] : [];
    const slots = (PRESETS && PRESETS.slots) ? PRESETS.slots : (list.length || 5);
    for(let i=0;i<slots;i++){
      const it = list[i] || {l1:"",l2:""};
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = (i+1) + ". " + (it.l1 || ("Message " + (i+1)));
      slotSel.appendChild(opt);
    }
  }

  function autofillLines(){
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);
    const it = (PRESETS && PRESETS.presets && PRESETS.presets[sig] && PRESETS.presets[sig][slot])
      ? PRESETS.presets[sig][slot]
      : {l1:"",l2:""};
    document.getElementById("l1").value = it.l1 || "";
    document.getElementById("l2").value = it.l2 || "";
  }

  // ========= devices + markers + dropdown
  async function loadDevices(nowClick){
    try{
      const res = await fetch("/devices");
      const data = await res.json();

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

      // device dropdown
      const devSel = document.getElementById("devSel");
      const cur = devSel.value;
      devSel.innerHTML = "";
      (data||[]).forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + (d.status ? (" ("+d.status+")") : "");
        devSel.appendChild(opt);
      });
      if(cur) devSel.value = cur;

      if(nowClick && data && data[0] && markers.has(data[0].device_id)){
        // optional focus
      }
    }catch(e){
      console.log(e);
    }
  }
  setInterval(loadDevices, 2000);

  // ========= send to cloud
  async function sendToCloud(){
    const device_id = document.getElementById("devSel").value;
    const force = document.getElementById("forceSel").value;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);
    const l1 = document.getElementById("l1").value || "";
    const l2 = document.getElementById("l2").value || "";

    const st = document.getElementById("sendStatus");
    st.innerHTML = "Status: <span>Sending…</span>";

    try{
      const r = await fetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ device_id, force, sig, slot, l1, l2 })
      });
      const out = await r.json();
      if(r.ok){
        st.innerHTML = "Status: <span class='ok'>Sent ✅</span>";
      }else{
        st.innerHTML = "Status: <span class='bad'>Failed ❌</span> " + (out.error||"");
      }
    }catch(e){
      st.innerHTML = "Status: <span class='bad'>Network error ❌</span>";
    }
  }

  // ========= init
  (async function init(){
    await loadPresets();
    buildSlotOptions("red");
    autofillLines();

    document.getElementById("sigSel").addEventListener("change", ()=>{
      const s = document.getElementById("sigSel").value;
      buildSlotOptions(s);
      document.getElementById("slotSel").value = "0";
      autofillLines();
    });
    document.getElementById("slotSel").addEventListener("change", autofillLines);

    await loadDevices(true);
  })();
</script>
</body>
</html>`);
});

// ======================
// START SERVER ✅ REQUIRED FOR RENDER
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));