// server.js ✅ FULL (LIGHT THEME ORANGE+WHITE + TIMES NEW ROMAN + NO TOP ICONS + NO TAB ICONS + POWERED BY ARCADIS + LOGO FALLBACKS)
// Put Arcadis logo in: public/arcadis.png  (fallbacks: public/image.png, public/logo.png)

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves /arcadis.png, /image.png, /logo.png etc.

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
const OFFLINE_AFTER_MS = 30000; // 30s window
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
  force: { type: String, default: "" }, // "" | red | amber | green
  slot: {
    red: { type: Number, default: 0 },
    amber: { type: Number, default: 0 },
    green: { type: Number, default: 0 },
    no: { type: Number, default: 0 },
  },
  packs: {
    red: { type: Array, default: () => defaultPacks().red },
    amber: { type: Array, default: () => defaultPacks().amber },
    green: { type: Array, default: () => defaultPacks().green },
    no: { type: Array, default: () => defaultPacks().no },
  },
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
// CLOUD MESSAGE API
// ======================
// POST /api/simple  {device_id, force, sig, slot, line1, line2}
app.post("/api/simple", async (req, res) => {
  try {
    const { device_id, force, sig, slot, line1, line2 } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const doc = await ensureMsgRow(device_id);
    const now = Date.now();

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
    slotObj[s] = sl;
    doc.slot = slotObj;

    // bump version so ESP sees "changed"
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

    if (since >= v) return res.json({ ok: true, changed: false, v });

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
// DASHBOARD ✅ (LIGHT ORANGE+WHITE + TIMES NEW ROMAN + LEFT TABS TEXT ONLY + NO TOP ICONS + POWERED BY ARCADIS + LOGO FALLBACKS)
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
  html,body{height:100%;margin:0;font-family:"Times New Roman", Times, serif;background:#fff;overflow:hidden;color:#111827}

  :root{
    --orange:#f97316;
    --orange2:#fb923c;
    --bg:#fff7ed;        /* light orange background */
    --card:#ffffff;
    --border:#fed7aa;    /* soft orange border */
    --muted:#6b7280;
  }

  .app{height:100%;display:flex;gap:12px;padding:12px;background:var(--bg)}

  /* SIDEBAR */
  .sidebar{
    width:260px;min-width:260px;
    background:var(--card);
    border:1px solid var(--border);
    border-radius:16px;
    display:flex;flex-direction:column;
    padding:14px 12px;
    box-shadow:0 10px 26px rgba(17,24,39,.08);
  }
  .brand{display:flex;align-items:center;gap:10px;padding:6px 6px 10px 6px}
  .brand img{
    width:46px;height:46px;border-radius:12px;
    background:#fff;object-fit:contain;padding:6px;
    border:1px solid var(--border)
  }
  .brandTitle{font-size:16px;font-weight:700}
  .brandSub{font-size:12px;color:var(--muted);margin-top:2px}
  .divider{height:1px;background:var(--border);margin:8px 6px}

  .tabBtn{
    width:100%;
    padding:14px 14px;
    border-radius:14px;
    cursor:pointer;
    user-select:none;
    border:1px solid var(--border);
    background:#fff;
    font-weight:700;
    letter-spacing:.5px;
    transition:.12s ease;
  }
  .tabBtn + .tabBtn{margin-top:10px}
  .tabBtn:hover{transform:translateY(-1px)}
  .tabBtn.active{
    background:linear-gradient(135deg, var(--orange), var(--orange2));
    color:#fff;
    border-color:var(--orange2);
    box-shadow:0 10px 22px rgba(249,115,22,.25);
  }

  .footer{
    margin-top:auto;
    padding:10px 10px 4px 10px;
    font-size:12px;
    color:var(--muted);
  }

  /* MAIN */
  .content{
    flex:1;
    display:flex;
    flex-direction:column;
    background:var(--card);
    border:1px solid var(--border);
    border-radius:16px;
    overflow:hidden;
    box-shadow:0 10px 26px rgba(17,24,39,.08);
  }

  /* CARDS (moved up already; tight spacing) */
  .cards{
    display:flex;gap:10px;
    padding:10px;
    border-bottom:1px solid var(--border);
    background:#fff;
    flex-wrap:wrap;
  }
  .card{
    flex:0 0 240px;
    border:1px solid var(--border);
    border-radius:14px;
    background:#fff;
    padding:10px 12px;
  }
  .card .k{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.6px}
  .card .v{font-size:22px;font-weight:700;margin-top:6px}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1}

  /* MESSAGES PANEL */
  .pad{padding:12px}
  .panel{
    max-width:1050px;
    border:1px solid var(--border);
    border-radius:16px;
    padding:14px;
    background:#fff;
  }
  .h1{font-weight:700;font-size:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
  .lbl{font-size:12px;color:var(--muted);font-weight:700;margin-bottom:6px}

  input,select,button{
    width:100%;
    padding:11px;
    border-radius:12px;
    border:1px solid var(--border);
    background:#fff;
    color:#111827;
    outline:none;
    font-size:14px;
    font-family:"Times New Roman", Times, serif;
  }
  button{
    cursor:pointer;
    background:linear-gradient(135deg, var(--orange), var(--orange2));
    border-color:var(--orange2);
    color:#fff;
    font-weight:700;
  }
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}

  .statusLine{
    margin-top:10px;
    font-size:12px;
    color:var(--muted);
    font-weight:700;
  }
  .ok{color:#16a34a}
  .bad{color:#dc2626}

  @media (max-width: 980px){
    .sidebar{width:220px;min-width:220px}
    .card{flex:1 1 160px}
    .grid{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="app">

  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="brand">
      <img id="arcLogo" src="/arcadis.png" alt="Arcadis"
        onerror="this.onerror=null; this.src='/image.png';"
      />
      <div>
        <div class="brandTitle">Display Health Monitor</div>
        <div class="brandSub">Arcadis Operations</div>
      </div>
    </div>
    <div class="divider"></div>

    <div class="tabBtn active" id="tabMapBtn" onclick="showTab('map')">MAP</div>
    <div class="tabBtn" id="tabMsgBtn" onclick="showTab('msg')">MESSAGES</div>

    <div class="footer">Powered by <b>Arcadis</b></div>
  </div>

  <!-- MAIN CONTENT -->
  <div class="content">

    <!-- CARDS -->
    <div class="cards">
      <div class="card"><div class="k">TOTAL DEVICES</div><div class="v" id="total">0</div></div>
      <div class="card"><div class="k">ONLINE</div><div class="v" id="on">0</div></div>
      <div class="card"><div class="k">OFFLINE</div><div class="v" id="off">0</div></div>
    </div>

    <!-- MAP VIEW -->
    <div class="view active" id="viewMap"><div id="map"></div></div>

    <!-- MESSAGE VIEW -->
    <div class="view" id="viewMsg">
      <div class="pad">
        <div class="panel">
          <div class="h1">Cloud Message Control</div>

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
            <button onclick="sendToESP()">Send to ESP</button>
          </div>

          <div class="statusLine" id="statusTxt">Status: Idle</div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
  function showTab(which){
    document.getElementById("tabMapBtn").classList.toggle("active", which==="map");
    document.getElementById("tabMsgBtn").classList.toggle("active", which==="msg");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewMsg").classList.toggle("active", which==="msg");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 150); }
  }

  // Map (Google tiles like you had)
  const map = L.map('map').setView([17.3850,78.4867], 12);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();
  function pinIcon(status){
    const isOn = (status === "online");
    const fill = isOn ? "#16a34a" : "#dc2626";
    const html = \`
      <div style="width:28px;height:28px;transform:translate(-14px,-28px);">
        <svg width="28" height="28" viewBox="0 0 64 64">
          <path d="M32 2C20 2 10.5 11.6 10.5 23.5 10.5 40.5 32 62 32 62S53.5 40.5 53.5 23.5C53.5 11.6 44 2 32 2Z"
                fill="\${fill}" stroke="white" stroke-width="4"/>
          <circle cx="32" cy="24" r="10" fill="white" opacity="0.95"/>
        </svg>
      </div>\`;
    return L.divIcon({ className:"", html, iconSize:[28,28], iconAnchor:[14,28] });
  }

  // Templates (for slot dropdown + auto-fill)
  const templates = ${JSON.stringify(defaultPacks())};
  const MSG_SLOTS = ${MSG_SLOTS};
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

  function setStatus(text, ok){
    statusTxt.innerHTML = "Status: " + text + (ok ? " <span class='ok'>✓</span>" : " <span class='bad'>✗</span>");
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
    for(let i=0;i<MSG_SLOTS;i++){
      const o = document.createElement("option");
      o.value = String(i);
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

  sigSel.addEventListener("change", ()=>{ fillSlotOptions(); autofillLines(); });
  slotSel.addEventListener("change", autofillLines);

  async function loadDevices(forceRefresh){
    try{
      const res = await fetch("/devices", { cache: forceRefresh ? "no-store" : "default" });
      const data = await res.json();

      let on=0, off=0;
      (data||[]).forEach(d=> (d.status==="online"?on++:off++));
      document.getElementById("total").innerText = (data||[]).length;
      document.getElementById("on").innerText = on;
      document.getElementById("off").innerText = off;

      (data||[]).forEach(d=>{
        const isOn = (d.status==="online");
        const pos = [d.lat || 0, d.lng || 0];
        const icon = pinIcon(d.status);
        const pop =
          "<b>"+d.device_id+"</b>" +
          "<br>Status: <b style='color:"+(isOn?"#16a34a":"#dc2626")+"'>"+d.status+"</b>" +
          "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

        if(markers.has(d.device_id)){
          markers.get(d.device_id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
        }else{
          const m = L.marker(pos,{icon}).addTo(map).bindPopup(pop);
          markers.set(d.device_id,m);
        }
      });

      // device dropdown
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

  // SEND ONLY ON BUTTON CLICK ✅
  async function sendToESP(){
    const device_id = devSel.value;
    if(!device_id){ setStatus("No device selected", false); return; }

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
      setStatus("Sent", true);
    }catch(e){
      setStatus("Network error", false);
    }
  }

  fillSigOptions();
  fillSlotOptions();
  autofillLines();

  loadDevices(true);
  setInterval(()=>loadDevices(false), 2000);

  // logo fallback chain
  const img = document.getElementById("arcLogo");
  img.addEventListener("error", ()=>{
    if(img.src.endsWith("/arcadis.png")) img.src="/image.png";
    else if(img.src.endsWith("/image.png")) img.src="/logo.png";
  });
</script>
</body>
</html>`);
});

// ======================
// START SERVER ✅
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));