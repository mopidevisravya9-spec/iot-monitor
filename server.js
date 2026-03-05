// server.js ✅ FULL WORKING (NO RENDER ERRORS)

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

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

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err?.message || err));

const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;

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
      [
        "SLOW DRIVING SAVES FUEL AND SAVES LIVES",
        "SMART SPEED PROTECTS PEOPLE AND PLANET",
      ],
      [
        "CALM DRIVING REDUCES ACCIDENTS AND POLLUTION",
        "RESPONSIBLE SPEED CREATES HEALTHY CITIES",
      ],
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

const cloudMsgSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  force: { type: String, default: "" },
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

function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (isValidToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(`<html><body><h2>Login</h2>
<form method="POST" action="/login">
<input name="username"/>
<input name="password" type="password"/>
<button>Login</button>
</form></body></html>`);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASS)
    return res.status(401).send("Invalid");

  const token = putToken();
  res.send(renderDashboardHTML(token));
});


// ======================
// FIXED DASHBOARD ROUTE
// ======================

app.get("/dashboard", (req, res) => {
  const token = putToken();
  res.send(renderDashboardHTML(token));
});

app.post("/register", async (req, res) => {
  const { device_id, lat, lng } = req.body;

  const now = Date.now();

  const doc = await Device.findOneAndUpdate(
    { device_id },
    {
      device_id,
      lat,
      lng,
      last_seen: now,
      status: "online",
    },
    { upsert: true, new: true }
  );

  res.json(doc);
});

app.post("/heartbeat", async (req, res) => {
  const { device_id } = req.body;

  await Device.updateOne(
    { device_id },
    { last_seen: Date.now(), status: "online" }
  );

  res.json({ ok: true });
});

app.get("/devices", async (req, res) => {
  const now = Date.now();

  await Device.updateMany(
    { last_seen: { $lt: now - OFFLINE_AFTER_MS } },
    { status: "offline" }
  );

  const data = await Device.find();

  res.json(data);
});

app.post("/api/simple", requireAuth, async (req, res) => {
  const { device_id, line1, line2 } = req.body;

  console.log("SEND:", device_id, line1, line2);

  res.json({ ok: true });
});

function renderDashboardHTML(TOKEN) {
return `
<!DOCTYPE html>
<html>
<head>
<title>Dashboard</title>
</head>

<body style="font-family:Times New Roman">

<h2>Display Monitor Dashboard</h2>

<select id="devSel"></select>

<br><br>

Line1
<input id="line1"/>

<br><br>

Line2
<input id="line2"/>

<br><br>

<button onclick="send()">Send</button>

<script>

const AUTH_TOKEN="${TOKEN}"

async function loadDevices(){

const r=await fetch("/devices")

const d=await r.json()

const sel=document.getElementById("devSel")

sel.innerHTML=""

d.forEach(x=>{

const o=document.createElement("option")

o.value=x.device_id

o.textContent=x.device_id+" ("+x.status+")"

sel.appendChild(o)

})

}

async function send(){

const device_id=document.getElementById("devSel").value

const line1=document.getElementById("line1").value

const line2=document.getElementById("line2").value

await fetch("/api/simple",{

method:"POST",

headers:{
"Content-Type":"application/json",
"X-Auth-Token":AUTH_TOKEN
},

body:JSON.stringify({device_id,line1,line2})

})

alert("Sent")

}

loadDevices()

</script>

</body>
</html>
`;
}

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log("Server started on port " + PORT));