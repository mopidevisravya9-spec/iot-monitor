// server.js ✅ FULL WORKING (Render + Mongo + Devices + Map Markers + Cloud Message Control + /dashboard)
// NOTE: Put Arcadis logo as: public/image.png

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves /image.png

// ======================
// DATABASE
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err?.message || err));

// ======================
// CONSTANTS
// ======================
const OFFLINE_AFTER_MS = 30000; // 30s window (stable online/offline)
const MSG_SLOTS = 5;

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

function defaultPacks() {
  const pack = (pairs) => pairs.map(([l1, l2]) => ({ l1, l2 }));
  return {
    red: pack([
      ["STOP MEANS LIFE.", "BRAKE NOW. LIVE LONG."],
      ["RED = RULE.", "RULES SAVE FAMILIES."],
      ["DON'T RACE TIME.", "ARRIVE SAFE."],
      ["WAIT A MINUTE.", "SAVE A LIFETIME."],
      ["STOP HERE.", "START LIVING."],
    ]),
    amber: pack([
      ["EASE OFF SPEED.", "CONTROL WINS."],
      ["SLOW IS SMART.", "RISK IS COSTLY."],
      ["PAUSE THE HURRY.", "KEEP IT SAFE."],
      ["DON'T PUSH LUCK.", "STAY ALERT."],
      ["CALM THE ACCELERATOR.", "HOME IS THE GOAL."],
    ]),
    green: pack([
      ["GO — BUT STAY ALERT.", "SAFE DISTANCE ALWAYS."],
      ["MOVE SMART.", "DON'T RACE."],
      ["EYES UP.", "PHONE DOWN."],
      ["SMOOTH DRIVE.", "SAFE ARRIVAL."],
      ["GREEN MEANS GO.", "NOT GAMBLE."],
    ]),
    no: pack([
      ["SIGNAL OFF.", "DRIVE DEFENSIVE."],
      ["SLOW DOWN.", "GIVE WAY."],
      ["KEEP LEFT.", "KEEP SAFE."],
      ["BE PATIENT.", "BE ALIVE."],
      ["FOLLOW RULES.", "EVEN WITHOUT LIGHTS."],
    ]),
  };
}

const cloudMsgSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },

  // force: "" | "red" | "amber" | "green"
  force: { type: String, default: "" },

  // slot per signal
  slot: {
    red: { type: Number, default: 0 },
    amber: { type: Number, default: 0 },
    green: { type: Number, default: 0 },
    no: { type: Number, default: 0 },
  },

  // per signal message packs
  packs: {
    red: { type: Array, default: () => defaultPacks().red },
    amber: { type: Array, default: () => defaultPacks().amber },
    green: { type: Array, default: () => defaultPacks().green },
    no: { type: Array, default: () => defaultPacks().no },
  },

  // version for ESP (ESP pulls only when v changes)
  v: { type: Number, default: 0 },

  updated_at: { type: Number, default: 0 },
});

const Device = mongoose.model("Device", deviceSchema);
const CloudMsg = mongoose.model("CloudMsg", cloudMsgSchema);

// ======================
// HELPERS
// ======================
const signals = ["red", "amber", "green", "no"];

function clampSlot(n) {
  const x = Number.isFinite(n) ? n : 0;
  if (x < 0) return 0;
  if (x >= MSG_SLOTS) return MSG_SLOTS - 1;
  return x;
}

function normalizePack(arr) {
  const safe = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let i = 0; i < MSG_SLOTS; i++) {
    const it = safe[i] || {};
    out.push({ l1: String(it.l1 || ""), l2: String(it.l2 || "") });
  }
  return out;
}

async function ensureMsgRow(device_id) {
  return CloudMsg.findOneAndUpdate(
    { device_id },
    {
      $setOnInsert: {
        device_id,
        force: "",
        slot: { red: 0, amber: 0, green: 0, no: 0 },
        packs: defaultPacks(),
        v: 0,
        updated_at: 0,
      },
    },
    { upsert: true, new: true }
  );
}

// ======================
// HOME
// ======================
app.get("/", (req, res) => res.send("Server Running ✅"));

