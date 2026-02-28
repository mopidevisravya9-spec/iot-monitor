const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve static files from /public
// Put logo at: public/image.png
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

const MSG_SLOTS = 5; // keep same as ESP (change to 10 if you also change ESP)

function defaultMessages() {
  // signals: red, amber, green, no
  const base = (arr) => arr.map(([l1, l2]) => ({ l1, l2 }));
  return {
    red: base([
      ["MINUTE OF PATIENCE A LIFETIME OF SAFETY", "HIT THE BRAKE, NOT REGRET"],
      ["STOP NOW, LIVE MORE", "DON'T RUSH YOUR FUTURE"],
      ["RED MEANS RULES", "RULES MEAN LIFE"],
      ["STOP HERE, START LIVING", "ONE LIGHT, MANY LIVES"],
      ["BRAKE FIRST", "REGRET NEVER"],
    ]),
    amber: base([
      ["SPEED THRILLS BUT IT KILLS", "CALM YOUR ACCELERATOR"],
      ["SLOW DOWN, STAY AROUND", "EASE UP BEFORE IT'S TOO LATE"],
      ["WAIT SMART", "RISK IS NOT WORTH IT"],
      ["HOLD ON", "SAFETY GOES FIRST"],
      ["PAUSE THE SPEED", "SAVE A LIFE"],
    ]),
    green: base([
      ["REACH HOME, NOT HEADLINES", "GO SMART, NOT FAST"],
      ["GO, BUT DON'T GAMBLE", "STAY ALERT, STAY ALIVE"],
      ["SAFE DRIVE = SAFE ARRIVAL", "KEEP DISTANCE, KEEP LIFE"],
      ["GO WITH CARE", "NOT WITH RAGE"],
      ["GREEN MEANS MOVE", "NOT RACE"],
    ]),
    no: base([
      ["WEAR HELMET", "WEAR SEAT BELT"],
      ["SIGNAL OFF - DRIVE SLOW", "FOLLOW RULES ALWAYS"],
      ["STAY CALM", "DRIVE CAREFULLY"],
      ["NO SIGNAL", "GIVE WAY"],
      ["SLOW & SAFE", "IS THE RULE"],
    ]),
  };
}

const commandSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },

  // force: "red" | "amber" | "green" | ""
  force: { type: String, default: "" },

  // active slot per signal
  active: {
    red: { type: Number, default: 0 },
    amber: { type: Number, default: 0 },
    green: { type: Number, default: 0 },
    no: { type: Number, default: 0 },
  },

  // messages per signal (slots)
  messages: {
    red: { type: Array, default: () => defaultMessages().red },
    amber: { type: Array, default: () => defaultMessages().amber },
    green: { type: Array, default: () => defaultMessages().green },
    no: { type: Array, default: () => defaultMessages().no },
  },

  updated_at: { type: Number, default: 0 },
});

const Device = mongoose.model("Device", deviceSchema);
const Command = mongoose.model("Command", commandSchema);

// ======================
// SIMPLE ADMIN AUTH
// ======================
// header: x-admin-user: admin
// header: x-admin-pass: admin123
function requireAdmin(req, res, next) {
  const u = req.headers["x-admin-user"];
  const p = req.headers["x-admin-pass"];
  if (u === "admin" && p === "admin123") return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// HELPERS
// ======================
async function ensureCommandRow(device_id) {
  return Command.findOneAndUpdate(
    { device_id },
    {
      $setOnInsert: {
        device_id,
        force: "",
        active: { red: 0, amber: 0, green: 0, no: 0 },
        messages: defaultMessages(),
        updated_at: 0,
      },
    },
    { upsert: true, new: true }
  );
}

function clampSlot(n) {
  const x = Number.isFinite(n) ? n : 0;
  if (x < 0) return 0;
  if (x >= MSG_SLOTS) return MSG_SLOTS - 1;
  return x;
}

function fixSlots(arr) {
  // ensure exactly MSG_SLOTS items
  const safe = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let i = 0; i < MSG_SLOTS; i++) {
    const it = safe[i] || {};
    out.push({
      l1: String(it.l1 || ""),
      l2: String(it.l2 || ""),
    });
  }
  return out;
}

