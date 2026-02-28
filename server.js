// server.js — FULL (Render + Mongo + Map + Messages + Sidebar Tabs)

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// Put your Arcadis logo here:
// public/arcadis.png  (recommended 400px wide PNG)
app.use(express.static("public"));

// ======================
// DATABASE
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err?.message || err));

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

const simpleSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  force: { type: String, default: "" }, // "red"|"amber"|"green"|"" (AUTO)
  signal: { type: String, default: "red" }, // group
  slot: { type: Number, default: 0 }, // 0..4
  line1: { type: String, default: "" },
  line2: { type: String, default: "" },
  v: { type: Number, default: 0 }, // increment version
  updated_at: { type: Number, default: 0 },
});

const Device = mongoose.model("Device", deviceSchema);
const Simple = mongoose.model("Simple", simpleSchema);

// ======================
// HELPERS
// ======================
const OFFLINE_AFTER_MS = 15000; // stable online/offline (no flicker)
const MSG_SLOTS = 5;

function clampSlot(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n >= MSG_SLOTS) return MSG_SLOTS - 1;
  return n;
}

async function ensureSimple(device_id) {
  return Simple.findOneAndUpdate(
    { device_id },
    {
      $setOnInsert: {
        device_id,
        force: "",
        signal: "red",
        slot: 0,
        line1: "HELLO FROM CLOUD",
        line2: "DRIVE SAFE",
        v: 0,
        updated_at: Date.now(),
      },
    },
    { upsert: true, new: true }
  );
}

async function markOfflineIfNeeded() {
  const now = Date.now();
  await Device.updateMany(
    { last_seen: { $lt: now - OFFLINE_AFTER_MS } },
    { $set: { status: "offline" } }
  );
}

// ======================
// BASIC
// ======================
app.get("/", (req, res) => res.send("Server Running ✅"));

// ======================
// ESP REGISTER (optional)
// ======================
app.post("/register", async (req, res) => {
  try {
    const { device_id, lat, lng } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });
    const now = Date.now();

    const dev = await Device.findOneAndUpdate(
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
    res.json({ ok: true, device: dev });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// HEARTBEAT (ESP calls this)
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

    await ensureSimple(device_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DEVICES JSON (dashboard uses this)
// ======================
app.get("/devices", async (req, res) => {
  try {
    await markOfflineIfNeeded();
    const list = await Device.find().sort({ last_seen: -1 });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// CLOUD MESSAGE API (simple)
// Dashboard sends -> POST /api/simple
// ESP pulls      -> GET  /api/pull/:device_id
// ======================
app.post("/api/simple", async (req, res) => {
  try {
    const { device_id, force, signal, slot, line1, line2 } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const doc = await ensureSimple(device_id);

    const sig = String(signal || doc.signal || "red");
    const sl = clampSlot(slot);
    const f = String(force || "");
    const validForce = f === "" || f === "red" || f === "amber" || f === "green";
    if (!validForce) return res.status(400).json({ error: "Invalid force" });

    doc.force = f;
    doc.signal = sig;
    doc.slot = sl;
    doc.line1 = String(line1 ?? "");
    doc.line2 = String(line2 ?? "");
    doc.v = Number(doc.v || 0) + 1;
    doc.updated_at = Date.now();
    await doc.save();

    res.json({ ok: true, v: doc.v, updated_at: doc.updated_at });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/pull/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const doc = await ensureSimple(device_id);
    res.json({
      device_id: doc.device_id,
      force: doc.force || "",
      signal: doc.signal || "red",
      slot: Number(doc.slot || 0),
      line1: doc.line1 || "",
      line2: doc.line2 || "",
      v: Number(doc.v || 0),
      updated_at: Number(doc.updated_at || 0),
      slots: MSG_SLOTS,
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
<title>IoT Monitor — Display Health Monitor</title>

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
    width:260px;min-width:260px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    backdrop-filter: blur(10px);
    box-shadow:0 18px 50px rgba(0,0,0,.35);
    padding:14px;
    display:flex;flex-direction:column;gap:14px;
  }

  .brand{display:flex;align-items:center;gap:12px}
  .brandLogo{
    width:44px;height:44px;border-radius:14px;
    background:rgba(255,255,255,.08);
    border:1px solid rgba(255,255,255,.12);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
  }
  .brandLogo img{width:100%;height:100%;object-fit:contain;padding:6px}
  .brandTitle{font-size:18px;font-weight:1000;letter-spacing:.2px}
  .brandSub{font-size:12px;opacity:.75;margin-top:3px}
  .sep{height:1px;background:rgba(255,255,255,.10);margin:4px 0}

  .tabBtn{
    width:100%;
    display:flex;align-items:center;gap:12px;
    padding:14px;border-radius:16px;
    border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.04);
    cursor:pointer;user-select:none;
    transition:.16s ease;
  }
  .tabBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.07)}
  .tabBtn.active{
    background:linear-gradient(135deg, rgba(11,94,215,.35), rgba(255,255,255,.06));
    border-color: rgba(173,210,255,.35);
    box-shadow:0 12px 30px rgba(11,94,215,.18);
  }
  .ico{
    width:40px;height:40px;border-radius:14px;
    display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);
    font-size:18px;
  }
  .tabTxt{font-weight:1000}
  .tabTxt small{display:none}

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
    height:62px;display:flex;align-items:center;justify-content:flex-end;
    padding:0 12px;border-bottom:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
    gap:10px;
  }
  .iconBtn{
    width:44px;height:44px;border-radius:16px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;transition:.16s ease;
  }
  .iconBtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.09)}
  .iconBtn svg{opacity:.92}

  .cards{
    display:flex;gap:12px;padding:12px;
    border-bottom:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.03);
    flex-wrap:wrap;
  }
  .card{
    flex:0 0 260px;
    border-radius:16px;border:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    padding:12px 12px;box-shadow:0 14px 34px rgba(0,0,0,.25);
    position:relative;overflow:hidden;
  }
  .card:before{
    content:"";position:absolute;inset:-2px;
    background:radial-gradient(300px 100px at 20% 0%, rgba(255,255,255,.15), transparent 60%);
    opacity:.7;
  }
  .k{font-size:11px;opacity:.75;font-weight:1000;letter-spacing:.8px;position:relative}
  .v{font-size:28px;font-weight:1100;margin-top:6px;position:relative}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1}

  .wrap{padding:14px;max-width:1100px}
  .panel{
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;padding:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.30);
  }
  .title{font-weight:1100;font-size:18px}
  .hint{font-size:12px;opacity:.75;line-height:1.35;margin-top:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center}

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
  .statusLine{margin-top:10px;font-weight:900;opacity:.9}

  @media (max-width: 980px){
    .sidebar{width:220px;min-width:220px}
    .card{flex:1 1 160px}
    .grid{grid-template-columns:1fr}
  }
  @media (max-width: 760px){
    .sidebar{display:none}
    .app{padding:8px}
  }
