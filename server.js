// server.js ✅ FULL WORKING (NO RENDER ERRORS)
// LIGHT ORANGE+WHITE + TIMES NEW ROMAN
// ✅ Login page (logo + username + password + powered by)
// ✅ Prevent browser autofill showing username/password before typing
// ✅ No session persistence: refresh -> login
// ✅ Dashboard has Logout ICON (top-right)
// ✅ Status is STATIC (changes ONLY when you click Send)
// ✅ If device OFFLINE -> client shows error + server blocks /api/simple

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // public/arcadis.png, image.png, logo.png

// ======================
// LOGIN (hardcoded)
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";

// token store (in-memory)
const TOKENS = new Map(); // token -> { exp }
const TOKEN_TTL_MS = 30 * 60 * 1000;

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}
function putToken() {
  const t = makeToken();
  TOKENS.set(t, { exp: Date.now() + TOKEN_TTL_MS });
  return t;
}
function isValidToken(t) {
  if (!t) return false;
  const row = TOKENS.get(t);
  if (!row) return false;
  if (Date.now() > row.exp) {
    TOKENS.delete(t);
    return false;
  }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, row] of TOKENS.entries()) {
    if (now > row.exp) TOKENS.delete(t);
  }
}, 60 * 1000);

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
const OFFLINE_AFTER_MS = 30000;
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
      ["HURRY ENDS HERE", "YOUR FAMILY WAITS — NOT YOUR SPEED"],
      ["ONE SECOND OF PATIENCE", "CAN BUY A LIFETIME OF PEACE"],
      ["BRAKE NOW", "REGRET IS HEAVIER THAN YOUR FOOT"],
      ["THE ROAD IS NOT A GAME", "PAUSE — PROTECT SOMEONE’S FUTURE"],
      ["STOPPING IS STRENGTH", "SMART DRIVERS LIVE LONGER"]
    ]),

    amber: pack([
      ["EASE OFF THE PEDAL NOW", "A CALM SLOWDOWN KEEPS EVERYONE SAFE"],
      ["NO NEED TO RUSH THE JUNCTION", "A SECOND OF PATIENCE SAVES A LIFE"],
      ["SLOW AND WATCH THE ROAD AHEAD", "CONTROL TODAY PREVENTS COLLISION"],
      ["LET THE SPEED DROP GENTLY", "SMOOTH BRAKING SAVES FUEL TOO"],
      ["PAUSE YOUR HURRY AT THE CROSSING", "SAFE STREETS START WITH PATIENCE"]
    ]),

    green: pack([
      ["SLOW DRIVING SAVES FUEL AND SAVES LIVES", "SMART SPEED PROTECTS PEOPLE AND PLANET"],
      ["CALM DRIVING REDUCES ACCIDENTS AND POLLUTION", "RESPONSIBLE SPEED CREATES HEALTHY CITIES"],
      ["GLIDE FORWARD WITH A SAFE GAP", "SPACE ON THE ROAD PREVENTS CRASHES"],
      ["SPEED THRILLS BUT SAFETY SAVES", "SAFE DRIVING IS SMART DRIVING"],
      ["MOVE AHEAD WITH CARE AND CONTROL", "ARRIVE SAFE EVERY TIME"]
    ]),

    no: pack([
      ["WHEN SIGNALS FAIL DISCIPLINE MUST NOT", "CONTROL YOUR SPEED"],
      ["FAST DRIVING AT JUNCTIONS INVITES ACCIDENTS", "SLOW DOWN AND STAY ALERT"],
      ["WITHOUT SIGNALS SAFETY DEPENDS ON YOU", "DRIVE WITH PATIENCE"],
      ["DISCIPLINED DRIVERS CREATE SAFE ROADS", "FOLLOW TRAFFIC RULES"],
      ["YOUR SPEED DECIDES SOMEONES FUTURE", "DRIVE RESPONSIBLY"]
    ])

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

function isDeviceOnlineRow(dev) {
  if (!dev) return false;
  const last = Number(dev.last_seen || 0);
  return Date.now() - last <= OFFLINE_AFTER_MS;
}

