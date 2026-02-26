const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

// ======================
// STATIC ASSETS (LOGO)
// ======================
// This makes: https://yourdomain.com/assets/image.png work
app.use("/assets", express.static(path.join(__dirname, "assets")));

// ======================
// SIMPLE LOGIN (NO EXTRA PACKAGES)
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

// in-memory sessions (will reset if Render restarts; OK for simple login)
const sessions = new Map(); // token -> { user, createdAt }
const COOKIE_NAME = "arcadis_session";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((p) => {
    const idx = p.indexOf("=");
    if (idx > -1) out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token || !sessions.has(token)) {
    return res.redirect("/login");
  }
  next();
}

// ======================
// DATABASE (Local + Render)
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Error:", err));

// ======================
// MODEL
// ======================
const deviceSchema = new mongoose.Schema({
  device_id: { type: String, unique: true, required: true },
  lat: { type: Number, default: 0 },
  lng: { type: Number, default: 0 },
  last_seen: { type: Number, default: 0 },
  status: { type: String, default: "offline" }
});

const Device = mongoose.model("Device", deviceSchema);

// ======================
// HEALTH + VERSION (for checking Render updated)
// ======================
const BUILD_STAMP = new Date().toISOString();

app.get("/", (req, res) => res.send("Server Running"));
app.get("/version", (req, res) => res.json({ ok: true, build: BUILD_STAMP }));