// ======================
// DEVICE REGISTER + HEARTBEAT
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

    await ensureMsgRow(device_id);
    res.json({ message: "Registered", device: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

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

    await ensureMsgRow(device_id);
    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DEVICES LIST (updates offline state)
// ======================
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
// SIMPLE CLOUD MESSAGE API (Dashboard writes, ESP pulls)
// ======================
// POST /api/simple  {device_id, force, sig, slot, line1, line2}
app.post("/api/simple", async (req, res) => {
  try {
    const { device_id, force, sig, slot, line1, line2 } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const doc = await ensureMsgRow(device_id);
    const now = Date.now();

    // validate force
    const f = String(force || "");
    if (!(f === "" || f === "red" || f === "amber" || f === "green")) {
      return res.status(400).json({ error: "invalid force" });
    }
    doc.force = f;

    const s = String(sig || "red");
    if (!signals.includes(s)) return res.status(400).json({ error: "invalid sig" });

    const sl = clampSlot(Number(slot || 0));
    const l1 = String(line1 || "");
    const l2 = String(line2 || "");

    const packs = doc.packs || defaultPacks();
    packs[s] = normalizePack(packs[s]);
    packs[s][sl] = { l1, l2 };

    doc.packs = packs;

    const slotObj = doc.slot || { red: 0, amber: 0, green: 0, no: 0 };
    slotObj[s] = sl; // apply slot for that signal
    doc.slot = slotObj;

    doc.v = Number(doc.v || 0) + 1;
    doc.updated_at = now;

    await doc.save();

    res.json({ ok: true, v: doc.v, updated_at: doc.updated_at });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP pulls: GET /api/pull/:device_id?since=v
app.get("/api/pull/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const since = Number(req.query.since || 0);

    const doc = await ensureMsgRow(device_id);
    const v = Number(doc.v || 0);

    if (since >= v) {
      return res.json({ ok: true, changed: false, v });
    }

    res.json({
      ok: true,
      changed: true,
      device_id,
      v,
      force: doc.force || "",
      slot: doc.slot || { red: 0, amber: 0, green: 0, no: 0 },
      packs: doc.packs || defaultPacks(),
      slots: MSG_SLOTS,
      updated_at: doc.updated_at || 0,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
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
<title>Display Health Monitor</title>

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

  /* Sidebar */
  .sidebar{
    width:270px;background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);border-radius:18px;
    backdrop-filter: blur(10px);
    display:flex;flex-direction:column;padding:14px 12px;gap:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .brand{display:flex;align-items:center;gap:12px;padding:6px 6px 2px 6px}
  .brand img{width:42px;height:42px;border-radius:12px;background:#fff;object-fit:contain;padding:6px}
  .brandTitle{font-size:18px;font-weight:1100;letter-spacing:.3px}
  .brandSub{display:none}
  .divider{height:1px;background:rgba(255,255,255,.10);margin:2px 6px 0 6px}

  .tabBtn{
    width:100%;padding:14px 14px;border-radius:16px;
    display:flex;align-items:center;gap:12px;
    cursor:pointer;user-select:none;border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.04);transition:.18s ease;
  }
  .tabBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.07)}
  .tabBtn.active{
    background:linear-gradient(135deg, rgba(11,94,215,.35), rgba(255,255,255,.06));
    border-color: rgba(173,210,255,.35);
    box-shadow:0 12px 30px rgba(11,94,215,.18);
  }
  .ico{
    width:42px;height:42px;border-radius:14px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);
    display:flex;align-items:center;justify-content:center;
  }
  .ico svg{display:block}
  .tabTxtWrap{display:flex;flex-direction:column;gap:2px}
  .tabTxt{font-size:14px;font-weight:1100;letter-spacing:.4px}

  /* Main */
  .content{
    flex:1;display:flex;flex-direction:column;
    background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;backdrop-filter: blur(10px);
    overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35);
  }
  .topbar{
    height:62px;display:flex;align-items:center;justify-content:flex-end;
    padding:0 14px;border-bottom:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
    gap:10px;
  }
  .iconBtn{
    width:44px;height:44px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;transition:.18s ease;
  }
  .iconBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.09)}
  .iconBtn svg{opacity:.9}

  /* Cards moved UP */
  .cards{
    display:flex;gap:12px;
    padding:8px 12px 10px 12px;
    margin-top:-6px;
    border-bottom:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.03);
    flex-wrap:wrap;
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
  .card .k{font-size:11px;opacity:.75;font-weight:1000;letter-spacing:.8px;position:relative}
  .card .v{font-size:28px;font-weight:1100;margin-top:6px;position:relative}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1}

  /* Message panel */
  .pad{padding:14px}
  .panel{
    max-width:1050px;
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;padding:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.30);
  }
  .h1{font-weight:1100;font-size:18px}
  .hint{font-size:12px;opacity:.78;line-height:1.4;margin-top:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .lbl{font-size:12px;opacity:.78;font-weight:1000;margin-bottom:6px}
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
    font-weight:1100;transition:.15s ease;
  }
  button:hover{transform:translateY(-1px)}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  .chip{
    padding:8px 10px;border-radius:999px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.05);
    font-size:12px;font-weight:1000;opacity:.9;
    display:inline-flex;align-items:center;gap:8px;
  }
  .dot{width:10px;height:10px;border-radius:99px;background:#777}
  .dot.on{background:#2dbb4e}
  .dot.off{background:#d94141}

  @media (max-width: 980px){
    .sidebar{width:240px}
    .card{flex:1 1 160px}
    .grid{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="bg"></div>
<div class="noise"></div>

<div class="app">

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="brand">
      <img src="/image.png" alt="Arcadis" onerror="this.style.display='none'"/>
      <div>
        <div class="brandTitle">Display Health Monitor</div>
      </div>
    </div>
    <div class="divider"></div>

    <div class="tabBtn active" id="tabMapBtn" onclick="showTab('map')">
      <div class="ico">
        <!-- Map icon -->
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" stroke="white" stroke-width="2" stroke-linejoin="round"/>
          <path d="M9 3v15" stroke="white" stroke-width="2" stroke-linecap="round"/>
          <path d="M15 6v15" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="tabTxtWrap">
        <div class="tabTxt">MAP</div>
      </div>
    </div>

    <div class="tabBtn" id="tabMsgBtn" onclick="showTab('msg')">
      <div class="ico">
        <!-- ESP / chip icon -->
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="7" y="7" width="10" height="10" rx="2" stroke="white" stroke-width="2"/>
          <path d="M9 1v4M12 1v4M15 1v4M9 19v4M12 19v4M15 19v4" stroke="white" stroke-width="2" stroke-linecap="round"/>
          <path d="M1 9h4M1 12h4M1 15h4M19 9h4M19 12h4M19 15h4" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="tabTxtWrap">
        <div class="tabTxt">MESSAGES</div>
      </div>
    </div>

    <div style="margin-top:auto;opacity:.75;font-size:12px;padding:0 8px 6px 8px">
      Data: <b>/devices</b>
    </div>
  </div>

  <!-- Main content -->
  <div class="content">
    <div class="topbar">
      <div class="iconBtn" title="Refresh" onclick="loadDevices(true)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="white" stroke-width="2" stroke-linecap="round"/>
          <path d="M21 3v6h-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="iconBtn" title="Menu">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
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

    <div class="view" id="viewMsg">
      <div class="pad">
        <div class="panel">
          <div class="h1">Cloud Message Control</div>
          <div class="hint">Pick device → pick signal → pick slot → auto-fill → edit → <b>Send to ESP</b>.</div>

          <div class="grid">
            <div>
              <div class="lbl">Device</div>
              <select id="devSel"></select>
            </div>
            <div>
              <div class="lbl">Force</div>
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
              <div class="lbl">Signal group</div>
              <select id="sigSel"></select>
            </div>
            <div>
              <div class="lbl">Slot</div>
              <select id="slotSel"></select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="lbl">Line 1</div>
              <input id="line1" placeholder="Line 1"/>
            </div>
            <div>
              <div class="lbl">Line 2</div>
              <input id="line2" placeholder="Line 2"/>
            </div>
          </div>

          <div class="row">
            <button id="sendBtn" onclick="sendToESP()">Send to ESP (Cloud)</button>
          </div>

          <div class="row" style="align-items:center;gap:12px">
            <div class="chip"><span class="dot" id="dotConn"></span><span id="statusTxt">Status: Idle</span></div>
            <div class="chip">Last update: <span id="lastUpd">-</span></div>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
  // Tabs
  function showTab(which){
    document.getElementById("tabMapBtn").classList.toggle("active", which==="map");
    document.getElementById("tabMsgBtn").classList.toggle("active", which==="msg");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewMsg").classList.toggle("active", which==="msg");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // Map
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

  // Message templates (client-side only for dropdown experience)
  const templates = ${JSON.stringify(defaultPacks())};
  const SIGS = [
    {k:"red",   name:"RED → STOP"},
    {k:"amber", name:"AMBER → WAIT"},
    {k:"green", name:"GREEN → GO"},
    {k:"no",    name:"NO SIGNAL"}
  ];

  // UI elements
  const devSel = document.getElementById("devSel");
  const sigSel = document.getElementById("sigSel");
  const slotSel= document.getElementById("slotSel");
  const line1  = document.getElementById("line1");
  const line2  = document.getElementById("line2");
  const forceSel = document.getElementById("forceSel");
  const statusTxt = document.getElementById("statusTxt");
  const dotConn = document.getElementById("dotConn");
  const lastUpd = document.getElementById("lastUpd");

  function setStatus(text, ok){
    statusTxt.textContent = "Status: " + text;
    dotConn.classList.remove("on","off");
    dotConn.classList.add(ok ? "on" : "off");
  }

  function fillSigOptions(){
    sigSel.innerHTML = "";
    SIGS.forEach(s=>{
      const o = document.createElement("option");
      o.value = s.k;
      o.textContent = s.name;
      sigSel.appendChild(o);
    });
  }

  function fillSlotOptions(){
    const sig = sigSel.value;
    slotSel.innerHTML = "";
    for(let i=0;i<${MSG_SLOTS};i++){
      const o = document.createElement("option");
      o.value = String(i);
      // show preview title inside slot
      const t = templates[sig][i]?.l1 || ("Message " + (i+1));
      o.textContent = (i+1) + ". " + t;
      slotSel.appendChild(o);
    }
  }

  function autofillLines(){
    const sig = sigSel.value;
    const sl  = Number(slotSel.value||0);
    const t = (templates[sig] && templates[sig][sl]) ? templates[sig][sl] : {l1:"",l2:""};
    line1.value = t.l1 || "";
    line2.value = t.l2 || "";
  }

  sigSel.addEventListener("change", ()=>{
    fillSlotOptions();
    autofillLines();
  });
  slotSel.addEventListener("change", autofillLines);

  async function loadDevices(forceRefresh){
    try{
      const res = await fetch("/devices", { cache: forceRefresh ? "no-store" : "default" });
      const data = await res.json();

      // cards
      let on=0, off=0;
      (data||[]).forEach(d=> (d.status==="online"?on++:off++));
      document.getElementById("total").innerText = (data||[]).length;
      document.getElementById("on").innerText = on;
      document.getElementById("off").innerText = off;

      // map markers
      (data||[]).forEach(d=>{
        const isOn = (d.status==="online");
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

      // message device dropdown
      const cur = devSel.value;
      devSel.innerHTML = "";
      (data||[]).forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")";
        devSel.appendChild(opt);
      });
      if(cur) devSel.value = cur;

      setStatus("Ready", true);
    }catch(e){
      setStatus("Network error", false);
    }
  }

  async function sendToESP(){
    const device_id = devSel.value;
    if(!device_id){
      setStatus("No device selected", false);
      return;
    }

    const payload = {
      device_id,
      force: forceSel.value || "",
      sig: sigSel.value,
      slot: Number(slotSel.value||0),
      line1: line1.value || "",
      line2: line2.value || ""
    };

    setStatus("Sending...", true);

    try{
      const r = await fetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const out = await r.json();
      if(!r.ok){
        setStatus("Failed: " + (out.error||"error"), false);
        return;
      }
      lastUpd.textContent = new Date().toLocaleString();
      setStatus("Sent ✅", true);
    }catch(e){
      setStatus("Network error", false);
    }
  }

  // boot
  fillSigOptions();
  fillSlotOptions();
  autofillLines();
  loadDevices(true);
  setInterval(()=>loadDevices(false), 2000);
</script>
</body>
</html>`);
});

// ======================
// START SERVER ✅ REQUIRED FOR RENDER
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));