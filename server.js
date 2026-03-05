// server.js
// FULL WORKING SERVER WITH JUNCTION CONTROL
// Arcadis Display Health Monitor

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
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

// ======================
// DATABASE
// ======================
const MONGO_URI = "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err));

// ======================
// CONSTANTS
// ======================
const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;

// ======================
// JUNCTION CONFIG
// ======================
const JUNCTIONS = {
  NALLAGUTTA: {
    arms: {
      "KIMS HOSPITAL": "ESP_001",
      RANIGUNJ: "ESP_002",
    },
  },
};

// ======================
// MODELS
// ======================
const deviceSchema = new mongoose.Schema({
  device_id: { type: String, unique: true },
  lat: Number,
  lng: Number,
  last_seen: Number,
  status: String,
});

const Device = mongoose.model("Device", deviceSchema);

const cloudMsgSchema = new mongoose.Schema({
  device_id: { type: String, unique: true },
  force: String,
  slot: Object,
  packs: Object,
  v: Number,
  updated_at: Number,
});

const CloudMsg = mongoose.model("CloudMsg", cloudMsgSchema);

// ======================
// MESSAGE DEFAULTS
// ======================
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

// ======================
// HELPERS
// ======================
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
  return Date.now() - dev.last_seen <= OFFLINE_AFTER_MS;
}

// ======================
// AUTH
// ======================
function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (isValidToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// LOGIN PAGE
// ======================
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(`
  <html>
  <body style="font-family:Times New Roman;background:#fff7ed;text-align:center">
  <h2>Display Health Monitor</h2>
  <form method="POST" action="/login">
  <input name="username" placeholder="Username"/><br><br>
  <input name="password" type="password" placeholder="Password"/><br><br>
  <button>Login</button>
  </form>
  </body>
  </html>
  `);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.send("Invalid login");
  }

  const token = putToken();
  res.send(renderDashboardHTML(token));
});

// ======================
// DEVICE REGISTER
// ======================
app.post("/register", async (req, res) => {
  const { device_id, lat, lng } = req.body;

  const doc = await Device.findOneAndUpdate(
    { device_id },
    {
      device_id,
      lat,
      lng,
      last_seen: Date.now(),
      status: "online",
    },
    { upsert: true, new: true }
  );

  await ensureMsgRow(device_id);
  res.json(doc);
});

// ======================
// HEARTBEAT
// ======================
app.post("/heartbeat", async (req, res) => {
  const { device_id } = req.body;

  await Device.updateOne(
    { device_id },
    { last_seen: Date.now(), status: "online" }
  );

  res.json({ ok: true });
});

// ======================
// DEVICES
// ======================
app.get("/devices", async (req, res) => {
  const now = Date.now();

  await Device.updateMany(
    { last_seen: { $lt: now - OFFLINE_AFTER_MS } },
    { status: "offline" }
  );

  const data = await Device.find();
  res.json(data);
});

// ======================
// JUNCTION LIST
// ======================
app.get("/junctions", (req, res) => {
  res.json(JUNCTIONS);
});

// ======================
// SINGLE DEVICE SEND
// ======================
app.post("/api/simple", requireAuth, async (req, res) => {
  const { device_id, sig, slot, line1, line2 } = req.body;

  const dev = await Device.findOne({ device_id });

  if (!isDeviceOnlineRow(dev)) {
    return res.json({ error: "Device offline" });
  }

  const doc = await ensureMsgRow(device_id);

  doc.packs[sig][slot] = { l1: line1, l2: line2 };
  doc.slot[sig] = slot;
  doc.v++;
  doc.updated_at = Date.now();

  await doc.save();

  res.json({ ok: true });
});

// ======================
// JUNCTION SEND
// ======================
app.post("/api/junctionSend", requireAuth, async (req, res) => {
  const { junction, arm, sig, slot, line1, line2 } = req.body;

  const j = JUNCTIONS[junction];

  if (!j) return res.json({ error: "junction not found" });

  let devices = [];

  if (arm === "ALL") {
    devices = Object.values(j.arms);
  } else {
    devices = [j.arms[arm]];
  }

  for (const device_id of devices) {
    const dev = await Device.findOne({ device_id });

    if (!isDeviceOnlineRow(dev)) continue;

    const doc = await ensureMsgRow(device_id);

    doc.packs[sig][slot] = { l1: line1, l2: line2 };
    doc.slot[sig] = slot;
    doc.v++;
    doc.updated_at = Date.now();

    await doc.save();
  }

  res.json({ ok: true });
});

// ======================
// ESP PULL
// ======================
app.get("/api/pull/:device_id", async (req, res) => {
  const doc = await ensureMsgRow(req.params.device_id);

  res.json({
    ok: true,
    packs: doc.packs,
    slot: doc.slot,
    force: doc.force,
    v: doc.v,
  });
});

// ======================
// DASHBOARD
// ======================
function renderDashboardHTML(TOKEN) {
  return `
  <html>
  <body style="font-family:Times New Roman;background:#fff7ed;padding:40px">

  <h2>Cloud Message Control</h2>

  Junction
  <select id="junctionSel"></select>

  Arm
  <select id="armSel"></select>

  <br><br>

  Line1
  <input id="line1">

  Line2
  <input id="line2">

  <br><br>

  <button onclick="send()">Send</button>

  <script>

  const TOKEN="${TOKEN}"

  async function load(){

    const r=await fetch("/junctions")
    const j=await r.json()

    const js=document.getElementById("junctionSel")

    Object.keys(j).forEach(x=>{
      const o=document.createElement("option")
      o.value=x
      o.textContent=x
      js.appendChild(o)
    })

    loadArms()

  }

  async function loadArms(){

    const r=await fetch("/junctions")
    const j=await r.json()

    const armSel=document.getElementById("armSel")

    armSel.innerHTML=""

    const all=document.createElement("option")
    all.value="ALL"
    all.textContent="ALL"
    armSel.appendChild(all)

    Object.keys(j[junctionSel.value].arms).forEach(a=>{
      const o=document.createElement("option")
      o.value=a
      o.textContent=a
      armSel.appendChild(o)
    })

  }

  junctionSel.onchange=loadArms

  async function send(){

    const payload={
      junction:junctionSel.value,
      arm:armSel.value,
      sig:"red",
      slot:0,
      line1:line1.value,
      line2:line2.value
    }

    await fetch("/api/junctionSend",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "X-Auth-Token":TOKEN
      },
      body:JSON.stringify(payload)
    })

    alert("Sent")

  }

  load()

  </script>

  </body>
  </html>
  `;
}

// ======================
// START SERVER
// ======================
const PORT = 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});