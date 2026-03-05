// server.js ✅ FULL WORKING (NO MongoDB)
// LIGHT ORANGE + WHITE + TIMES NEW ROMAN
// ✅ Login page (logo + username + password + powered by)
// ✅ Prevent browser autofill showing username/password before typing
// ✅ No session persistence: refresh -> login
// ✅ Dashboard has Logout ICON (top-right)
// ✅ Status is STATIC (changes ONLY when you click Send)
// ✅ If device OFFLINE -> client shows error + server blocks /api/simple
// ✅ Devices grouped by: Junction -> Arm -> Device
// ✅ Force includes AMBULANCE (persistent until AUTO is sent)
// ✅ Dashboard uses ONLY live ESP data (in-memory)

const express = require("express");
const cors = require("cors");
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
// CONSTANTS
// ======================
const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;

// ======================
// IN-MEMORY STORES (NO DB)
// ======================
// device_id -> { device_id, junction_name, arm_name, lat, lng, last_seen, status }
const DEVICES = new Map();

// device_id -> cloud message state (force + packs + slot + version)
const CLOUD = new Map();

// ======================
// DEFAULT PACKS
// ======================
function defaultPacks() {
  const pack = (pairs) => pairs.map(([l1, l2]) => ({ l1, l2 }));

  return {
    red: pack([
      ["HURRY ENDS HERE", "YOUR FAMILY WAITS — NOT YOUR SPEED"],
      ["ONE SECOND OF PATIENCE", "CAN BUY A LIFETIME OF PEACE"],
      ["BRAKE NOW", "REGRET IS HEAVIER THAN YOUR FOOT"],
      ["THE ROAD IS NOT A GAME", "PAUSE — PROTECT SOMEONE’S FUTURE"],
      ["STOPPING IS STRENGTH", "SMART DRIVERS LIVE LONGER"],
    ]),
    amber: pack([
      ["EASE OFF THE PEDAL NOW", "A CALM SLOWDOWN KEEPS EVERYONE SAFE"],
      ["NO NEED TO RUSH THE JUNCTION", "A SECOND OF PATIENCE SAVES A LIFE"],
      ["SLOW AND WATCH THE ROAD AHEAD", "CONTROL TODAY PREVENTS COLLISION"],
      ["LET THE SPEED DROP GENTLY", "SMOOTH BRAKING SAVES FUEL TOO"],
      ["PAUSE YOUR HURRY AT THE CROSSING", "SAFE STREETS START WITH PATIENCE"],
    ]),
    green: pack([
      ["SLOW DRIVING SAVES FUEL AND SAVES LIVES", "SMART SPEED PROTECTS PEOPLE AND PLANET"],
      ["CALM DRIVING REDUCES ACCIDENTS AND POLLUTION", "RESPONSIBLE SPEED CREATES HEALTHY CITIES"],
      ["GLIDE FORWARD WITH A SAFE GAP", "SPACE ON THE ROAD PREVENTS CRASHES"],
      ["SPEED THRILLS BUT SAFETY SAVES", "SAFE DRIVING IS SMART DRIVING"],
      ["MOVE AHEAD WITH CARE AND CONTROL", "ARRIVE SAFE EVERY TIME"],
    ]),
    no: pack([
      ["WHEN SIGNALS FAIL DISCIPLINE MUST NOT", "CONTROL YOUR SPEED"],
      ["FAST DRIVING AT JUNCTIONS INVITES ACCIDENTS", "SLOW DOWN AND STAY ALERT"],
      ["WITHOUT SIGNALS SAFETY DEPENDS ON YOU", "DRIVE WITH PATIENCE"],
      ["DISCIPLINED DRIVERS CREATE SAFE ROADS", "FOLLOW TRAFFIC RULES"],
      ["YOUR SPEED DECIDES SOMEONES FUTURE", "DRIVE RESPONSIBLY"],
    ]),
  };
}