// ======================
// AUTH MIDDLEWARE
// ======================
function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (isValidToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// HOME
// ======================
app.get("/", (req, res) => res.redirect("/login"));

// ======================
// LOGIN (GET)
// ======================
app.get("/login", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Display Health Monitor - Login</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:"Times New Roman", Times, serif;background:#fff7ed;color:#111827}
  :root{
    --orange:#f97316;
    --orange2:#fb923c;
    --card:#ffffff;
    --border:#fed7aa;
    --muted:#6b7280;
  }
  .wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:18px}
  .card{
    width:min(520px, 94vw);
    background:linear-gradient(180deg,#ffffff, #fffaf5);
    border:1px solid var(--border);
    border-radius:18px;
    box-shadow:0 20px 40px rgba(17,24,39,.12);
    padding:18px;
    position:relative;
    overflow:hidden;
  }
  .glow{
    position:absolute;inset:-40px;
    background:radial-gradient(circle at 20% 10%, rgba(249,115,22,.22), transparent 55%),
               radial-gradient(circle at 80% 30%, rgba(251,146,60,.18), transparent 55%);
    pointer-events:none;
    animation:floaty 6s ease-in-out infinite;
  }
  @keyframes floaty{
    0%{transform:translateY(0)}
    50%{transform:translateY(10px)}
    100%{transform:translateY(0)}
  }
  .top{display:flex;align-items:center;gap:12px;position:relative}
  .logo{
    width:56px;height:56px;border-radius:14px;
    background:#fff;border:1px solid var(--border);
    object-fit:contain;padding:6px;
  }
  h1{margin:0;font-size:22px;font-weight:800}
  .sub{margin-top:4px;color:var(--muted);font-size:13px;font-weight:700}
  form{margin-top:16px;position:relative}
  label{display:block;font-size:12px;color:var(--muted);font-weight:800;margin:10px 0 6px}
  input{
    width:100%;padding:12px 12px;border-radius:14px;
    border:1px solid var(--border);background:#fff;
    font-family:"Times New Roman", Times, serif;font-size:15px;
    outline:none;
  }
  button{
    width:100%;margin-top:14px;padding:12px;border-radius:14px;
    border:1px solid var(--orange2);
    background:linear-gradient(135deg,var(--orange),var(--orange2));
    color:#fff;font-weight:900;font-size:15px;
    cursor:pointer;
    box-shadow:0 14px 26px rgba(249,115,22,.25);
    transition:.12s ease;
  }
  button:hover{transform:translateY(-1px)}
  .err{margin-top:10px;color:#dc2626;font-weight:800;font-size:13px;min-height:18px}
  .footer{margin-top:14px;color:var(--muted);font-size:12px;font-weight:800}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="glow"></div>

    <div class="top">
      <img class="logo" src="/arcadis.png" alt="Arcadis"
        onerror="this.onerror=null; this.src='/image.png';"
      />
      <div>
        <h1>Display Health Monitor</h1>
        <div class="sub">Secure Login</div>
      </div>
    </div>

    <form id="loginForm" autocomplete="off">
      <!-- fake inputs to absorb autofill -->
      <input type="text" name="fakeuser" autocomplete="username" style="display:none" />
      <input type="password" name="fakepass" autocomplete="new-password" style="display:none" />

      <label>Username</label>
      <input id="u" name="username_real" autocomplete="off" placeholder="Username" required />

      <label>Password</label>
      <input id="p" name="password_real" type="password" autocomplete="new-password" placeholder="Password" required />

      <button type="submit">Login</button>
      <div class="err" id="err"></div>
    </form>

    <div class="footer">Powered by <b>Arcadis</b></div>
  </div>
</div>

<script>
  // no localStorage/cookies token -> refresh always shows login
  const form = document.getElementById("loginForm");
  const err  = document.getElementById("err");

  // extra hard block for autofill
  window.addEventListener("load", ()=>{
    try{
      document.getElementById("u").value = "";
      document.getElementById("p").value = "";
    }catch(e){}
  });

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    err.textContent = "";

    const username = document.getElementById("u").value.trim();
    const password = document.getElementById("p").value;

    try{
      const r = await fetch("/login",{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ username, password })
      });

      if(!r.ok){
        const out = await r.json().catch(()=>({}));
        err.textContent = out.error || "Invalid login";
        return;
      }

      const html = await r.text();
      document.open();
      document.write(html);
      document.close();
    }catch(e){
      err.textContent = "Network error";
    }
  });
