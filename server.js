const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ======================
// CONFIG
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";
const AUTH_SECRET = "arcadis_super_secret_key_change_this_2026";
const OFFLINE_AFTER_MS = 120000;
const MSG_SLOTS = 5;
const TEST_JUNCTION = "CII";
const STATE_FILE = path.join(__dirname, "state.json");
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || "";

// ======================
// HELPERS
// ======================
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
function clampSlot(n) {
  const x = Number.isFinite(n) ? n : 0;
  if (x < 0) return 0;
  if (x >= MSG_SLOTS) return MSG_SLOTS - 1;
  return x;
}
function isLiveOnline(dev) {
  if (!dev) return false;
  return Date.now() - Number(dev.last_seen || 0) <= OFFLINE_AFTER_MS;
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
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
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

// ======================
// STATE
// ======================
const DEVICES = new Map();          // canonical device_id => device row
const CLOUD = new Map();            // canonical device_id => cloud row
const VIRTUAL_DEVICES = new Map();  // virtual device_id => device row
const VIRTUAL_CLOUD = new Map();    // virtual device_id => cloud row
const DEVICE_ALIASES = new Map();   // alias(raw/final) => canonical

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

function rebuildAliases() {
  DEVICE_ALIASES.clear();
  for (const [k, d] of DEVICES.entries()) {
    DEVICE_ALIASES.set(k, k);
    if (safeText(d.raw_device_id)) DEVICE_ALIASES.set(safeText(d.raw_device_id), k);
    if (safeText(d.arm_name)) DEVICE_ALIASES.set(safeText(d.arm_name), k);
  }
  for (const [k] of VIRTUAL_DEVICES.entries()) {
    DEVICE_ALIASES.set(k, k);
  }
}

function resolveCanonicalKey(anyKey) {
  const key = safeText(anyKey);
  return DEVICE_ALIASES.get(key) || key;
}

function saveState() {
  try {
    const canonicalDevices = [...DEVICES.entries()];
    const canonicalCloud = [...CLOUD.entries()].filter(([k]) => !safeText(k).startsWith("__alias__"));
    const state = {
      devices: canonicalDevices,
      cloud: canonicalCloud
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.log("State save error:", e.message);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const state = JSON.parse(raw || "{}");
    for (const [k, v] of (state.devices || [])) DEVICES.set(k, v);
    for (const [k, v] of (state.cloud || [])) CLOUD.set(k, v);
  } catch (e) {
    console.log("State load error:", e.message);
  }
}

function cleanDeadDevices() {
  const now = Date.now();
  let changed = false;
  for (const [device_id, dev] of DEVICES.entries()) {
    if (dev.permanent) continue;
    if (now - Number(dev.last_seen || 0) > OFFLINE_AFTER_MS * 20) {
      DEVICES.delete(device_id);
      CLOUD.delete(device_id);
      changed = true;
    }
  }
  if (changed) rebuildAliases();
}

function removeDuplicatesForRawDevice(rawDeviceId, keepKey) {
  let changed = false;
  for (const [key, dev] of DEVICES.entries()) {
    if (dev.permanent) continue;
    if (key !== keepKey && safeText(dev.raw_device_id) === safeText(rawDeviceId)) {
      DEVICES.delete(key);
      CLOUD.delete(key);
      changed = true;
    }
  }
  if (changed) rebuildAliases();
}

function removeConflictingFinalKey(finalKey, rawDeviceId) {
  const existing = DEVICES.get(finalKey);
  if (!existing) return;
  if (existing.permanent) return;
  if (safeText(existing.raw_device_id) !== safeText(rawDeviceId)) {
    CLOUD.delete(finalKey);
    DEVICES.delete(finalKey);
    rebuildAliases();
  }
}

// ======================
// AUTH - STATELESS TOKEN
// ======================
function createAuthToken(username) {
  const payload = {
    u: username,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(payloadB64).digest("base64url");
  return payloadB64 + "." + sig;
}

function verifyAuthToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payloadB64, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payloadB64).digest("base64url");
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (verifyAuthToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// TEST DEVICES
// ======================
function seedVirtualDevices() {
  const now = Date.now();
  const items = [
    {
      device_id: "NAC SHILPARARAM",
      raw_device_id: "VIRTUAL_ROAD_2",
      junction_name: TEST_JUNCTION,
      arm_name: "ROAD 2",
      lat: 17.4239,
      lng: 78.3555,
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

// ======================
// REAL JUNCTIONS (PRELOAD)
// ======================
function seedRealJunctions() {
  const items = [
    {
      junction: "CP Office",
      arms: [
        { id: "R1-Gachibowli", lat: 17.434092, lng: 78.369703 },
        { id: "R2-NCB", lat: 17.434092, lng: 78.369703 }
      ]
    },
    {
      junction: "Gachibowli",
      arms: [
        { id: "R1-IIIT", lat: 17.43865798, lng: 78.36377732 },
        { id: "R2-Kondapur", lat: 17.43865798, lng: 78.36377732 },
        { id: "R3-NCB", lat: 17.43865798, lng: 78.36377732 },
        { id: "R4-ORR", lat: 17.43865798, lng: 78.36377732 }
      ]
    },
    {
      junction: "NCB",
      arms: [
        { id: "R1-Khajaguda", lat: 17.4289726, lng: 78.3746611 },
        { id: "R2-Gachibowli", lat: 17.4289726, lng: 78.3746611 },
        { id: "R3-Ikea", lat: 17.4289726, lng: 78.3746611 }
      ]
    },
    {
      junction: "Khajaguda",
      arms: [
        { id: "R1-Whispervalley", lat: 17.4225664, lng: 78.38209748 },
        { id: "R2-NCB", lat: 17.4225664, lng: 78.38209748 },
        { id: "R3-Khajaguda", lat: 17.4225664, lng: 78.38209748 }
      ]
    },
    {
      junction: "Indra Nagar",
      arms: [
        { id: "R1-IndraNagar-IIIT", lat: 17.44104, lng: 78.360121 },
        { id: "R2-IndraNagar-Gachibowli", lat: 17.44104, lng: 78.360121 }
      ]
    }
  ];

  items.forEach(j => {
    j.arms.forEach(a => {
      const device_id = a.id;
      if (!DEVICES.has(device_id)) {
        DEVICES.set(device_id, {
          device_id,
          raw_device_id: device_id,
          junction_name: j.junction,
          arm_name: device_id,
          lat: a.lat,
          lng: a.lng,
          last_seen: 0,
          status: "offline",
          virtual: false,
          permanent: true
        });
      }
      ensureCloudRow(device_id);
    });
  });
}

loadState();
seedRealJunctions();
rebuildAliases();

// ======================
// DEVICE LOOKUPS
// ======================
function allDevicesMerged() {
  cleanDeadDevices();

  const latestByRaw = new Map();

  for (const dev of DEVICES.values()) {
    if (dev.permanent) {
      latestByRaw.set(dev.device_id, dev);
      continue;
    }
    const raw = safeText(dev.raw_device_id || dev.device_id);
    const existing = latestByRaw.get(raw);
    if (!existing || Number(dev.last_seen || 0) > Number(existing.last_seen || 0)) {
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
  const key = resolveCanonicalKey(device_id);
  if (DEVICES.has(key)) {
    const d = DEVICES.get(key);
    return { ...d, status: isLiveOnline(d) ? "online" : "offline", virtual: false };
  }
  if (VIRTUAL_DEVICES.has(key)) {
    return { ...VIRTUAL_DEVICES.get(key), status: "online", virtual: true };
  }
  return null;
}

function getDevicesByJunction(junction_name) {
  return allDevicesMerged().filter(d => d.junction_name === junction_name);
}

// ======================
// CLOUD HELPERS
// ======================
function getCloudStoreForDevice(dev) {
  return dev.virtual ? VIRTUAL_CLOUD : CLOUD;
}
function ensureCloudForDevice(dev) {
  return dev.virtual ? ensureVirtualCloudRow(dev.device_id) : ensureCloudRow(dev.device_id);
}
function writeCloudForDevice(dev, doc) {
  if (dev.virtual) {
    VIRTUAL_CLOUD.set(dev.device_id, doc);
    return;
  }
  CLOUD.set(dev.device_id, doc);
  if (safeText(dev.raw_device_id) && safeText(dev.raw_device_id) !== safeText(dev.device_id)) {
    DEVICE_ALIASES.set(safeText(dev.raw_device_id), dev.device_id);
  }
  if (safeText(dev.arm_name) && safeText(dev.arm_name) !== safeText(dev.device_id)) {
    DEVICE_ALIASES.set(safeText(dev.arm_name), dev.device_id);
  }
}

function applyMessageToDevice(doc, dev, payload, now, isSourceDevice = true) {
  const f = String(payload.force || "");

  if (f === "") {
    const s = String(payload.sig || "red");
    if (!signals.includes(s)) throw new Error("invalid sig");

    const sl = clampSlot(Number(payload.slot || 0));
    const l1 = String(payload.line1 || "");
    const l2 = String(payload.line2 || "");

    const packs = deepClone(doc.packs || defaultPacks());
    packs[s] = normalizePack(packs[s]);
    packs[s][sl] = { l1, l2 };

    const slotObj = { ...(doc.slot || { red: 0, amber: 0, green: 0, no: 0 }) };
    slotObj[s] = sl;

    doc.packs = packs;
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
    const ambText = safeText(payload.amb_text) || slogans[idx] || "";

    doc.mode = "ambulance";
    doc.force = "ambulance";
    doc.ambulanceActive = true;
    doc.ambulanceArm = sourceRoad;
    doc.ambulanceL1 = isSourceDevice
      ? sourceRoad + " AMBULANCE COMING"
      : "AMBULANCE FROM " + sourceRoad;
    doc.ambulanceL2 = ambText;
    doc.v = Number(doc.v || 0) + 1;
    doc.updated_at = now;
    return;
  }

  const s = String(payload.sig || f || "red");
  if (!signals.includes(s)) throw new Error("invalid sig");

  const sl = clampSlot(Number(payload.slot || 0));
  const l1 = String(payload.line1 || "");
  const l2 = String(payload.line2 || "");

  const packs = deepClone(doc.packs || defaultPacks());
  packs[s] = normalizePack(packs[s]);
  packs[s][sl] = { l1, l2 };

  const slotObj = { ...(doc.slot || { red: 0, amber: 0, green: 0, no: 0 }) };
  slotObj[s] = sl;

  doc.packs = packs;
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
// KEEP ALIVE
// ======================
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL.replace(/\/$/, "") + "/api/ping").catch(() => {});
  }, 240000);
}

// ======================
// HOME / LOGIN / DASHBOARD
// ======================
app.get("/", (req, res) => res.redirect("/login"));

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

  const saved = localStorage.getItem("arcadis_token");
  if (saved) {
    fetch("/api/session-check", { headers: { "X-Auth-Token": saved } })
      .then(r => { if (r.ok) location.href="/dashboard"; else localStorage.removeItem("arcadis_token"); })
      .catch(()=>{});
  }

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    err.textContent = "";
    try{
      const r = await fetch("/login",{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ username: u.value.trim(), password: p.value })
      });
      const out = await r.json().catch(()=>({}));
      if(!r.ok){
        err.textContent = out.error || "Invalid login";
        return;
      }
      localStorage.setItem("arcadis_token", out.token);
      location.href = "/dashboard";
    }catch(e){
      err.textContent = "Network error";
    }
  });
</script>
</body>
</html>`);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (String(username || "") !== ADMIN_USER || String(password || "") !== ADMIN_PASS) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = createAuthToken(username);
  return res.json({ ok: true, token });
});

app.get("/api/session-check", requireAuth, (req, res) => {
  res.json({ ok: true });
});

app.get("/dashboard", (req, res) => {
  res.send(renderDashboardHTML());
});

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

    const old = DEVICES.get(finalDeviceId) || { permanent: false };
    const next = {
      device_id: finalDeviceId,
      raw_device_id: rawDeviceId,
      junction_name: normJunction(jn || old.junction_name),
      arm_name: normArm(arm || old.arm_name || finalDeviceId),
      lat: body.lat !== undefined ? Number(body.lat || 0) : Number(old.lat || 0),
      lng: body.lng !== undefined ? Number(body.lng || 0) : Number(old.lng || 0),
      last_seen: Date.now(),
      status: "online",
      virtual: false,
      permanent: old.permanent === true
    };

    DEVICES.set(finalDeviceId, next);
    ensureCloudRow(finalDeviceId);
    rebuildAliases();
    cleanDeadDevices();
    saveState();

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
      status: d.status,
      virtual: !!d.virtual
    })));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

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

      if (force === "ambulance" || force === "") {
        targets = getDevicesByJunction(dev.junction_name);
      } else {
        targets = [dev];
      }
    } else if (targetType === "junction") {
      targets = getDevicesByJunction(targetValue);
      if (!targets.length) {
        return res.status(400).json({ error: "No devices found in selected junction." });
      }
    } else {
      return res.status(400).json({ error: "invalid target_type" });
    }

    if (force === "ambulance" && payload.source_device_id) {
      const sourceDev = getMergedDeviceById(String(payload.source_device_id));
      if (!sourceDev) {
        return res.status(400).json({ error: "Source device not found." });
      }
      targets = getDevicesByJunction(sourceDev.junction_name);
      if (!targets.length) {
        return res.status(400).json({ error: "No devices found in source junction." });
      }
    }

    const uniqueByDevice = new Map();
    for (const dev of targets) uniqueByDevice.set(dev.device_id, dev);
    targets = [...uniqueByDevice.values()];

    let onlineCount = 0;
    let offlineCount = 0;

    for (const dev of targets) {
      if (dev.status === "online") onlineCount++;
      else offlineCount++;

      const doc = ensureCloudForDevice(dev);
      applyMessageToDevice(
        doc,
        dev,
        payload,
        now,
        String(dev.device_id) === String(payload.source_device_id || "")
      );
      writeCloudForDevice(dev, doc);
    }

    saveState();

    res.json({
      ok: true,
      updated_devices: targets.map(d => d.device_id),
      count: targets.length,
      online_count: onlineCount,
      offline_count: offlineCount
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// ESP PULL - ONLY ONE ROUTE
// ======================
app.get("/api/pull/:device_id", (req, res) => {
  try {
    const requestedKey = safeText(req.params.device_id);
    const key = resolveCanonicalKey(requestedKey);
    const since = Number(req.query.since || 0);

    const doc = ensureCloudRow(key);
    const v = Number(doc.v || 0);

    if (since >= v) {
      return res.json({ ok: true, changed: false, v });
    }

    res.json({
      ok: true,
      changed: true,
      device_id: key,
      v,
      mode: doc.mode || "auto",
      force: doc.force || "",
      slot: doc.slot || { red: 0, amber: 0, green: 0, no: 0 },
      packs: doc.packs || defaultPacks(),
      slots: MSG_SLOTS,
      updated_at: doc.updated_at || 0,
      ambulanceActive: !!doc.ambulanceActive,
      ambulanceArm: doc.ambulanceArm || "",
      ambulanceL1: doc.ambulanceL1 || "",
      ambulanceL2: doc.ambulanceL2 || ""
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DASHBOARD HTML
// ======================
function renderDashboardHTML() {
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
    width:320px;min-width:320px;background:var(--card);
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
  .tabBtn.active{
    background:linear-gradient(135deg,var(--orange),var(--orange2));
    color:#fff;border-color:var(--orange2);
    box-shadow:0 10px 22px rgba(249,115,22,.25);
  }
  .treeBox{
    margin-top:12px;border:1px solid var(--border);border-radius:14px;
    background:#fffaf5;padding:10px;
  }
  .treeTitle{font-weight:900;margin-bottom:8px}
  .jBtn,.dBtn{
    width:100%;text-align:left;padding:10px 12px;border-radius:12px;
    border:1px solid var(--border);background:#fff;cursor:pointer;font-weight:900;
  }
  .jBtn{margin-top:8px}
  .dBtn{margin-top:8px;font-weight:800}
  .indent{padding-left:12px;margin-top:6px}
  .selectedTarget{
    border:2px solid #f97316 !important;
    background:#fff1e6 !important;
  }
  .smallNote{margin-top:8px;font-size:12px;color:var(--muted);font-weight:800}
  .footer{margin-top:auto;padding:10px 10px 4px 10px;font-size:12px;color:var(--muted);font-weight:900}
  .content{
    flex:1;display:flex;flex-direction:column;background:var(--card);
    border:1px solid var(--border);border-radius:16px;overflow:hidden;
    box-shadow:0 10px 26px rgba(17,24,39,.08);position:relative;
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
  }
  .iconBtn svg{width:20px;height:20px;fill:#fff}
  .cards{
    display:flex;gap:10px;padding:10px;border-bottom:1px solid var(--border);
    background:#fff;flex-wrap:wrap;
  }
  .card{
    flex:0 0 240px;border:1px solid var(--border);border-radius:14px;background:#fff;padding:10px 12px;
  }
  .card .k{font-size:11px;color:var(--muted);font-weight:900;letter-spacing:.6px}
  .card .v{font-size:22px;font-weight:900;margin-top:6px}
  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}
  #map{flex:1}
  .pad{padding:12px}
  .panel{max-width:1100px;border:1px solid var(--border);border-radius:16px;padding:14px;background:#fff}
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

    <div class="tabBtn active" id="tabMapBtn">MAP</div>
    <div class="tabBtn" id="tabMsgBtn">MESSAGES</div>

    <div id="treeContainer" class="treeBox" style="display:none">
      <div class="treeTitle">Junctions (Live)</div>
      <div id="treeBody"></div>

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
              <div class="statusLine" id="currentLine">Current: -</div>
            </div>
            <div>
              <div class="lbl">Force</div>
              <select id="forceSel"></select>
            </div>
          </div>

          <div class="grid" id="normalGrid">
            <div>
              <div class="lbl">Signal group</div>
              <select id="sigSel"></select>
            </div>
            <div>
              <div class="lbl">Slot</div>
              <select id="slotSel"></select>
            </div>
          </div>

          <div class="grid" id="ambulanceGrid" style="display:none">
            <div>
              <div class="lbl">Ambulance slogan</div>
              <select id="ambSel"></select>
            </div>
            <div>
              <div class="lbl">Edit ambulance preview / slogan</div>
              <input id="ambPreview" />
            </div>
          </div>

          <div class="grid" id="lineGrid">
            <div>
              <div class="lbl">Line 1</div>
              <input id="line1" placeholder="Line 1" />
            </div>
            <div>
              <div class="lbl">Line 2</div>
              <input id="line2" placeholder="Line 2" />
            </div>
          </div>

          <div class="row">
            <button class="sendBtn" id="sendBtn">Send to ESP</button>
          </div>

          <div class="statusLine" id="statusTxt">Status: Ready <span class="ok">✓</span></div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  const AUTH_TOKEN = localStorage.getItem("arcadis_token");
  if (!AUTH_TOKEN) location.href = "/login";

  const ambulanceSlogans = ${JSON.stringify(ambulanceSlogans())};

  const tabMapBtn = document.getElementById("tabMapBtn");
  const tabMsgBtn = document.getElementById("tabMsgBtn");
  const viewMap = document.getElementById("viewMap");
  const viewMsg = document.getElementById("viewMsg");
  const treeContainer = document.getElementById("treeContainer");
  const treeBody = document.getElementById("treeBody");

  const devSel = document.getElementById("devSel");
  const sigSel = document.getElementById("sigSel");
  const slotSel = document.getElementById("slotSel");
  const line1 = document.getElementById("line1");
  const line2 = document.getElementById("line2");
  const forceSel = document.getElementById("forceSel");
  const statusTxt = document.getElementById("statusTxt");
  const currentLine = document.getElementById("currentLine");
  const sendBtn = document.getElementById("sendBtn");
  const normalGrid = document.getElementById("normalGrid");
  const ambulanceGrid = document.getElementById("ambulanceGrid");
  const lineGrid = document.getElementById("lineGrid");
  const ambSel = document.getElementById("ambSel");
  const ambPreview = document.getElementById("ambPreview");

  let DEVICE_CACHE = [];
  let expandedJunction = null;
  let selectedTargetType = "device";
  let selectedTargetValue = "";
  let selectedSourceDevice = "";

  function logout() {
    localStorage.removeItem("arcadis_token");
    location.href = "/login";
  }

  async function secureFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {}, { "X-Auth-Token": AUTH_TOKEN });
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem("arcadis_token");
      location.href = "/login";
      throw new Error("Unauthorized");
    }
    return res;
  }

  secureFetch("/api/session-check").catch(()=>{});

  function setStatus(text, ok) {
    statusTxt.innerHTML = "Status: " + text + (ok ? " <span class='ok'>✓</span>" : " <span class='bad'>✗</span>");
  }

  function showTab(which) {
    tabMapBtn.classList.toggle("active", which === "map");
    tabMsgBtn.classList.toggle("active", which === "msg");
    viewMap.classList.toggle("active", which === "map");
    viewMsg.classList.toggle("active", which === "msg");
    treeContainer.style.display = which === "msg" ? "block" : "none";
    if (which === "map") setTimeout(() => map.invalidateSize(), 150);
  }

  tabMapBtn.addEventListener("click", () => showTab("map"));
  tabMsgBtn.addEventListener("click", () => {
    showTab("msg");
    buildTree();
  });

  const map = L.map('map').setView([17.3850,78.4867], 12);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();
  function pinIcon(status, virtual){
    const fill = virtual ? "#2563eb" : (status === "online" ? "#16a34a" : "#dc2626");
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
    {k:"red", name:"RED → STOP"},
    {k:"amber", name:"AMBER → WAIT"},
    {k:"green", name:"GREEN → GO"},
    {k:"no", name:"NO SIGNAL"}
  ];

  function currentDeviceRow(device_id) {
    return DEVICE_CACHE.find(d => d.device_id === device_id) || null;
  }

  function updateCurrentLine() {
    if (selectedTargetType === "junction") {
      currentLine.innerHTML = "Current: <b>JUNCTION</b> | <b>" + selectedTargetValue + "</b>";
      return;
    }
    const d = currentDeviceRow(devSel.value);
    if (!d) {
      currentLine.textContent = "Current: -";
      return;
    }
    currentLine.innerHTML =
      "Current: <b>" + d.device_id + "</b> | <b>" + d.status.toUpperCase() + "</b> | " + d.junction_name +
      (d.virtual ? " | TEST" : "");
  }

  function fillForceOptions() {
    forceSel.innerHTML = "";
    [
      {v:"", t:"AUTO"},
      {v:"red", t:"RED"},
      {v:"amber", t:"AMBER"},
      {v:"green", t:"GREEN"},
      {v:"ambulance", t:"AMBULANCE"}
    ].forEach(x=>{
      const o = document.createElement("option");
      o.value = x.v;
      o.textContent = x.t;
      forceSel.appendChild(o);
    });
  }

  function fillSigOptions() {
    sigSel.innerHTML = "";
    SIGS.forEach(s => {
      const o = document.createElement("option");
      o.value = s.k;
      o.textContent = s.name;
      sigSel.appendChild(o);
    });
  }

  function fillSlotOptions() {
    const sig = sigSel.value;
    slotSel.innerHTML = "";
    for (let i = 0; i < MSG_SLOTS; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      const t = templates[sig]?.[i]?.l1 || ("Message " + (i + 1));
      o.textContent = (i + 1) + ". " + t;
      slotSel.appendChild(o);
    }
  }

  function autofillLines() {
    const sig = sigSel.value;
    const sl = Number(slotSel.value || 0);
    const t = templates[sig]?.[sl] || { l1:"", l2:"" };
    line1.value = t.l1 || "";
    line2.value = t.l2 || "";
  }

  function fillAmbulanceOptions() {
    ambSel.innerHTML = "";
    ambulanceSlogans.forEach((s, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = (i + 1) + ". " + s;
      ambSel.appendChild(o);
    });
  }

  function updateAmbPreview() {
    ambPreview.value = ambulanceSlogans[Number(ambSel.value || 0)] || "";
  }

  forceSel.addEventListener("change", () => {
    const f = forceSel.value || "";
    if (f === "ambulance") {
      normalGrid.style.display = "none";
      lineGrid.style.display = "none";
      ambulanceGrid.style.display = "grid";
      updateAmbPreview();
    } else {
      ambulanceGrid.style.display = "none";
      normalGrid.style.display = "grid";
      lineGrid.style.display = "grid";
    }
  });

  sigSel.addEventListener("change", () => {
    fillSlotOptions();
    autofillLines();
  });

  slotSel.addEventListener("change", autofillLines);
  ambSel.addEventListener("change", updateAmbPreview);

  devSel.addEventListener("change", () => {
    selectedTargetType = "device";
    selectedTargetValue = devSel.value;
    selectedSourceDevice = devSel.value;
    updateCurrentLine();
    buildTree();
  });

  line1.addEventListener("focus", () => setStatus("Editing Line 1", true));
  line2.addEventListener("focus", () => setStatus("Editing Line 2", true));
  ambPreview.addEventListener("focus", () => setStatus("Editing Ambulance Preview", true));

  function buildTree() {
    treeBody.innerHTML = "";
    if (!DEVICE_CACHE.length) return;

    const grouped = {};
    DEVICE_CACHE.forEach(d => {
      const j = d.junction_name || "Junction Not Sent";
      if (!grouped[j]) grouped[j] = [];
      grouped[j].push(d);
    });

    Object.keys(grouped).sort().forEach(junction => {
      const jBtn = document.createElement("button");
      jBtn.className = "jBtn";
      if (selectedTargetType === "junction" && selectedTargetValue === junction) {
        jBtn.classList.add("selectedTarget");
      }
      jBtn.textContent = junction + (expandedJunction === junction ? " ▲" : " ▼");
      jBtn.onclick = () => {
        selectedTargetType = "junction";
        selectedTargetValue = junction;
        selectedSourceDevice = "";
        expandedJunction = expandedJunction === junction ? null : junction;
        updateCurrentLine();
        buildTree();
      };
      treeBody.appendChild(jBtn);

      if (expandedJunction === junction) {
        const wrap = document.createElement("div");
        wrap.className = "indent";

        grouped[junction]
          .sort((a,b)=>(a.device_id || "").localeCompare(b.device_id || ""))
          .forEach(dev => {
            const dBtn = document.createElement("button");
            dBtn.className = "dBtn";
            if (selectedTargetType === "device" && selectedTargetValue === dev.device_id) {
              dBtn.classList.add("selectedTarget");
            }
            dBtn.textContent = dev.device_id + " (" + dev.status + ")" + (dev.virtual ? " [TEST]" : "");
            dBtn.onclick = () => {
              selectedTargetType = "device";
              selectedTargetValue = dev.device_id;
              selectedSourceDevice = dev.device_id;
              devSel.value = dev.device_id;
              updateCurrentLine();
              buildTree();
              showTab("msg");
            };
            wrap.appendChild(dBtn);
          });

        treeBody.appendChild(wrap);
      }
    });
  }

  async function loadDevices(forceRefresh) {
    try {
      const res = await fetch("/devices", { cache: forceRefresh ? "no-store" : "default" });
      const data = await res.json();
      DEVICE_CACHE = Array.isArray(data) ? data : [];

      let on = 0, off = 0;
      DEVICE_CACHE.forEach(d => (d.status === "online" ? on++ : off++));
      document.getElementById("total").innerText = DEVICE_CACHE.length;
      document.getElementById("on").innerText = on;
      document.getElementById("off").innerText = off;

      const existingKeys = new Set();

      DEVICE_CACHE.forEach(d => {
        existingKeys.add(d.device_id);
        const virtual = d.virtual === true;
        const pos = [d.lat || 0, d.lng || 0];
        const icon = pinIcon(d.status, virtual);
        const pop =
          "<b>" + d.device_id + "</b>" +
          "<br>Junction: <b>" + d.junction_name + "</b>" +
          "<br>Arm: <b>" + d.arm_name + "</b>" +
          "<br>Status: <b style='color:" + (d.status === "online" ? "#16a34a" : "#dc2626") + "'>" + d.status + "</b>" +
          (virtual ? "<br><b style='color:#2563eb'>TEST DEVICE</b>" : "") +
          "<br>Last seen: " + new Date(d.last_seen || 0).toLocaleString();

        if (markers.has(d.device_id)) {
          markers.get(d.device_id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
        } else {
          const m = L.marker(pos, { icon }).addTo(map).bindPopup(pop);
          markers.set(d.device_id, m);
        }
      });

      for (const key of [...markers.keys()]) {
        if (!existingKeys.has(key)) {
          map.removeLayer(markers.get(key));
          markers.delete(key);
        }
      }

      const cur = devSel.value;
      devSel.innerHTML = "";
      DEVICE_CACHE.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")" + (d.virtual ? " [TEST]" : "");
        devSel.appendChild(opt);
      });

      if (cur && DEVICE_CACHE.some(d => d.device_id === cur)) {
        devSel.value = cur;
      } else if (DEVICE_CACHE[0]) {
        devSel.value = DEVICE_CACHE[0].device_id;
      }

      if (!selectedTargetValue && DEVICE_CACHE[0]) {
        selectedTargetType = "device";
        selectedTargetValue = DEVICE_CACHE[0].device_id;
        selectedSourceDevice = DEVICE_CACHE[0].device_id;
      }

      updateCurrentLine();
      if (viewMsg.classList.contains("active")) buildTree();
    } catch (e) {}
  }

  async function sendToESP() {
    let targetType = selectedTargetType || "device";
    let targetValue = selectedTargetValue || devSel.value;

    if (!targetValue) {
      setStatus("No target selected", false);
      return;
    }

    const f = forceSel.value || "";
    let payload = {
      target_type: targetType,
      target_value: targetValue,
      force: f
    };

    if (f === "ambulance") {
      const sourceDev = selectedSourceDevice || devSel.value;
      if (!sourceDev) {
        setStatus("Select source device for ambulance", false);
        return;
      }
      payload.source_device_id = sourceDev;
      payload.amb_slot = Number(ambSel.value || 0);
      payload.amb_text = ambPreview.value || "";
    } else {
      payload.sig = sigSel.value;
      payload.slot = Number(slotSel.value || 0);
      payload.line1 = line1.value || "";
      payload.line2 = line2.value || "";
    }

    setStatus("Sending...", true);

    try {
      const r = await secureFetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });

      const out = await r.json().catch(() => ({}));

      if (!r.ok) {
        setStatus(out.error || "Send failed", false);
        return;
      }

      if (f === "ambulance") {
        setStatus("Sent | Ambulance active | " + (out.online_count || 0) + " online, " + (out.offline_count || 0) + " queued", true);
      } else if (f === "") {
        setStatus("Sent | Auto | " + (out.online_count || 0) + " online, " + (out.offline_count || 0) + " queued", true);
      } else {
        setStatus("Sent | " + (out.online_count || 0) + " online, " + (out.offline_count || 0) + " queued", true);
      }
    } catch (e) {
      setStatus("Network error", false);
    }
  }

  sendBtn.addEventListener("click", sendToESP);

  fillForceOptions();
  fillSigOptions();
  fillSlotOptions();
  fillAmbulanceOptions();
  autofillLines();
  updateAmbPreview();

  showTab("map");
  loadDevices(true);
  setInterval(() => loadDevices(false), 2000);
  setInterval(() => { secureFetch("/api/session-check").catch(()=>{}); }, 30000);

  const img = document.getElementById("arcLogo");
  img.addEventListener("error", () => {
    if (img.src.endsWith("/arcadis.png")) img.src = "/image.png";
    else if (img.src.endsWith("/image.png")) img.src = "/logo.png";
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