// ======================
// HOME
// ======================
app.get("/", (req, res) => res.send("Server Running"));

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

    await ensureCommandRow(device_id);
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

    await ensureCommandRow(device_id);

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
// CONFIG API (for ESP + dashboard)
// ESP reads: GET /api/config/:device_id   (no auth)
// Dashboard writes: POST /api/config      (admin)
// ======================

// ESP reads full config
app.get("/api/config/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const doc = await ensureCommandRow(device_id);
    res.json({
      device_id: doc.device_id,
      force: doc.force || "",
      active: doc.active || { red: 0, amber: 0, green: 0, no: 0 },
      messages: doc.messages || defaultMessages(),
      updated_at: doc.updated_at || 0,
      slots: MSG_SLOTS,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Dashboard updates: save slot OR apply OR force
app.post("/api/config", requireAdmin, async (req, res) => {
  try {
    const { device_id, action } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const doc = await ensureCommandRow(device_id);
    const now = Date.now();

    const signals = ["red", "amber", "green", "no"];

    if (action === "force") {
      const force = String(req.body.force || "");
      const ok = force === "" || signals.includes(force);
      if (!ok) return res.status(400).json({ error: "invalid force" });

      doc.force = force;
      doc.updated_at = now;
      await doc.save();
      return res.json({ message: "Force updated", config: doc });
    }

    if (action === "save_slot") {
      const sig = String(req.body.sig || "red");
      const slot = clampSlot(Number(req.body.slot || 0));
      if (!signals.includes(sig)) return res.status(400).json({ error: "invalid sig" });

      const l1 = String(req.body.l1 || "");
      const l2 = String(req.body.l2 || "");

      const msgs = doc.messages || defaultMessages();
      msgs[sig] = fixSlots(msgs[sig]);
      msgs[sig][slot] = { l1, l2 };
      doc.messages = msgs;
      doc.updated_at = now;
      await doc.save();
      return res.json({ message: "Slot saved", config: doc });
    }

    if (action === "apply_slot") {
      const sig = String(req.body.sig || "red");
      const slot = clampSlot(Number(req.body.slot || 0));
      if (!signals.includes(sig)) return res.status(400).json({ error: "invalid sig" });

      const a = doc.active || { red: 0, amber: 0, green: 0, no: 0 };
      a[sig] = slot;
      doc.active = a;
      doc.updated_at = now;
      await doc.save();
      return res.json({ message: "Slot applied", config: doc });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DASHBOARD PAGE (Map + Control + Display UI tab)
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
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

  .app{height:100%;display:flex}
  .sidebar{
    width:240px;background:#ffffff;border-right:1px solid #e6e8ee;
    display:flex;flex-direction:column;gap:8px;padding:12px;
  }
  .logoTop{display:flex;align-items:center;gap:10px;padding:6px 6px 12px 6px;border-bottom:1px solid #eef0f6}
  .logoTop img{height:34px}
  .logoTop .t1{font-weight:900;letter-spacing:.5px}
  .logoTop .t2{font-size:12px;color:#6b7280;margin-top:2px}

  .navbtn{
    display:flex;align-items:center;gap:10px;
    padding:10px 12px;border-radius:10px;cursor:pointer;user-select:none;
    border:1px solid transparent;font-weight:700;color:#111827;
  }
  .navbtn.active{background:#eef6ff;border-color:#cfe5ff;color:#0b5ed7}
  .navbtn:hover{background:#f6f7fb}

  .content{flex:1;display:flex;flex-direction:column}
  .topbar{
    height:58px;background:#ffffff;border-bottom:1px solid #e6e8ee;
    display:flex;align-items:center;justify-content:space-between;padding:0 14px;
  }
  .title{font-weight:900}
  .logout{padding:8px 12px;border-radius:10px;border:1px solid #e6e8ee;background:#fff;cursor:pointer;font-weight:800}

  .cards{display:flex;gap:12px;padding:12px;background:#ffffff;border-bottom:1px solid #e6e8ee;flex-wrap:wrap}
  .card{flex:0 0 210px;background:#f8fafc;border:1px solid #e6e8ee;border-radius:12px;padding:10px 12px}
  .card .k{font-size:12px;color:#6b7280;font-weight:800}
  .card .v{font-size:26px;font-weight:900;margin-top:4px}

  #map{flex:1}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}

  .ctlwrap{padding:14px;max-width:980px}
  .panel{background:#ffffff;border:1px solid #e6e8ee;border-radius:14px;padding:14px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .grid1{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
  input,select,button{
    width:100%;padding:12px;border-radius:12px;border:1px solid #e6e8ee;outline:none;font-size:14px;
  }
  button{background:#0b5ed7;color:#fff;border-color:#0b5ed7;font-weight:900;cursor:pointer}
  .hint{font-size:12px;color:#6b7280}
  .mini{font-size:12px;color:#111827;font-weight:800}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .btnSmall{width:auto;padding:10px 12px;border-radius:12px;border:1px solid #e6e8ee;background:#fff;color:#111827;cursor:pointer;font-weight:900}
  .btnRed{background:#d94141;border-color:#d94141;color:#fff}
  .btnAmb{background:#d08b19;border-color:#d08b19;color:#fff}
  .btnGrn{background:#2dbb4e;border-color:#2dbb4e;color:#fff}
  .btnGry{background:#111827;border-color:#111827;color:#fff}

  .watermark{
    position:fixed;left:10px;bottom:10px;background:rgba(255,255,255,.9);
    border:1px solid #e6e8ee;border-radius:12px;padding:8px 10px;display:flex;align-items:center;gap:10px;
    box-shadow:0 10px 20px rgba(0,0,0,.08);z-index:9999;
  }
  .watermark img{height:26px}
  .watermark .p{font-size:12px;font-weight:900;color:#111827}
  .watermark .s{font-size:11px;color:#6b7280;margin-top:1px}

  .loginOverlay{
    position:fixed;inset:0;background:linear-gradient(135deg,#0b5ed7,#061a3a);
    display:flex;align-items:center;justify-content:center;z-index:10000;
  }
  .loginCard{
    width:min(420px,92vw);background:rgba(255,255,255,.96);
    border-radius:18px;border:1px solid rgba(255,255,255,.5);
    padding:18px;box-shadow:0 30px 60px rgba(0,0,0,.35);animation:pop .35s ease;
  }
  @keyframes pop{from{transform:scale(.96);opacity:.5}to{transform:scale(1);opacity:1}}
  .loginTop{display:flex;align-items:center;gap:12px}
  .loginTop img{height:34px}
  .loginTop .h{font-size:18px;font-weight:1000}
  .err{color:#b91c1c;font-size:12px;font-weight:800;margin-top:8px;display:none}

  .ok{color:#2dbb4e;font-weight:900}
  .bad{color:#d94141;font-weight:900}
</style>
</head>

<body>

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
    <div class="navbtn" id="navEsp" onclick="showTab('esp')">🖥️ Display UI</div>
  </div>

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

    <!-- CONTROL (basic) -->
    <div class="view" id="viewCtl">
      <div class="ctlwrap">
        <div class="panel">
          <div style="font-weight:1000;font-size:16px">Remote Control (Cloud)</div>
          <div class="hint" style="margin-top:6px">
            Browser → Server → ESP fetches config → Display updates.
          </div>

          <div class="grid">
            <div>
              <div class="hint">Device</div>
              <select id="deviceSelect"></select>
            </div>
            <div>
              <div class="hint">Force Signal (optional)</div>
              <select id="basicForce">
                <option value="">No Force</option>
                <option value="red">Force RED</option>
                <option value="amber">Force AMBER</option>
                <option value="green">Force GREEN</option>
              </select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Command status</div>
              <input id="statusBox" readonly value="Idle"/>
            </div>
            <div>
              <div class="hint">Apply Force</div>
              <button onclick="sendForceBasic()">Send Force</button>
            </div>
          </div>

          <div class="hint" style="margin-top:10px">
            For full “ESP-style” message slots UI, open <b>Display UI</b> tab.
          </div>
        </div>
      </div>
    </div>

    <!-- DISPLAY UI (ESP browser same workflow) -->
    <div class="view" id="viewEsp">
      <div class="ctlwrap">
        <div class="panel">
          <div style="font-weight:1000;font-size:16px">Display UI (Same as ESP Web)</div>
          <div class="hint" style="margin-top:6px">
            Signal → Message Slot → Edit lines → Save → Apply ACTIVE. Plus Force buttons.
          </div>

          <div class="grid">
            <div>
              <div class="hint">Device</div>
              <select id="espDevice" onchange="loadConfigToUI()"></select>
            </div>
            <div>
              <div class="hint">Cloud Status</div>
              <input id="espCloud" readonly value="-" />
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Select Signal</div>
              <select id="sigSel" onchange="refreshSlotDropdown(true)">
                <option value="red">RED → STOP</option>
                <option value="amber">AMBER → WAIT</option>
                <option value="green">GREEN → GO</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <div class="hint">Select Message</div>
              <select id="slotSel" onchange="loadSlotLines()"></select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Message Line 1</div>
              <input id="line1" placeholder="Enter message line 1" />
            </div>
            <div>
              <div class="hint">Message Line 2</div>
              <input id="line2" placeholder="Enter message line 2" />
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Save Slot</div>
              <button onclick="saveSlot()">Save</button>
            </div>
            <div>
              <div class="hint">Apply Slot as ACTIVE</div>
              <button onclick="applySlot()">Apply ACTIVE</button>
            </div>
          </div>

          <div style="margin-top:12px" class="mini">Force Signal</div>
          <div class="row" style="margin-top:8px">
            <button class="btnSmall btnRed" onclick="forceNow('red')">RED</button>
            <button class="btnSmall btnAmb" onclick="forceNow('amber')">AMBER</button>
            <button class="btnSmall btnGrn" onclick="forceNow('green')">GREEN</button>
            <button class="btnSmall btnGry" onclick="forceNow('')">AUTO</button>
          </div>

          <div class="grid" style="margin-top:12px">
            <div>
              <div class="hint">Active Slot (this signal)</div>
              <input id="activeInfo" readonly value="-" />
            </div>
            <div>
              <div class="hint">Action Status</div>
              <input id="espStatus" readonly value="Idle" />
            </div>
          </div>

          <div class="hint" style="margin-top:10px">
            Note: This tab edits the same data the ESP will fetch from <b>/api/config/:device_id</b>.
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

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
    document.getElementById("navEsp").classList.toggle("active", which==="esp");

    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewCtl").classList.toggle("active", which==="ctl");
    document.getElementById("viewEsp").classList.toggle("active", which==="esp");

    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
    if(which==="esp"){ setTimeout(loadConfigToUI, 0); }
  }

  // ===== MAP =====
  const map = L.map('map').setView([17.3850,78.4867], 12);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  function pinIcon(status){
    const isOn = (status === "online");
    const fill = isOn ? "#2dbb4e" : "#d94141";
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

  // dropdowns share same device list
  async function loadDevices(){
    try{
      const res = await fetch('/devices');
      const data = await res.json();

      const sel1 = document.getElementById("deviceSelect");
      const sel2 = document.getElementById("espDevice");
      const cur1 = sel1.value, cur2 = sel2.value;

      sel1.innerHTML = ""; sel2.innerHTML = "";
      (data||[]).forEach(d=>{
        const label = d.device_id + " (" + d.status + ")";
        const o1 = document.createElement("option"); o1.value=d.device_id; o1.textContent=label; sel1.appendChild(o1);
        const o2 = document.createElement("option"); o2.value=d.device_id; o2.textContent=label; sel2.appendChild(o2);
      });

      if(cur1) sel1.value = cur1;
      if(cur2) sel2.value = cur2;

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
  setInterval(loadDevices, 1000);

  // ===== BASIC FORCE (Control tab) =====
  async function sendForceBasic(){
    const device_id = document.getElementById("deviceSelect").value;
    const force = document.getElementById("basicForce").value;
    const statusBox = document.getElementById("statusBox");
    statusBox.value = "Sending...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"force", force })
      });
      const out = await res.json();
      statusBox.value = res.ok ? "Sent ✅" : ("Failed ❌ " + (out.error||""));
    }catch(e){
      statusBox.value = "Error ❌";
    }
  }

  // ===== DISPLAY UI TAB =====
  let cachedConfig = null;

  async function loadConfigToUI(){
    const device_id = document.getElementById("espDevice").value;
    if(!device_id) return;
    document.getElementById("espStatus").value = "Loading...";
    try{
      const res = await fetch("/api/config/" + encodeURIComponent(device_id));
      const cfg = await res.json();
      cachedConfig = cfg;

      document.getElementById("espCloud").value =
        (cfg && cfg.updated_at>=0) ? ("Config OK | slots=" + (cfg.slots||"-")) : "-";

      refreshSlotDropdown(false);
      document.getElementById("espStatus").value = "Ready ✅";
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }

  function refreshSlotDropdown(resetSlot){
    if(!cachedConfig) return;
    const sig = document.getElementById("sigSel").value;
    const slotSel = document.getElementById("slotSel");

    const msgs = (cachedConfig.messages && cachedConfig.messages[sig]) ? cachedConfig.messages[sig] : [];
    const active = (cachedConfig.active && Number.isFinite(cachedConfig.active[sig])) ? cachedConfig.active[sig] : 0;

    let cur = slotSel.value;
    if(resetSlot) cur = "0";

    slotSel.innerHTML = "";
    const slots = cachedConfig.slots || msgs.length || 5;

    for(let i=0;i<slots;i++){
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "Message " + (i+1) + (i===active ? " (ACTIVE)" : "");
      slotSel.appendChild(opt);
    }
    slotSel.value = cur || "0";

    document.getElementById("activeInfo").value = "Message " + (active+1);
    loadSlotLines();
  }

  function loadSlotLines(){
    if(!cachedConfig) return;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);

    const arr = (cachedConfig.messages && cachedConfig.messages[sig]) ? cachedConfig.messages[sig] : [];
    const it = arr[slot] || { l1:"", l2:"" };

    document.getElementById("line1").value = it.l1 || "";
    document.getElementById("line2").value = it.l2 || "";
  }

  async function saveSlot(){
    const device_id = document.getElementById("espDevice").value;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);
    const l1 = document.getElementById("line1").value || "";
    const l2 = document.getElementById("line2").value || "";

    document.getElementById("espStatus").value = "Saving...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"save_slot", sig, slot, l1, l2 })
      });
      const out = await res.json();
      if(res.ok){
        cachedConfig = out.config;
        document.getElementById("espStatus").value = "Saved ✅";
        refreshSlotDropdown(false);
      }else{
        document.getElementById("espStatus").value = "Failed ❌ " + (out.error||"");
      }
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }

  async function applySlot(){
    const device_id = document.getElementById("espDevice").value;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);

    document.getElementById("espStatus").value = "Applying...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"apply_slot", sig, slot })
      });
      const out = await res.json();
      if(res.ok){
        cachedConfig = out.config;
        document.getElementById("espStatus").value = "Applied ✅";
        refreshSlotDropdown(false);
      }else{
        document.getElementById("espStatus").value = "Failed ❌ " + (out.error||"");
      }
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }

  async function forceNow(force){
    const device_id = document.getElementById("espDevice").value;
    document.getElementById("espStatus").value = "Forcing...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"force", force })
      });
      const out = await res.json();
      if(res.ok){
        cachedConfig = out.config;
        document.getElementById("espStatus").value = (force?("Forced " + force.toUpperCase() + " ✅"):"AUTO ✅");
        refreshSlotDropdown(false);
      }else{
        document.getElementById("espStatus").value = "Failed ❌ " + (out.error||"");
      }
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }
</script>

</body>
</html>`);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));