</style>
</head>

<body>
<div class="bg"></div>
<div class="noise"></div>

<div class="app">

  <aside class="sidebar">
    <div class="brand">
      <div class="brandLogo">
        <img src="/arcadis.png" alt="Arcadis" onerror="this.style.display='none'"/>
      </div>
      <div>
        <div class="brandTitle">IoT Monitor</div>
        <div class="brandSub">Display Health Monitor</div>
      </div>
    </div>

    <div class="sep"></div>

    <div class="tabBtn active" id="tabMapBtn" onclick="showTab('map')">
      <div class="ico">🗺️</div>
      <div class="tabTxt">MAP</div>
    </div>

    <div class="tabBtn" id="tabMsgBtn" onclick="showTab('msg')">
      <div class="ico">💬</div>
      <div class="tabTxt">MESSAGES</div>
    </div>

    <div style="margin-top:auto;opacity:.7;font-size:12px">
      Data: <span style="font-weight:900">/devices</span>
    </div>
  </aside>

  <main class="content">
    <div class="topbar">
      <div class="iconBtn" title="Refresh" onclick="loadDevices(true)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="white" stroke-width="2" stroke-linecap="round"/>
          <path d="M21 3v6h-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="iconBtn" title="Open /devices JSON" onclick="window.open('/devices','_blank')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M7 7h10M7 12h10M7 17h10" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
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

    <section class="view" id="viewMsg">
      <div class="wrap">
        <div class="panel">
          <div class="title">Cloud Message Control</div>
          <div class="hint">Pick device → pick signal → pick slot (auto-lines) → click Send.</div>

          <div class="grid">
            <div>
              <div class="hint">Device</div>
              <select id="deviceSel"></select>
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
              <input id="line1" />
            </div>
            <div>
              <div class="hint">Line 2</div>
              <input id="line2" />
            </div>
          </div>

          <div class="row">
            <button id="sendBtn" onclick="sendToCloud()">Send to ESP (Cloud)</button>
          </div>

          <div class="statusLine" id="sendStatus">Status: Idle</div>
          <div class="hint" style="margin-top:6px">ESP pulls from: <b>/api/pull/&lt;device_id&gt;</b></div>
        </div>
      </div>
    </section>

  </main>
</div>

