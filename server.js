const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ======================
// LOGIN
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";

const TOKENS = new Map();
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
}, 60000);

function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (isValidToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// CONSTANTS
// ======================
const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;
const TEST_JUNCTION = "Rasoolpura";

// ======================
// LIVE MEMORY ONLY
// ======================
const DEVICES = new Map();         // real ESP devices
const CLOUD = new Map();           // real ESP cloud states
const VIRTUAL_DEVICES = new Map(); // test devices
const VIRTUAL_CLOUD = new Map();   // test cloud states

function safeText(v) {
  return String(v || "").trim();
}
function normJunction(v) {
  const x = safeText(v);
  return x || "Junction Not Sent";
}
function normArm(v) {
  const x = safeText(v);
  return x || "Road";
}

function defaultPacks() {
  const pack = (pairs) => pairs.map(([l1, l2]) => ({ l1, l2 }));
  return {
    red: pack([
      ["HURRY ENDS HERE", "YOUR FAMILY WAITS — NOT YOUR SPEED"],
      ["ONE SECOND OF PATIENCE", "CAN BUY A LIFETIME OF PEACE"],
      ["BRAKE NOW", "REGRET IS HEAVIER THAN YOUR FOOT"],
      ["THE ROAD IS NOT A GAME", "PAUSE — PROTECT SOMEONE'S FUTURE"],
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

function ambulanceSlogans() {
  return [
    "GIVE WAY TO AMBULANCE — EVERY SECOND CAN SAVE A LIFE",
    "CLEAR THE ROAD — AN AMBULANCE CARRIES HOPE",
    "DON'T BLOCK THE WAY — SOMEONE NEEDS URGENT HELP",
    "MAKE SPACE FOR AMBULANCE — LIFE MUST MOVE FIRST",
    "YOUR ONE MOVE CAN GIVE SOMEONE ANOTHER CHANCE TO LIVE"
  ];
}

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

function makeCloudDoc(device_id) {
  return {
    device_id,
    mode: "auto", // auto | force_red | force_amber | force_green | ambulance
    force: "",
    slot: { red: 0, amber: 0, green: 0, no: 0 },
    packs: defaultPacks(),
    v: 0,
    updated_at: 0,
    ambulanceActive: false,
    ambulanceArm: "",
    ambulanceL1: "",
    ambulanceL2: ""
  };
}

function ensureCloudRow(device_id) {
  if (!CLOUD.has(device_id)) CLOUD.set(device_id, makeCloudDoc(device_id));
  return CLOUD.get(device_id);
}
function ensureVirtualCloudRow(device_id) {
  if (!VIRTUAL_CLOUD.has(device_id)) VIRTUAL_CLOUD.set(device_id, makeCloudDoc(device_id));
  return VIRTUAL_CLOUD.get(device_id);
}

function isLiveOnline(dev) {
  if (!dev) return false;
  return Date.now() - Number(dev.last_seen || 0) <= OFFLINE_AFTER_MS;
}

function cleanDeadDevices() {
  const now = Date.now();
  for (const [device_id, dev] of DEVICES.entries()) {
    if (now - Number(dev.last_seen || 0) > OFFLINE_AFTER_MS * 20) {
      DEVICES.delete(device_id);
      CLOUD.delete(device_id);
    }
  }
}

function removeDuplicatesForRawDevice(rawDeviceId, keepKey) {
  for (const [key, dev] of DEVICES.entries()) {
    if (key !== keepKey && safeText(dev.raw_device_id) === safeText(rawDeviceId)) {
      DEVICES.delete(key);
      CLOUD.delete(key);
    }
  }
}

function removeConflictingFinalKey(finalKey, rawDeviceId) {
  const existing = DEVICES.get(finalKey);
  if (existing && safeText(existing.raw_device_id) !== safeText(rawDeviceId)) {
    CLOUD.delete(finalKey);
    DEVICES.delete(finalKey);
  }
}

// ======================
// TEST DEVICES
// ======================
function seedVirtualDevices() {
  const now = Date.now();
  const items = [
    {
      device_id: "ROAD 2",
      raw_device_id: "VIRTUAL_ROAD_2",
      junction_name: TEST_JUNCTION,
      arm_name: "ROAD 2",
      lat: 17.4472,
      lng: 78.4774,
      last_seen: now,
      status: "online",
      virtual: true
    },
    {
      device_id: "ROAD 3",
      raw_device_id: "VIRTUAL_ROAD_3",
      junction_name: TEST_JUNCTION,
      arm_name: "ROAD 3",
      lat: 17.4473,
      lng: 78.4775,
      last_seen: now,
      status: "online",
      virtual: true
    },
    {
      device_id: "ROAD 4",
      raw_device_id: "VIRTUAL_ROAD_4",
      junction_name: TEST_JUNCTION,
      arm_name: "ROAD 4",
      lat: 17.4474,
      lng: 78.4776,
      last_seen: now,
      status: "online",
      virtual: true
    },
    {
      device_id: "ROAD 5",
      raw_device_id: "VIRTUAL_ROAD_5",
      junction_name: TEST_JUNCTION,
      arm_name: "ROAD 5",
      lat: 17.4475,
      lng: 78.4777,
      last_seen: now,
      status: "online",
      virtual: true
    }
  ];

  items.forEach(d => {
    VIRTUAL_DEVICES.set(d.device_id, d);
    ensureVirtualCloudRow(d.device_id);
  });
}
seedVirtualDevices();

function allDevicesMerged() {
  cleanDeadDevices();

  const latestByRaw = new Map();

  for (const dev of DEVICES.values()) {
    const raw = safeText(dev.raw_device_id || dev.device_id);
    const prev = latestByRaw.get(raw);
    if (!prev || Number(dev.last_seen || 0) >= Number(prev.last_seen || 0)) {
      latestByRaw.set(raw, dev);
    }
  }

  const out = [...latestByRaw.values()].map(d => ({
    device_id: d.device_id,
    raw_device_id: d.raw_device_id,
    junction_name: normJunction(d.junction_name),
    arm_name: normArm(d.arm_name),
    lat: Number(d.lat || 0),
    lng: Number(d.lng || 0),
    last_seen: Number(d.last_seen || 0),
    status: isLiveOnline(d) ? "online" : "offline",
    virtual: false
  }));

  for (const v of VIRTUAL_DEVICES.values()) {
    out.push({
      device_id: v.device_id,
      raw_device_id: v.raw_device_id,
      junction_name: normJunction(v.junction_name),
      arm_name: normArm(v.arm_name),
      lat: Number(v.lat || 0),
      lng: Number(v.lng || 0),
      last_seen: Number(v.last_seen || 0),
      status: "online",
      virtual: true
    });
  }

  out.sort((a, b) => {
    const ja = String(a.junction_name || "");
    const jb = String(b.junction_name || "");
    if (ja !== jb) return ja.localeCompare(jb);
    return String(a.device_id || "").localeCompare(String(b.device_id || ""));
  });

  return out;
}

function getMergedDeviceById(device_id) {
  if (DEVICES.has(device_id)) {
    const d = DEVICES.get(device_id);
    return {
      ...d,
      status: isLiveOnline(d) ? "online" : "offline",
      virtual: false
    };
  }
  if (VIRTUAL_DEVICES.has(device_id)) {
    return {
      ...VIRTUAL_DEVICES.get(device_id),
      status: "online",
      virtual: true
    };
  }
  return null;
}

function getDevicesByJunction(junction_name) {
  return allDevicesMerged().filter(d => d.junction_name === junction_name && d.status === "online");
}

// ======================
// HOME
// ======================
app.get("/", (req, res) => res.redirect("/login"));

// ======================
// LOGIN PAGE
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
    background:linear-gradient(180deg,#ffffff,#fffaf5);
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
    width:100%;padding:12px;border-radius:14px;border:1px solid var(--border);
    background:#fff;font-family:"Times New Roman", Times, serif;font-size:15px;outline:none;
  }
  button{
    width:100%;margin-top:14px;padding:12px;border-radius:14px;border:1px solid var(--orange2);
    background:linear-gradient(135deg,var(--orange),var(--orange2));
    color:#fff;font-weight:900;font-size:15px;cursor:pointer;
    box-shadow:0 14px 26px rgba(249,115,22,.25);
  }
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

    <form id="loginForm" autocomplete="off">
      <input style="position:absolute;left:-9999px;top:-9999px" autocomplete="username">
      <input style="position:absolute;left:-9999px;top:-9999px" type="password" autocomplete="current-password">

      <label>Username</label>
      <input id="u" placeholder="Username" autocomplete="off" readonly>
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
    try{
      const r = await fetch("/login",{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ username: u.value.trim(), password: p.value })
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
// LOGIN POST
// ======================
app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (String(username || "") !== ADMIN_USER || String(password || "") !== ADMIN_PASS) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = putToken();
  return res.send(renderDashboardHTML(token));
});

app.get("/dashboard", (req, res) => res.redirect("/login"));

// ======================
// REGISTER / HEARTBEAT
// ======================
function upsertLiveDevice(req, res) {
  try {
    const body = req.body || {};
    const rawDeviceId = safeText(body.device_id);
    if (!rawDeviceId) return res.status(400).json({ error: "device_id required" });

    const jn = safeText(body.junction_name || body.junction);
    const arm = safeText(body.arm_name);
    const finalDeviceId = arm || rawDeviceId;

    removeDuplicatesForRawDevice(rawDeviceId, finalDeviceId);
    removeConflictingFinalKey(finalDeviceId, rawDeviceId);

    const old = DEVICES.get(finalDeviceId) || {};
    const next = {
      device_id: finalDeviceId,
      raw_device_id: rawDeviceId,
      junction_name: normJunction(jn || old.junction_name),
      arm_name: normArm(arm || old.arm_name || finalDeviceId),
      lat: body.lat !== undefined ? Number(body.lat || 0) : Number(old.lat || 0),
      lng: body.lng !== undefined ? Number(body.lng || 0) : Number(old.lng || 0),
      last_seen: Date.now(),
      status: "online",
      virtual: false
    };

    DEVICES.set(finalDeviceId, next);
    ensureCloudRow(finalDeviceId);
    cleanDeadDevices();

    return res.json({ ok: true, device: next });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

app.post("/register", upsertLiveDevice);
app.post("/heartbeat", upsertLiveDevice);

// ======================
// DEVICES LIST
// ======================
app.get("/devices", (req, res) => {
  try {
    res.json(allDevicesMerged().map(d => ({
      device_id: d.device_id,
      junction_name: d.junction_name,
      arm_name: d.arm_name,
      lat: d.lat,
      lng: d.lng,
      last_seen: d.last_seen,
      status: d.status
    })));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DEBUG CLOUD
// ======================
app.get("/api/debug/cloud", (req, res) => {
  try {
    const out = [];
    for (const d of allDevicesMerged()) {
      const doc = d.virtual ? ensureVirtualCloudRow(d.device_id) : ensureCloudRow(d.device_id);
      out.push({
        device_id: d.device_id,
        junction_name: d.junction_name,
        arm_name: d.arm_name,
        status: d.status,
        virtual: !!d.virtual,
        mode: doc.mode,
        force: doc.force,
        ambulanceActive: doc.ambulanceActive,
        ambulanceArm: doc.ambulanceArm,
        ambulanceL1: doc.ambulanceL1,
        ambulanceL2: doc.ambulanceL2,
        slot: doc.slot,
        packs: doc.packs,
        v: doc.v,
        updated_at: doc.updated_at
      });
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// CLOUD HELPERS
// ======================
function getCloudStoreForDevice(dev) {
  return dev.virtual ? VIRTUAL_CLOUD : CLOUD;
}

function ensureCloudForDevice(dev) {
  return dev.virtual ? ensureVirtualCloudRow(dev.device_id) : ensureCloudRow(dev.device_id);
}

function applyMessageToDevice(doc, dev, payload, now, isSourceDevice = true) {
  const f = String(payload.force || "");

  if (f === "") {
    const s = String(payload.sig || "red");
    if (!signals.includes(s)) throw new Error("invalid sig");

    const sl = clampSlot(Number(payload.slot || 0));
    const l1 = String(payload.line1 || "");
    const l2 = String(payload.line2 || "");

    const packs = doc.packs || defaultPacks();
    packs[s] = normalizePack(packs[s]);
    packs[s][sl] = { l1, l2 };
    doc.packs = packs;

    const slotObj = doc.slot || { red: 0, amber: 0, green: 0, no: 0 };
    slotObj[s] = sl;
    doc.slot = slotObj;

    doc.mode = "auto";
    doc.force = "";
    doc.ambulanceActive = false;
    doc.ambulanceArm = "";
    doc.ambulanceL1 = "";
    doc.ambulanceL2 = "";
    doc.v = Number(doc.v || 0) + 1;
    doc.updated_at = now;
    return;
  }

  if (f === "ambulance") {
    const idx = clampSlot(Number(payload.amb_slot || 0));
    const slogans = ambulanceSlogans();
    const sourceRoad = safeText(payload.source_device_id || dev.device_id);

    doc.mode = "ambulance";
    doc.force = "ambulance";
    doc.ambulanceActive = true;
    doc.ambulanceArm = sourceRoad;
    doc.ambulanceL1 = isSourceDevice
      ? sourceRoad + " AMBULANCE COMING"
      : "AMBULANCE FROM " + sourceRoad;
    doc.ambulanceL2 = slogans[idx] || slogans[0];
    doc.v = Number(doc.v || 0) + 1;
    doc.updated_at = now;
    return;
  }

  const s = String(payload.sig || f || "red");
  if (!signals.includes(s)) throw new Error("invalid sig");

  const sl = clampSlot(Number(payload.slot || 0));
  const l1 = String(payload.line1 || "");
  const l2 = String(payload.line2 || "");

  const packs = doc.packs || defaultPacks();
  packs[s] = normalizePack(packs[s]);
  packs[s][sl] = { l1, l2 };
  doc.packs = packs;

  const slotObj = doc.slot || { red: 0, amber: 0, green: 0, no: 0 };
  slotObj[s] = sl;
  doc.slot = slotObj;

  doc.mode = "force_" + f;
  doc.force = f;
  doc.ambulanceActive = false;
  doc.ambulanceArm = "";
  doc.ambulanceL1 = "";
  doc.ambulanceL2 = "";
  doc.v = Number(doc.v || 0) + 1;
  doc.updated_at = now;
}

// ======================
// SEND MESSAGE
// ======================
app.post("/api/simple", requireAuth, (req, res) => {
  try {
    const payload = req.body || {};
    const targetType = String(payload.target_type || "device");
    const targetValue = safeText(payload.target_value || payload.device_id);
    const force = String(payload.force || "");

    if (!targetValue) {
      return res.status(400).json({ error: "target_value required" });
    }

    const now = Date.now();
    let targets = [];

    if (targetType === "device") {
      const dev = getMergedDeviceById(targetValue);
      if (!dev) return res.status(400).json({ error: "Device not found." });