// ======================
// LOGIN PAGES / API
// ======================
app.get("/login", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Arcadis Login</title>
<style>
  :root{
    --bg1:#0b1a2a; --bg2:#071422;
    --card:rgba(255,255,255,.08);
    --stroke:rgba(255,255,255,.14);
    --txt:#eaf2ff; --muted:rgba(234,242,255,.70);
    --brand:#ff7a18;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;color:var(--txt)}
  body{
    background: radial-gradient(900px 500px at 15% 15%, rgba(255,122,24,.25), transparent 60%),
                radial-gradient(700px 500px at 85% 70%, rgba(43,140,255,.22), transparent 60%),
                linear-gradient(180deg, var(--bg1), var(--bg2));
    display:flex;align-items:center;justify-content:center;padding:18px;
  }
  .card{
    width:min(420px, 95vw);
    background:var(--card);
    border:1px solid var(--stroke);
    border-radius:22px;
    box-shadow:0 18px 60px rgba(0,0,0,.40);
    padding:18px 18px 14px;
    backdrop-filter: blur(10px);
    animation: pop .35s ease-out;
  }
  @keyframes pop{from{transform:scale(.97);opacity:.6}to{transform:scale(1);opacity:1}}
  .top{display:flex;align-items:center;gap:12px}
  .logo{
    width:46px;height:46px;border-radius:14px;
    background:rgba(255,122,24,.18);
    border:1px solid rgba(255,122,24,.35);
    display:flex;align-items:center;justify-content:center;
    font-weight:900;color:var(--brand);letter-spacing:.5px;
  }
  .title{font-size:18px;font-weight:900}
  .sub{font-size:12px;color:var(--muted);margin-top:2px}
  .field{margin-top:14px}
  label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
  input{
    width:100%;padding:12px 12px;border-radius:14px;
    border:1px solid var(--stroke);
    background:rgba(0,0,0,.22);color:var(--txt);outline:none;
  }
  button{
    width:100%;margin-top:14px;
    padding:12px 12px;border-radius:14px;
    border:1px solid rgba(255,122,24,.55);
    background:linear-gradient(180deg, rgba(255,122,24,.95), rgba(255,122,24,.75));
    color:#111;font-weight:900;cursor:pointer;
  }
  .err{margin-top:10px;font-size:12px;color:#ffb4b4;min-height:16px}
  .foot{margin-top:12px;font-size:11px;color:var(--muted);text-align:center}
</style>
</head>
<body>
  <div class="card">
    <div class="top">
      <div class="logo">A</div>
      <div>
        <div class="title">Arcadis Display Monitor</div>
        <div class="sub">Secure access required</div>
      </div>
    </div>

    <div class="field">
      <label>Username</label>
      <input id="u" placeholder="admin" autocomplete="username"/>
    </div>
    <div class="field">
      <label>Password</label>
      <input id="p" type="password" placeholder="admin123" autocomplete="current-password"/>
    </div>

    <button onclick="login()">Login</button>
    <div class="err" id="err"></div>

    <div class="foot">Powered by Arcadis</div>
  </div>

<script>
async function login(){
  const u = document.getElementById('u').value.trim();
  const p = document.getElementById('p').value.trim();
  document.getElementById('err').textContent = "";

  const res = await fetch('/api/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username:u, password:p })
  });

  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    document.getElementById('err').textContent = data.error || "Login failed";
    return;
  }
  window.location.href = "/dashboard";
}
</script>
</body>
</html>`);
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { user: "admin", createdAt: Date.now() });

  // cookie for dashboard + devices API (same domain)
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
  );
  res.json({ ok: true });
});

app.get("/logout", (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (token) sessions.delete(token);

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  );
  res.redirect("/login");
});

// ======================
// REGISTER (ESP / TEST)
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
          status: "online"
        }
      },
      { upsert: true, new: true }
    );

    res.json({ message: "Registered", device: doc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// HEARTBEAT (ESP)
// ======================
app.post("/heartbeat", async (req, res) => {
  try {
    const { device_id } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();
    await Device.findOneAndUpdate(
      { device_id },
      { $set: { last_seen: now, status: "online" } },
      { upsert: true, new: true }
    );

    res.json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DEVICES (AUTO-OFFLINE FAST)
// Protected: only after login
// ======================
app.get("/devices", requireAuth, async (req, res) => {
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
// DASHBOARD (LEFT TABS + MAP + CONTROL + LOGO)
// Protected: only after login
// ======================
app.get("/dashboard", requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Arcadis Display Monitor</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  :root{
    --bg:#0b1a2a;
    --panel:#ffffff;
    --side:#f4f6f8;
    --stroke:#d9e1ea;
    --txt:#0f172a;
    --muted:#5b6472;
    --blue:#1f75ff;
    --green:#22c55e;
    --red:#ef4444;
    --orange:#ff7a18;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:#e9eef5;color:var(--txt)}
  .app{height:100%;display:grid;grid-template-columns:240px 1fr;grid-template-rows:64px 1fr}
  .topbar{
    grid-column:1/3;grid-row:1;
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 14px;background:#fff;border-bottom:1px solid var(--stroke);
  }
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{height:34px}
  .brand .t{font-weight:900;letter-spacing:.2px}
  .brand .s{font-size:12px;color:var(--muted)}
  .right{display:flex;align-items:center;gap:10px}
  .pill{
    padding:8px 10px;border:1px solid var(--stroke);
    border-radius:999px;background:#fff;font-size:12px;color:var(--muted)
  }
  .btn{
    padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);
    background:#fff;font-weight:800;cursor:pointer;text-decoration:none;color:var(--txt)
  }

  .side{
    grid-column:1;grid-row:2;background:var(--side);
    border-right:1px solid var(--stroke);
    padding:12px 10px;display:flex;flex-direction:column;gap:10px;
  }
  .tab{
    padding:12px 12px;border-radius:10px;cursor:pointer;
    border:1px solid transparent;font-weight:800;color:#223;
    background:transparent;
  }
  .tab.active{background:#fff;border-color:var(--stroke)}
  .tab small{display:block;font-weight:600;color:var(--muted);margin-top:4px}
  .cards{
    display:grid;grid-template-columns:repeat(3, minmax(140px, 1fr));
    gap:10px;margin-top:6px;
  }
  .card{
    background:#fff;border:1px solid var(--stroke);border-radius:12px;
    padding:10px 12px;
  }
  .label{font-size:12px;color:var(--muted);font-weight:700}
  .n{font-size:22px;font-weight:900;margin-top:4px}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%}
  .dot.g{background:var(--green)} .dot.r{background:var(--red)}

  .main{grid-column:2;grid-row:2;position:relative}
  .view{display:none;height:100%}
  .view.active{display:block}
  #map{height:100%}

  /* Control panel */
  .wrap{max-width:980px;margin:14px auto;padding:0 14px}
  .panel{
    background:#fff;border:1px solid var(--stroke);border-radius:14px;
    padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.06);
  }
  .h{font-size:16px;font-weight:900}
  .p{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.4}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
  .grid1{display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px}
  input,select,button{
    width:100%;padding:12px;border-radius:12px;border:1px solid var(--stroke);
    outline:none;background:#fff;
  }
  button{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:900;cursor:pointer}
  .codebox{
    border:1px solid var(--stroke);border-radius:12px;padding:10px;
    background:#0b1220;color:#dbeafe;font-family:Consolas,monospace;font-size:12px;
    white-space:pre-wrap;
  }
  .btnRow{display:flex;gap:10px;flex-wrap:wrap}
  .btn2{
    display:inline-block;padding:10px 12px;border-radius:12px;
    border:1px solid var(--stroke);background:#fff;font-weight:900;text-decoration:none;color:var(--txt)
  }

  /* Bottom-left logo */
  .powered{
    position:absolute;left:12px;bottom:12px;
    display:flex;align-items:center;gap:10px;
    background:rgba(255,255,255,.95);
    border:1px solid var(--stroke);
    border-radius:12px;padding:8px 10px;
    box-shadow:0 10px 24px rgba(0,0,0,.10);
  }
  .powered img{height:24px}
  .powered span{font-size:12px;color:var(--muted);font-weight:800}

  @media(max-width:900px){
    .app{grid-template-columns:200px 1fr}
    .cards{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="app">
  <div class="topbar">
    <div class="brand">
      <img src="/assets/image.png" onerror="this.style.display='none'"/>
      <div>
        <div class="t">ARCADIS</div>
        <div class="s">Live display monitoring & control</div>
      </div>
    </div>

    <div class="right">
      <div class="pill">Build: ${BUILD_STAMP}</div>
      <a class="btn" href="/logout">Logout</a>
    </div>
  </div>

  <div class="side">
    <div class="tab active" id="tMap" onclick="showTab('map')">
      Map
      <small>Device status view</small>
    </div>
    <div class="tab" id="tCtl" onclick="showTab('ctl')">
      Control
      <small>Generate ESP links</small>
    </div>

    <div class="cards">
      <div class="card">
        <div class="label">Total Devices</div>
        <div class="n" id="total">0</div>
      </div>
      <div class="card">
        <div class="label"><span class="dot g"></span> Online</div>
        <div class="n" id="on">0</div>
      </div>
      <div class="card">
        <div class="label"><span class="dot r"></span> Offline</div>
        <div class="n" id="off">0</div>
      </div>
    </div>

    <div class="card" style="margin-top:10px">
      <div class="label">Refresh</div>
      <div class="n" style="font-size:14px;font-weight:900">1 second</div>
      <div class="label" style="margin-top:6px">Offline rule: 5 sec no heartbeat</div>
    </div>
  </div>

  <div class="main">
    <div class="view active" id="viewMap"><div id="map"></div></div>

    <div class="view" id="viewCtl">
      <div class="wrap">
        <div class="panel">
          <div class="h">Control tab (NO ESP code changes)</div>
          <div class="p">
            Your ESP has <b>/set</b> and <b>/force</b>. These links work only when your laptop/phone is connected to that ESP Wi-Fi (<b>ARCADIS_DISPLAY</b>) or same LAN.
          </div>

          <div class="grid">
            <div>
              <div class="p" style="margin:0 0 6px">Select Device</div>
              <select id="deviceSelect"></select>
            </div>
            <div>
              <div class="p" style="margin:0 0 6px">ESP Local IP</div>
              <input id="espIp" value="192.168.4.1" placeholder="192.168.4.1"/>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="p" style="margin:0 0 6px">Signal Type</div>
              <select id="type">
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <div class="p" style="margin:0 0 6px">Force Signal (optional)</div>
              <select id="force">
                <option value="">No Force</option>
                <option value="red">Force RED</option>
                <option value="amber">Force AMBER</option>
                <option value="green">Force GREEN</option>
              </select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="p" style="margin:0 0 6px">Message Line 1</div>
              <input id="msg1" placeholder="Enter line 1"/>
            </div>
            <div>
              <div class="p" style="margin:0 0 6px">Message Line 2</div>
              <input id="msg2" placeholder="Enter line 2"/>
            </div>
          </div>

          <div class="grid1">
            <button onclick="buildLinks()">Generate Control Links</button>
            <div class="btnRow" id="buttons"></div>
            <div class="codebox" id="out">Links will appear here...</div>
          </div>
        </div>
      </div>
    </div>

    <div class="powered">
      <img src="/assets/image.png" onerror="this.style.display='none'"/>
      <span>Powered by Arcadis</span>
    </div>
  </div>
</div>

<script>
  function showTab(which){
    document.getElementById("tMap").classList.toggle("active", which==="map");
    document.getElementById("tCtl").classList.toggle("active", which==="ctl");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewCtl").classList.toggle("active", which==="ctl");
    if(which==="map") setTimeout(()=>map.invalidateSize(), 200);
  }

  // ===== LEAFLET MAP (Google tiles) =====
  const map = L.map('map').setView([17.3850,78.4867], 11);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  // Pin marker like your sample (green online, red offline)
  function pinIcon(status){
    const isOn = status === "online";
    const c = isOn ? "#22c55e" : "#ef4444";
    const ring = isOn ? "rgba(34,197,94,.30)" : "rgba(239,68,68,.28)";
    return L.divIcon({
      className:"",
      html: \`
        <div style="position:relative;width:26px;height:26px">
          <div style="position:absolute;inset:-10px;border-radius:50%;background:\${ring}"></div>
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-60%);
                      width:18px;height:18px;border-radius:50%;
                      background:\${c};border:2px solid #fff;
                      box-shadow:0 8px 16px rgba(0,0,0,.25)"></div>
          <div style="position:absolute;left:50%;top:100%;transform:translate(-50%,-8px);
                      width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;
                      border-top:14px solid \${c};
                      filter:drop-shadow(0 6px 10px rgba(0,0,0,.25))"></div>
        </div>\`,
      iconSize:[26,26],
      iconAnchor:[13,26]
    });
  }

  async function load(){
    const res = await fetch('/devices');
    const data = await res.json();

    // dropdown
    const sel = document.getElementById("deviceSelect");
    const keep = sel.value;
    sel.innerHTML = "";
    (data||[]).forEach(d=>{
      const opt = document.createElement("option");
      opt.value = d.device_id;
      opt.textContent = d.device_id + " (" + d.status + ")";
      sel.appendChild(opt);
    });
    if(keep) sel.value = keep;

    let on=0, off=0;
    (data||[]).forEach(d=>{
      const isOn = d.status === "online";
      if(isOn) on++; else off++;

      const pos = [d.lat || 0, d.lng || 0];
      const pop = "<b>"+d.device_id+"</b>"
        + "<br>Status: <b style='color:"+(isOn?"#22c55e":"#ef4444")+"'>"+d.status+"</b>"
        + "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

      if(markers.has(d.device_id)){
        markers.get(d.device_id).setLatLng(pos).setIcon(pinIcon(d.status)).setPopupContent(pop);
      }else{
        const m = L.marker(pos,{icon: pinIcon(d.status)}).addTo(map).bindPopup(pop);
        markers.set(d.device_id, m);
      }
    });

    document.getElementById("total").innerText = (data||[]).length;
    document.getElementById("on").innerText = on;
    document.getElementById("off").innerText = off;
  }

  load();
  setInterval(load, 1000);

  // ===== CONTROL LINKS =====
  function buildLinks(){
    const ip = (document.getElementById("espIp").value || "192.168.4.1").trim();
    const type = document.getElementById("type").value;
    const msg1 = encodeURIComponent(document.getElementById("msg1").value || "");
    const msg2 = encodeURIComponent(document.getElementById("msg2").value || "");
    const force = document.getElementById("force").value;

    const setUrl = "http://" + ip + "/set?type=" + type + "&msg1=" + msg1 + "&msg2=" + msg2;
    const forceUrl = force ? ("http://" + ip + "/force?sig=" + force) : "";

    const btnBox = document.getElementById("buttons");
    btnBox.innerHTML = "";

    const a1 = document.createElement("a");
    a1.href = setUrl; a1.target = "_blank";
    a1.className = "btn2";
    a1.textContent = "Open /set (Update Text)";
    btnBox.appendChild(a1);

    if(forceUrl){
      const a2 = document.createElement("a");
      a2.href = forceUrl; a2.target = "_blank";
      a2.className = "btn2";
      a2.textContent = "Open /force (Force Signal)";
      btnBox.appendChild(a2);
    }

    let out = "";
    out += "SET (Update Text)\\n" + setUrl + "\\n\\n";
    out += "FORCE (Optional)\\n" + (forceUrl || "Not selected") + "\\n\\n";
    out += "NOTE: Open these links only when your laptop/phone is connected to that ESP Wi-Fi (ARCADIS_DISPLAY) or same LAN.";
    document.getElementById("out").textContent = out;
  }
</script>
</body>
</html>`);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
  console.log("Build stamp: " + BUILD_STAMP);
});