<script>
  // ---------- tabs ----------
  function showTab(which){
    document.getElementById("tabMapBtn").classList.toggle("active", which==="map");
    document.getElementById("tabMsgBtn").classList.toggle("active", which==="msg");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewMsg").classList.toggle("active", which==="msg");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // ---------- map ----------
  const map = L.map('map').setView([17.3850,78.4867], 12);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'], maxZoom: 20
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

  // ---------- message presets ----------
  const PRESETS = {
    red: [
      ["MINUTE OF PATIENCE. LIFETIME OF SAFETY.", "HIT THE BRAKE, NOT REGRET."],
      ["STOP NOW. LIVE MORE.", "DON'T RUSH YOUR FUTURE."],
      ["RED MEANS RULES.", "RULES MEAN LIFE."],
      ["STOP HERE. START LIVING.", "ONE LIGHT. MANY LIVES."],
      ["BRAKE FIRST.", "REGRET NEVER."],
    ],
    amber: [
      ["SLOW DOWN.", "ARRIVE ALIVE."],
      ["EASE UP.", "RISK IS NOT WORTH IT."],
      ["PAUSE THE SPEED.", "SAVE A LIFE."],
      ["WAIT SMART.", "STAY SAFE."],
      ["HOLD ON.", "SAFETY FIRST."],
    ],
    green: [
      ["GO — BUT STAY ALERT.", "SAFE DISTANCE ALWAYS."],
      ["GO SMART, NOT FAST.", "KEEP YOUR LANE."],
      ["REACH HOME, NOT HEADLINES.", "WATCH FOR PEDESTRIANS."],
      ["MOVE WITH CARE.", "NO RACING."],
      ["STAY CALM.", "DRIVE DEFENSIVE."],
    ],
    no: [
      ["SIGNAL OFF.", "GIVE WAY. GO SLOW."],
      ["WEAR HELMET.", "WEAR SEAT BELT."],
      ["SLOW & SAFE.", "IS THE RULE."],
      ["BE PATIENT.", "LET OTHERS PASS."],
      ["NO SIGNAL.", "FOLLOW RULES."],
    ]
  };

  function niceSignalName(sig){
    if(sig==="red") return "RED → STOP";
    if(sig==="amber") return "AMBER → WAIT";
    if(sig==="green") return "GREEN → GO";
    return "NO SIGNAL";
  }

  function rebuildMsgUI(){
    const sigSel = document.getElementById("sigSel");
    const slotSel = document.getElementById("slotSel");

    sigSel.innerHTML = "";
    ["red","amber","green","no"].forEach(s=>{
      const o=document.createElement("option");
      o.value=s; o.textContent=niceSignalName(s);
      sigSel.appendChild(o);
    });

    function rebuildSlots(){
      const sig = sigSel.value;
      const arr = PRESETS[sig] || [];
      slotSel.innerHTML = "";
      for(let i=0;i<arr.length;i++){
        const o=document.createElement("option");
        o.value=String(i);
        o.textContent = "Message " + (i+1);
        slotSel.appendChild(o);
      }
      slotSel.value = "0";
      applyPresetToLines();
    }

    function applyPresetToLines(){
      const sig = sigSel.value;
      const slot = Number(slotSel.value||0);
      const arr = PRESETS[sig] || [];
      const pair = arr[slot] || ["",""];
      document.getElementById("line1").value = pair[0];
      document.getElementById("line2").value = pair[1];
    }

    sigSel.addEventListener("change", rebuildSlots);
    slotSel.addEventListener("change", applyPresetToLines);

    rebuildSlots();
  }

  // ---------- devices + map refresh ----------
  async function loadDevices(force){
    try{
      const res = await fetch("/devices", { cache: "no-store" });
      const data = await res.json();

      // counts
      let on=0, off=0;
      (data||[]).forEach(d=>{
        if(d.status==="online") on++; else off++;
      });
      document.getElementById("total").innerText = (data||[]).length;
      document.getElementById("on").innerText = on;
      document.getElementById("off").innerText = off;

      // dropdown
      const sel = document.getElementById("deviceSel");
      const cur = sel.value;
      sel.innerHTML = "";
      (data||[]).forEach(d=>{
        const opt=document.createElement("option");
        opt.value=d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")";
        sel.appendChild(opt);
      });
      if(cur) sel.value = cur;
      if(!sel.value && sel.options.length) sel.value = sel.options[0].value;

      // markers
      (data||[]).forEach(d=>{
        const pos=[d.lat||0,d.lng||0];
        const icon=pinIcon(d.status);
        const isOn = d.status==="online";
        const pop =
          "<b>"+d.device_id+"</b>" +
          "<br>Status: <b style='color:"+(isOn?"#2dbb4e":"#d94141")+"'>"+d.status+"</b>" +
          "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

        if(markers.has(d.device_id)){
          markers.get(d.device_id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
        }else{
          const m=L.marker(pos,{icon}).addTo(map).bindPopup(pop);
          markers.set(d.device_id,m);
        }
      });

    }catch(e){
      console.log(e);
    }
  }
  setInterval(loadDevices, 2000);

  // ---------- send to cloud (NO auto send) ----------
  async function sendToCloud(){
    const device_id = document.getElementById("deviceSel").value;
    if(!device_id){
      document.getElementById("sendStatus").textContent = "Status: No device";
      return;
    }
    const force = document.getElementById("forceSel").value;
    const signal = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value||0);
    const line1 = document.getElementById("line1").value || "";
    const line2 = document.getElementById("line2").value || "";

    const st = document.getElementById("sendStatus");
    st.textContent = "Status: Sending...";
    try{
      const r = await fetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ device_id, force, signal, slot, line1, line2 })
      });
      const out = await r.json();
      if(r.ok){
        st.textContent = "Status: Sent ✅ (v=" + out.v + ")";
      }else{
        st.textContent = "Status: Failed ❌ " + (out.error||"");
      }
    }catch(e){
      st.textContent = "Status: Network error ❌";
    }
  }

  // boot
  rebuildMsgUI();
  loadDevices(true);
</script>
</body>
</html>`);
});

// ======================
// START SERVER (Render needs this)
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));