</script>
</body>
</html>`);
});

// ======================
// LOGIN (POST) -> return dashboard HTML with token injected
// ======================
app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (String(username || "") !== ADMIN_USER || String(password || "") !== ADMIN_PASS) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = putToken();
  return res.send(renderDashboardHTML(token));
});

// refresh /dashboard -> go login
app.get("/dashboard", (req, res) => res.redirect("/login"));

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
// DEVICES LIST
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
// CLOUD MESSAGE API (PROTECTED + BLOCK OFFLINE)
// ======================
app.post("/api/simple", requireAuth, async (req, res) => {
  try {
    const { device_id, force, sig, slot, line1, line2 } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const dev = await Device.findOne({ device_id });
    if (!isDeviceOnlineRow(dev)) {
      return res.status(400).json({
        error: "Device is OFFLINE. Check device WiFi / power / network.",
      });
    }

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

    doc.v = Number(doc.v || 0) + 1;
    doc.updated_at = now;

    await doc.save();
    res.json({ ok: true, v: doc.v, updated_at: doc.updated_at });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP pull (no auth)
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
// DASHBOARD HTML
// ======================
function renderDashboardHTML(TOKEN) {
  return `<!doctype html>
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
    --bg:#fff7ed;
    --card:#ffffff;
    --border:#fed7aa;
    --muted:#6b7280;
  }
  .app{height:100%;display:flex;gap:12px;padding:12px;background:var(--bg)}
  .sidebar{
    width:260px;min-width:260px;background:var(--card);
    border:1px solid var(--border);border-radius:16px;
    display:flex;flex-direction:column;padding:14px 12px;
    box-shadow:0 10px 26px rgba(17,24,39,.08);
  }
  .brand{display:flex;align-items:center;gap:10px;padding:6px 6px 10px 6px}
  .brand img{
    width:46px;height:46px;border-radius:12px;background:#fff;
    object-fit:contain;padding:6px;border:1px solid var(--border)
  }
  .brandTitle{font-size:16px;font-weight:800}
  .brandSub{font-size:12px;color:var(--muted);margin-top:2px;font-weight:800}
  .divider{height:1px;background:var(--border);margin:8px 6px}
  .tabBtn{
    width:100%;padding:14px 14px;border-radius:14px;cursor:pointer;
    user-select:none;border:1px solid var(--border);background:#fff;
    font-weight:900;letter-spacing:.5px;transition:.12s ease;
  }
  .tabBtn + .tabBtn{margin-top:10px}
  .tabBtn:hover{transform:translateY(-1px)}
  .tabBtn.active{
    background:linear-gradient(135deg,var(--orange),var(--orange2));
    color:#fff;border-color:var(--orange2);
    box-shadow:0 10px 22px rgba(249,115,22,.25);
  }
  .footer{margin-top:auto;padding:10px 10px 4px 10px;font-size:12px;color:var(--muted);font-weight:900}

  .content{
    flex:1;display:flex;flex-direction:column;background:var(--card);
    border:1px solid var(--border);border-radius:16px;overflow:hidden;
    box-shadow:0 10px 26px rgba(17,24,39,.08);
    position:relative;
  }

  /* Top bar + logout icon button */
  .topbar{
    height:54px;display:flex;align-items:center;justify-content:flex-end;
    padding:0 12px;border-bottom:1px solid var(--border);background:#fff;
  }
  .iconBtn{
    width:42px;height:42px;border-radius:14px;
    display:flex;align-items:center;justify-content:center;
    border:1px solid var(--border);
    background:linear-gradient(135deg,var(--orange),var(--orange2));
    box-shadow:0 12px 22px rgba(249,115,22,.22);
    cursor:pointer;
    transition:.12s ease;
  }
  .iconBtn:hover{transform:translateY(-1px)}
  .iconBtn svg{width:20px;height:20px;fill:#fff}

  .cards{
    display:flex;gap:10px;padding:10px;border-bottom:1px solid var(--border);
    background:#fff;flex-wrap:wrap;
  }
  .card{
    flex:0 0 240px;border:1px solid var(--border);border-radius:14px;background:#fff;
    padding:10px 12px;
  }
  .card .k{font-size:11px;color:var(--muted);font-weight:900;letter-spacing:.6px}
  .card .v{font-size:22px;font-weight:900;margin-top:6px}
  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1}
  .pad{padding:12px}
  .panel{
    max-width:1050px;border:1px solid var(--border);border-radius:16px;padding:14px;background:#fff
  }
  .h1{font-weight:900;font-size:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
  .lbl{font-size:12px;color:var(--muted);font-weight:900;margin-bottom:6px}
  input,select,button{
    width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);
    background:#fff;color:#111827;outline:none;font-size:14px;
    font-family:"Times New Roman", Times, serif;
  }
  button.sendBtn{
    cursor:pointer;background:linear-gradient(135deg,var(--orange),var(--orange2));
    border-color:var(--orange2);color:#fff;font-weight:900;
  }
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  .statusLine{margin-top:10px;font-size:12px;color:var(--muted);font-weight:900}
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
  <div class="sidebar">
    <div class="brand">
      <img id="arcLogo" src="/arcadis.png" alt="Arcadis" onerror="this.onerror=null; this.src='/image.png';" />
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

  <div class="content">
    <div class="topbar">
      <button class="iconBtn" onclick="logout()" title="Logout" aria-label="Logout">
        <!-- logout icon -->
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 17l1.41-1.41L8.83 13H20v-2H8.83l2.58-2.59L10 7l-5 5 5 5z"></path>
          <path d="M4 4h8V2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h8v-2H4V4z"></path>
        </svg>
      </button>
    </div>

    <div class="cards">
      <div class="card"><div class="k">TOTAL DEVICES</div><div class="v" id="total">0</div></div>
      <div class="card"><div class="k">ONLINE</div><div class="v" id="on">0</div></div>
      <div class="card"><div class="k">OFFLINE</div><div class="v" id="off">0</div></div>
    </div>

    <div class="view active" id="viewMap"><div id="map"></div></div>

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
            <button class="sendBtn" onclick="sendToESP()">Send to ESP</button>
          </div>

          <!-- STATIC STATUS: changes ONLY on Send -->
          <div class="statusLine" id="statusTxt">Status: Ready <span class="ok">✓</span></div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
  const AUTH_TOKEN = "${TOKEN}";
  try{ history.replaceState({}, "", "/dashboard"); }catch(e){}

  function logout(){
    window.location.href = "/login";
  }

  function showTab(which){
    document.getElementById("tabMapBtn").classList.toggle("active", which==="map");
    document.getElementById("tabMsgBtn").classList.toggle("active", which==="msg");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewMsg").classList.toggle("active", which==="msg");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 150); }
    // ✅ DO NOT TOUCH STATUS HERE
  }

  const map = L.map('map').setView([17.3850,78.4867], 12);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();
  function pinIcon(status){
    const fill = (status === "online") ? "#16a34a" : "#dc2626";
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

  const templates = ${JSON.stringify(defaultPacks())};
  const MSG_SLOTS = ${MSG_SLOTS};
  const SIGS = [
    {k:"red",   name:"RED → STOP"},
    {k:"amber", name:"AMBER → WAIT"},
    {k:"green", name:"GREEN → GO"},
    {k:"no",    name:"NO SIGNAL"}
  ];

  const devSel = document.getElementById("devSel");
  const sigSel = document.getElementById("sigSel");
  const slotSel= document.getElementById("slotSel");
  const line1  = document.getElementById("line1");
  const line2  = document.getElementById("line2");
  const forceSel = document.getElementById("forceSel");
  const statusTxt = document.getElementById("statusTxt");

  let DEVICE_CACHE = [];

  // ✅ STATUS LOCK: only changes when Send is clicked
  let STATUS_LOCKED = false;

  function setStatus(text, ok){
    STATUS_LOCKED = true;
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
      DEVICE_CACHE = Array.isArray(data) ? data : [];

      let on=0, off=0;
      DEVICE_CACHE.forEach(d=> (d.status==="online"?on++:off++));
      document.getElementById("total").innerText = DEVICE_CACHE.length;
      document.getElementById("on").innerText = on;
      document.getElementById("off").innerText = off;

      DEVICE_CACHE.forEach(d=>{
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

      const cur = devSel.value;
      devSel.innerHTML = "";
      DEVICE_CACHE.forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")";
        devSel.appendChild(opt);
      });
      if(cur) devSel.value = cur;

      // ✅ DO NOT set status here (keeps it static)
    }catch(e){
      if(!STATUS_LOCKED){
        // only show this if user never pressed send
        statusTxt.innerHTML = "Status: Network issue <span class='bad'>✗</span>";
      }
    }
  }

  function currentDeviceStatus(device_id){
    const d = DEVICE_CACHE.find(x=>x.device_id===device_id);
    return d ? (d.status||"offline") : "offline";
  }

  async function sendToESP(){
    // user clicked Send -> allow new status updates
    STATUS_LOCKED = false;

    const device_id = devSel.value;
    if(!device_id){
      setStatus("No device selected", false);
      return;
    }

    const st = currentDeviceStatus(device_id);
    if(st !== "online"){
      setStatus("Device OFFLINE. Check device WiFi / power.", false);
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
        headers:{
          "Content-Type":"application/json",
          "X-Auth-Token": AUTH_TOKEN
        },
        body: JSON.stringify(payload)
      });

      const out = await r.json().catch(()=> ({}));
      if(!r.ok){
        setStatus(out.error || "Send failed", false);
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

  const img = document.getElementById("arcLogo");
  img.addEventListener("error", ()=>{
    if(img.src.endsWith("/arcadis.png")) img.src="/image.png";
    else if(img.src.endsWith("/image.png")) img.src="/logo.png";
  });
</script>
</body>
</html>`;
}

// ======================
// START SERVER
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));