function ambulancePacks() {
  // line1 will be generated automatically: "ROAD X STOP"
  // line2 is the awareness line (ESP should scroll it)
  return [
    ["", "GIVE WAY TO AMBULANCE — SOMEONE’S LIFE IS ON THE LINE"],
    ["", "MOVE LEFT, STAY CALM — CLEAR THE PATH FOR EMERGENCY"],
    ["", "DON’T BLOCK THE JUNCTION — AMBULANCE NEEDS A CLEAR EXIT"],
    ["", "HEAR THE SIREN? MAKE SPACE — SECONDS SAVE LIVES"],
    ["", "STOP SAFELY AND LET IT PASS — EMERGENCY FIRST"],
  ];
}

// ======================
// HELPERS
// ======================
const signals = ["red", "amber", "green", "no"];
const forces = ["", "red", "amber", "green", "ambulance"];

function nowMs() {
  return Date.now();
}
function normText(x) {
  return String(x ?? "").trim();
}
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
function isDeviceOnlineRow(dev) {
  if (!dev) return false;
  const last = Number(dev.last_seen || 0);
  return nowMs() - last <= OFFLINE_AFTER_MS;
}
function ensureCloud(device_id) {
  if (!CLOUD.has(device_id)) {
    CLOUD.set(device_id, {
      device_id,
      force: "", // "" auto | red | amber | green | ambulance
      slot: { red: 0, amber: 0, green: 0, no: 0, ambulance: 0 },
      packs: { ...defaultPacks(), ambulance: ambulancePacks() },
      v: 0,
      updated_at: 0,
      ambulance_line1: "", // computed when sending ambulance
      ambulance_line2: "", // chosen by slot
    });
  }
  return CLOUD.get(device_id);
}
function computeRoadStop(arm_name) {
  // Expect arm_name like "Road 1", "Road1", "ROAD 1"
  const a = normText(arm_name).toUpperCase();
  if (!a) return "ROAD STOP";
  // keep "ROAD 1" style if possible
  // extract number
  const m = a.match(/ROAD\s*([0-9]+)/i);
  if (m) return `ROAD ${m[1]} STOP`;
  // else just use arm name
  return `${a} STOP`;
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
      <img class="logo" src="/arcadis.png" alt="Arcadis" onerror="this.onerror=null; this.src='/image.png';" />
      <div>
        <h1>Display Health Monitor</h1>
        <div class="sub">Secure Login</div>
      </div>
    </div>

    <!-- Autofill killer -->
    <form id="loginForm" autocomplete="off">
      <input style="position:absolute;left:-9999px;top:-9999px" autocomplete="username">
      <input style="position:absolute;left:-9999px;top:-9999px" type="password" autocomplete="current-password">

      <label>Username</label>
      <input id="u" placeholder="Username" autocomplete="off" autocapitalize="off" spellcheck="false" readonly>

      <label>Password</label>
      <input id="p" type="password" placeholder="Password" autocomplete="new-password" readonly>

      <button type="submit">Login</button>
      <div class="err" id="err"></div>
    </form>

    <div class="footer">Powered by <b>Arcadis</b></div>
  </div>
</div>

<script>
  const form = document.getElementById("loginForm");
  const err  = document.getElementById("err");
  const u = document.getElementById("u");
  const p = document.getElementById("p");

  function unlock(){ u.removeAttribute("readonly"); p.removeAttribute("readonly"); }
  u.addEventListener("focus", unlock, { once:true });
  p.addEventListener("focus", unlock, { once:true });

  window.addEventListener("load", ()=>{ u.value=""; p.value=""; });

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    err.textContent = "";

    const username = u.value.trim();
    const password = p.value;

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

// POST /login -> returns dashboard HTML with token injected
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
// DEVICE REGISTER + HEARTBEAT (NO DB)
// ESP must send: device_id, lat, lng, junction_name, arm_name
// ======================
function upsertDeviceFromPing(req, res) {
  try {
    const b = req.body || {};
    const device_id = normText(b.device_id);
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const lat = typeof b.lat === "number" ? b.lat : Number(b.lat);
    const lng = typeof b.lng === "number" ? b.lng : Number(b.lng);

    const junction_name = normText(b.junction_name || b.junction || "");
    const arm_name = normText(b.arm_name || b.arm_label || b.arm || "");

    const cur = DEVICES.get(device_id) || { device_id };
    const updated = {
      ...cur,
      device_id,
      junction_name: junction_name || cur.junction_name || "",
      arm_name: arm_name || cur.arm_name || "",
      lat: Number.isFinite(lat) ? lat : (cur.lat || 0),
      lng: Number.isFinite(lng) ? lng : (cur.lng || 0),
      last_seen: nowMs(),
      status: "online",
    };

    DEVICES.set(device_id, updated);
    ensureCloud(device_id);

    res.json({ ok: true, device: updated });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

app.post("/register", upsertDeviceFromPing);
app.post("/heartbeat", upsertDeviceFromPing);

// ======================
// DEVICES LIST (NO DB)
// ======================
app.get("/devices", (req, res) => {
  try {
    const now = nowMs();
    const out = [];

    for (const d of DEVICES.values()) {
      const isOn = now - Number(d.last_seen || 0) <= OFFLINE_AFTER_MS;
      out.push({
        device_id: d.device_id,
        junction_name: d.junction_name || "",
        arm_name: d.arm_name || "",
        lat: Number(d.lat || 0),
        lng: Number(d.lng || 0),
        last_seen: Number(d.last_seen || 0),
        status: isOn ? "online" : "offline",
      });
    }

    out.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// CLOUD MESSAGE API (PROTECTED + BLOCK OFFLINE)
// POST /api/simple
// - Normal: {device_id, force, sig, slot, line1, line2}
// - Ambulance: {device_id, force:"ambulance", amb_slot}
// ======================
app.post("/api/simple", requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const device_id = normText(b.device_id);
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const dev = DEVICES.get(device_id);
    if (!isDeviceOnlineRow(dev)) {
      return res.status(400).json({ error: "Device is OFFLINE. Check device WiFi / power / network." });
    }

    const cloud = ensureCloud(device_id);
    const f = normText(b.force);

    if (!forces.includes(f)) return res.status(400).json({ error: "invalid force" });

    // Force = AMBULANCE (persistent until AUTO sent)
    if (f === "ambulance") {
      const amb_slot = clampSlot(Number(b.amb_slot || 0));
      const ambList = cloud.packs.ambulance || ambulancePacks();
      const item = ambList[amb_slot] || ["", "GIVE WAY TO AMBULANCE — SOMEONE’S LIFE IS ON THE LINE"];

      // line1 must be ROAD X STOP based on device arm_name
      const roadStop = computeRoadStop(dev.arm_name || "");
      cloud.ambulance_line1 = roadStop;
      cloud.ambulance_line2 = String(item[1] || "");

      cloud.force = "ambulance";
      cloud.slot.ambulance = amb_slot;
      cloud.v += 1;
      cloud.updated_at = nowMs();

      return res.json({ ok: true, mode: "ambulance", v: cloud.v, updated_at: cloud.updated_at });
    }

    // Force = AUTO or red/amber/green
    cloud.force = f; // "" auto or fixed signal

    // Normal message update (sig/slot/lines)
    const s = normText(b.sig || "red");
    if (!signals.includes(s)) return res.status(400).json({ error: "invalid sig" });

    const sl = clampSlot(Number(b.slot || 0));
    const l1 = String(b.line1 || "");
    const l2 = String(b.line2 || "");

    cloud.packs[s] = normalizePack(cloud.packs[s] || defaultPacks()[s]);
    cloud.packs[s][sl] = { l1, l2 };
    cloud.slot[s] = sl;

    cloud.v += 1;
    cloud.updated_at = nowMs();

    res.json({ ok: true, mode: f === "" ? "auto" : "forced", v: cloud.v, updated_at: cloud.updated_at });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP pulls (no auth)
// GET /api/pull/:device_id?since=v
app.get("/api/pull/:device_id", (req, res) => {
  try {
    const device_id = req.params.device_id;
    const since = Number(req.query.since || 0);
    const cloud = ensureCloud(device_id);

    const v = Number(cloud.v || 0);
    if (since >= v) return res.json({ ok: true, changed: false, v });

    // If ambulance mode: return the special lines
    if (cloud.force === "ambulance") {
      return res.json({
        ok: true,
        changed: true,
        device_id,
        v,
        force: "ambulance",
        ambulance: {
          line1: cloud.ambulance_line1 || "ROAD STOP",
          line2: cloud.ambulance_line2 || "GIVE WAY TO AMBULANCE — SOMEONE’S LIFE IS ON THE LINE",
          slot: Number(cloud.slot.ambulance || 0),
        },
        updated_at: cloud.updated_at || 0,
      });
    }

    // Normal mode
    return res.json({
      ok: true,
      changed: true,
      device_id,
      v,
      force: cloud.force || "", // "" auto | red | amber | green
      slot: cloud.slot || { red: 0, amber: 0, green: 0, no: 0, ambulance: 0 },
      packs: cloud.packs || { ...defaultPacks(), ambulance: ambulancePacks() },
      slots: MSG_SLOTS,
      updated_at: cloud.updated_at || 0,
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
    width:300px;min-width:300px;background:var(--card);
    border:1px solid var(--border);border-radius:16px;
    display:flex;flex-direction:column;padding:14px 12px;
    box-shadow:0 10px 26px rgba(17,24,39,.08);
    overflow:auto;
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
    max-width:1100px;border:1px solid var(--border);border-radius:16px;padding:14px;background:#fff
  }
  .h1{font-weight:900;font-size:18px}
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

  /* Junction tree */
  .treeBox{
    margin-top:12px;
    border:1px solid var(--border);
    border-radius:14px;
    background:#fffaf5;
    padding:10px;
  }
  .treeTitle{font-weight:900;margin-bottom:8px;}
  .jBtn, .aBtn{
    width:100%;
    text-align:left;
    padding:10px 10px;
    border-radius:12px;
    border:1px solid var(--border);
    background:#fff;
    cursor:pointer;
    font-weight:900;
  }
  .jBtn{ margin-top:8px; }
  .aBtn{ margin-top:8px; font-weight:800; }
  .indent{ padding-left:12px; margin-top:6px; }
  .smallNote{ margin-top:8px; font-size:12px; color:var(--muted); font-weight:800; }

  .badge{
    display:inline-block;
    padding:4px 10px;
    border-radius:999px;
    border:1px solid var(--border);
    font-weight:900;
    font-size:12px;
    background:#fff;
    margin-left:6px;
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

    <div id="treeContainer" class="treeBox" style="display:none">
      <div class="treeTitle">Junctions (Auto)</div>
      <div id="treeBody"></div>
      <div class="smallNote">Click MESSAGES again to hide all junctions.</div>
    </div>

    <div class="footer">Powered by <b>Arcadis</b></div>
  </div>

  <div class="content">
    <div class="topbar">
      <button class="iconBtn" onclick="logout()" title="Logout" aria-label="Logout">
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
              <div class="lbl">Device (selected)</div>
              <select id="devSel"></select>
              <div class="statusLine" id="currentLine" style="margin-top:6px">Current: -</div>
            </div>
            <div>
              <div class="lbl">Force</div>
              <select id="forceSel">
                <option value="">AUTO</option>
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
                <option value="ambulance">AMBULANCE</option>
              </select>
              <div class="statusLine" id="forceHint" style="margin-top:6px">
                Hint: AMBULANCE stays until you send AUTO.
              </div>
            </div>
          </div>

          <div class="grid" id="normalRow">
            <div>
              <div class="lbl">Signal group</div>
              <select id="sigSel"></select>
            </div>
            <div>
              <div class="lbl">Slot</div>
              <select id="slotSel"></select>
            </div>
          </div>

          <div class="grid" id="ambulanceRow" style="display:none">
            <div>
              <div class="lbl">Ambulance slogan</div>
              <select id="ambSel"></select>
            </div>
            <div>
              <div class="lbl">Preview</div>
              <div style="border:1px solid var(--border);border-radius:12px;padding:10px;background:#fff">
                <div style="font-weight:900" id="ambL1">ROAD STOP</div>
                <div style="margin-top:6px;font-weight:800;color:#6b7280" id="ambL2">GIVE WAY TO AMBULANCE — SOMEONE’S LIFE IS ON THE LINE</div>
              </div>
            </div>
          </div>

          <div class="grid" id="linesRow">
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

          <div class="statusLine" id="statusTxt">Status: Ready <span class="ok">✓</span></div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
  const AUTH_TOKEN = "${TOKEN}";
  try{ history.replaceState({}, "", "/dashboard"); }catch(e){}

  function logout(){ window.location.href = "/login"; }

  const treeContainer = document.getElementById("treeContainer");
  let treeVisible = false;

  function showTab(which){
    if(which==="msg"){
      if(document.getElementById("tabMsgBtn").classList.contains("active") && treeVisible){
        treeVisible = false;
        treeContainer.style.display = "none";
      }else{
        treeVisible = true;
        treeContainer.style.display = "block";
      }
    }else{
      treeVisible = false;
      treeContainer.style.display = "none";
    }

    document.getElementById("tabMapBtn").classList.toggle("active", which==="map");
    document.getElementById("tabMsgBtn").classList.toggle("active", which==="msg");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewMsg").classList.toggle("active", which==="msg");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 150); }
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
  const ambulanceTemplates = ${JSON.stringify(ambulancePacks())};
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
  const currentLine = document.getElementById("currentLine");

  const normalRow = document.getElementById("normalRow");
  const linesRow = document.getElementById("linesRow");
  const ambulanceRow = document.getElementById("ambulanceRow");
  const ambSel = document.getElementById("ambSel");
  const ambL1 = document.getElementById("ambL1");
  const ambL2 = document.getElementById("ambL2");

  let DEVICE_CACHE = [];
  let expandedJunction = null;
  let expandedArmKey = null;

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

  function fillAmbulanceOptions(){
    ambSel.innerHTML = "";
    for(let i=0;i<MSG_SLOTS;i++){
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = (i+1) + ". " + (ambulanceTemplates[i]?.[1] || "Ambulance awareness");
      ambSel.appendChild(o);
    }
  }

  function currentDeviceRow(device_id){
    return DEVICE_CACHE.find(x=>x.device_id===device_id) || null;
  }

  function computeRoadStopFromArm(arm_name){
    const a = String(arm_name||"").trim().toUpperCase();
    if(!a) return "ROAD STOP";
    const m = a.match(/ROAD\\s*([0-9]+)/i);
    if(m) return "ROAD " + m[1] + " STOP";
    return a + " STOP";
  }

  function updateAmbPreview(){
    const d = currentDeviceRow(devSel.value);
    const roadStop = computeRoadStopFromArm(d?.arm_name || "");
    const sl = Number(ambSel.value||0);
    ambL1.textContent = roadStop;
    ambL2.textContent = ambulanceTemplates[sl]?.[1] || "GIVE WAY TO AMBULANCE — SOMEONE’S LIFE IS ON THE LINE";
  }

  function updateCurrentLine(){
    const d = currentDeviceRow(devSel.value);
    if(!d){ currentLine.textContent = "Current: -"; return; }
    const j = d.junction_name || "Unknown Junction";
    const a = d.arm_name ? (" | " + d.arm_name) : "";
    currentLine.innerHTML = "Current: <b>" + d.device_id + "</b> | <b>" + (d.status||"offline").toUpperCase() + "</b> | " + j + a;
  }

  devSel.addEventListener("change", ()=>{
    updateCurrentLine();
    updateAmbPreview();
  });

  sigSel.addEventListener("change", ()=>{ fillSlotOptions(); autofillLines(); });
  slotSel.addEventListener("change", autofillLines);
  ambSel.addEventListener("change", updateAmbPreview);

  forceSel.addEventListener("change", ()=>{
    const f = forceSel.value || "";
    if(f === "ambulance"){
      normalRow.style.display = "none";
      linesRow.style.display = "none";
      ambulanceRow.style.display = "grid";
      fillAmbulanceOptions();
      updateAmbPreview();
    }else{
      ambulanceRow.style.display = "none";
      normalRow.style.display = "grid";
      linesRow.style.display = "grid";
      fillSlotOptions();
      autofillLines();
    }
  });

  function buildTree(){
    const treeBody = document.getElementById("treeBody");
    treeBody.innerHTML = "";

    const groups = new Map(); // junction -> Map(arm -> [devices])
    DEVICE_CACHE.forEach(d=>{
      const j = (d.junction_name || "").trim() || "Unknown Junction";
      const a = (d.arm_name || "").trim() || "Device";
      if(!groups.has(j)) groups.set(j, new Map());
      const armMap = groups.get(j);
      if(!armMap.has(a)) armMap.set(a, []);
      armMap.get(a).push(d);
    });

    const junctions = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
    junctions.forEach(jName=>{
      const jBtn = document.createElement("button");
      jBtn.className = "jBtn";
      jBtn.textContent = jName + (expandedJunction===jName ? " ▲" : " ▼");
      jBtn.onclick = ()=>{
        if(expandedJunction===jName){
          expandedJunction = null;
          expandedArmKey = null;
        }else{
          expandedJunction = jName;
          expandedArmKey = null;
        }
        buildTree();
      };
      treeBody.appendChild(jBtn);

      if(expandedJunction === jName){
        const armWrap = document.createElement("div");
        armWrap.className = "indent";

        const armMap = groups.get(jName);
        const arms = Array.from(armMap.keys()).sort((a,b)=>a.localeCompare(b));
        arms.forEach(aName=>{
          const key = jName + "|" + aName;

          const aBtn = document.createElement("button");
          aBtn.className = "aBtn";
          aBtn.textContent = aName + (expandedArmKey===key ? " ▲" : " ▼");
          aBtn.onclick = ()=>{
            if(expandedArmKey===key) expandedArmKey=null;
            else expandedArmKey=key;
            buildTree();
          };
          armWrap.appendChild(aBtn);

          if(expandedArmKey === key){
            const devWrap = document.createElement("div");
            devWrap.className = "indent";

            armMap.get(aName).forEach(dev=>{
              const b = document.createElement("button");
              b.className = "aBtn";
              b.style.fontWeight = "800";
              b.textContent = dev.device_id + " (" + dev.status + ")";
              b.onclick = ()=>{
                devSel.value = dev.device_id;
                updateCurrentLine();
                updateAmbPreview();
                showTab("msg");
              };
              devWrap.appendChild(b);
            });

            armWrap.appendChild(devWrap);
          }
        });

        treeBody.appendChild(armWrap);
      }
    });
  }

  async function loadDevices(forceRefresh){
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

      const j = d.junction_name || "Unknown Junction";
      const a = d.arm_name ? ("<br>Arm: <b>"+d.arm_name+"</b>") : "";

      const pop =
        "<b>"+d.device_id+"</b>" +
        "<br>Junction: <b>"+j+"</b>" + a +
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
      const j = d.junction_name || "Unknown Junction";
      const a = d.arm_name ? (" | " + d.arm_name) : "";
      opt.textContent = d.device_id + " (" + d.status + ") — " + j + a;
      devSel.appendChild(opt);
    });
    if(cur) devSel.value = cur;
    if(!devSel.value && DEVICE_CACHE[0]) devSel.value = DEVICE_CACHE[0].device_id;

    updateCurrentLine();
    updateAmbPreview();
    if(treeVisible) buildTree();
  }

  function currentDeviceStatus(device_id){
    const d = DEVICE_CACHE.find(x=>x.device_id===device_id);
    return d ? (d.status||"offline") : "offline";
  }

  async function sendToESP(){
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

    const f = forceSel.value || "";

    setStatus("Sending...", true);

    try{
      let payload;

      if(f === "ambulance"){
        payload = {
          device_id,
          force: "ambulance",
          amb_slot: Number(ambSel.value||0)
        };
      }else{
        payload = {
          device_id,
          force: f,
          sig: sigSel.value,
          slot: Number(slotSel.value||0),
          line1: line1.value || "",
          line2: line2.value || ""
        };
      }

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

      if(f === "ambulance") setStatus("Ambulance mode ON", true);
      else if(f === "") setStatus("AUTO mode ON", true);
      else setStatus("Sent", true);

    }catch(e){
      setStatus("Network error", false);
    }
  }

  fillSigOptions();
  fillSlotOptions();
  autofillLines();
  fillAmbulanceOptions();
  updateAmbPreview();

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
// START SERVER ✅ (Render uses PORT env)
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));