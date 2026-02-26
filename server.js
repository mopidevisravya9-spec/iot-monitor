const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ serve public/image.png as /image.png
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
  status: { type: String, default: "offline" }
});

const Device = mongoose.model("Device", deviceSchema);

// For “cloud commands” (dashboard -> DB). ESP must pull these to apply.
const commandSchema = new mongoose.Schema({
  device_id: { type: String, required: true },
  type: { type: String, default: "red" },     // red/amber/green/no
  msg1: { type: String, default: "" },
  msg2: { type: String, default: "" },
  force: { type: String, default: "" },       // red/amber/green/""
  created_at: { type: Number, default: () => Date.now() },
  delivered: { type: Boolean, default: false }
});

const Command = mongoose.model("Command", commandSchema);

// ======================
// SIMPLE LOGIN (cookie)
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, part) => {
    const p = part.trim();
    if (!p) return acc;
    const idx = p.indexOf("=");
    if (idx === -1) return acc;
    const k = decodeURIComponent(p.slice(0, idx).trim());
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    acc[k] = v;
    return acc;
  }, {});
}

function requireAuth(req, res, next) {
  const c = parseCookies(req);
  if (c.auth === "1") return next();
  return res.redirect("/login");
}

// ======================
// HOME
// ======================
app.get("/", (req, res) => {
  res.send("Server Running ✅");
});

// ======================
// LOGIN PAGES
// ======================
app.get("/login", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Login • Arcadis Monitor</title>
<style>
  :root{
    --bg1:#0b1423; --bg2:#081a2c;
    --card:rgba(255,255,255,.08);
    --stroke:rgba(255,255,255,.14);
    --txt:#eaf2ff; --muted:rgba(234,242,255,.72);
    --blue:#2b8cff;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;color:var(--txt)}
  body{
    background:radial-gradient(1200px 800px at 20% 20%, #133a63, transparent 60%),
               radial-gradient(900px 600px at 80% 40%, #2b8cff33, transparent 55%),
               linear-gradient(160deg,var(--bg1),var(--bg2));
    overflow:hidden;
    display:grid;
    place-items:center;
  }
  .blob{
    position:absolute; inset:auto;
    width:520px; height:520px; border-radius:50%;
    background:conic-gradient(from 90deg, #2b8cff55, #32ff7a33, #ff3b3b33, #2b8cff55);
    filter:blur(50px);
    animation:float 8s ease-in-out infinite;
    opacity:.55;
  }
  .blob.b2{width:420px;height:420px;animation-duration:10s;left:60%;top:55%;opacity:.35}
  @keyframes float{
    0%,100%{transform:translate(-20px,-10px) scale(1)}
    50%{transform:translate(30px,25px) scale(1.06)}
  }
  .card{
    width:min(420px,92vw);
    background:var(--card);
    border:1px solid var(--stroke);
    border-radius:22px;
    box-shadow:0 22px 60px rgba(0,0,0,.35);
    backdrop-filter: blur(10px);
    padding:18px;
    position:relative;
  }
  .row{display:flex;gap:12px;align-items:center}
  .logo{
    width:52px;height:52px;border-radius:14px;
    background:rgba(255,255,255,.10);
    border:1px solid var(--stroke);
    display:grid;place-items:center;overflow:hidden;
  }
  .logo img{width:44px;height:44px;object-fit:contain}
  .title{font-weight:900;letter-spacing:.4px}
  .sub{font-size:12px;color:var(--muted);margin-top:3px}
  .form{margin-top:14px;display:grid;gap:10px}
  input,button{
    width:100%;padding:12px 12px;border-radius:14px;
    border:1px solid var(--stroke);
    background:rgba(0,0,0,.25);color:var(--txt);
    outline:none;
  }
  button{
    background:var(--blue);
    border-color:var(--blue);
    font-weight:900;
    cursor:pointer;
    transition:.15s transform;
  }
  button:active{transform:scale(.98)}
  .err{font-size:12px;color:#ffb3b3;min-height:16px}
  .foot{margin-top:10px;font-size:12px;color:var(--muted);display:flex;gap:10px;align-items:center;justify-content:space-between}
</style>
</head>
<body>
  <div class="blob" style="left:10%;top:10%"></div>
  <div class="blob b2"></div>

  <div class="card">
    <div class="row">
      <div class="logo"><img src="/image.png" onerror="this.style.display='none'"/></div>
      <div>
        <div class="title">ARCADIS • Traffic Display Monitor</div>
        <div class="sub">Secure access for operations</div>
      </div>
    </div>

    <form class="form" method="POST" action="/auth">
      <input name="username" placeholder="Username" autocomplete="username" required />
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
      <button type="submit">Login</button>
      <div class="err" id="err"></div>
    </form>

    <div class="foot">
      <span>Powered by Arcadis</span>
      <span id="build"></span>
    </div>
  </div>

<script>
  // show error if ?e=1
  const p = new URLSearchParams(location.search);
  if(p.get("e")==="1") document.getElementById("err").textContent="Invalid username or password.";
  document.getElementById("build").textContent = new Date().toLocaleString();
</script>
</body>
</html>`);
});

// parse form POST without extra libs
app.post("/auth", express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    // cookie valid for 7 days
    res.setHeader("Set-Cookie", "auth=1; Path=/; Max-Age=604800; SameSite=Lax");
    return res.redirect("/dashboard");
  }
  return res.redirect("/login?e=1");
});

app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "auth=; Path=/; Max-Age=0; SameSite=Lax");
  res.redirect("/login");
});

// ======================
// REGISTER (ESP or any device)
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
          ...(typeof lng === "number" ? { lng } : {})
        }
      },
      { upsert: true, new: true }
    );

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
// COMMAND API (cloud control storage)
// ======================

// Dashboard stores a command (works from anywhere)
app.post("/api/command", async (req, res) => {
  try {
    const { device_id, type, msg1, msg2, force } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const cmd = await Command.create({
      device_id,
      type: type || "red",
      msg1: msg1 || "",
      msg2: msg2 || "",
      force: force || "",
      delivered: false
    });

    res.json({ ok: true, command_id: cmd._id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP would call this to fetch latest undelivered command (requires ESP change OR internet reachability)
app.get("/api/command/:device_id", async (req, res) => {
  try {
    const device_id = req.params.device_id;
    const cmd = await Command.findOne({ device_id, delivered: false }).sort({ created_at: -1 });

    if (!cmd) return res.json({ ok: true, command: null });

    cmd.delivered = true;
    await cmd.save();

    res.json({
      ok: true,
      command: {
        type: cmd.type,
        msg1: cmd.msg1,
        msg2: cmd.msg2,
        force: cmd.force,
        created_at: cmd.created_at
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DASHBOARD (protected)
// ======================
app.get("/dashboard", requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Arcadis • Traffic Display Monitor</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  :root{
    --bg:#071422;
    --panel:rgba(255,255,255,.07);
    --stroke:rgba(255,255,255,.12);
    --txt:#eaf2ff;
    --muted:rgba(234,242,255,.72);
    --blue:#2b8cff;
    --green:#32ff7a;
    --red:#ff3b3b;
    --amber:#ffc84a;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:var(--bg);color:var(--txt)}
  .layout{display:grid;grid-template-columns:260px 1fr;height:100%}
  .side{
    border-right:1px solid var(--stroke);
    background:linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.18));
    padding:14px;
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .brandRow{display:flex;align-items:center;gap:12px}
  .brandLogo{
    width:46px;height:46px;border-radius:14px;
    background:rgba(255,255,255,.08);
    border:1px solid var(--stroke);
    overflow:hidden;
    display:grid;place-items:center;
  }
  .brandLogo img{width:40px;height:40px;object-fit:contain}
  .brandTitle{font-weight:900;letter-spacing:.3px}
  .brandSub{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.3}

  .nav{display:grid;gap:10px;margin-top:6px}
  .btn{
    user-select:none;cursor:pointer;
    padding:12px 12px;border-radius:14px;
    background:var(--panel);
    border:1px solid var(--stroke);
    font-weight:900;
    display:flex;justify-content:space-between;align-items:center;
  }
  .btn.active{background:var(--blue);border-color:var(--blue)}
  .btn small{font-weight:700;opacity:.9}
  .btn:hover{border-color:rgba(255,255,255,.24)}
  .logout{margin-top:auto;display:flex;gap:10px;align-items:center}
  .logout a{
    color:var(--txt);text-decoration:none;font-weight:900;
    padding:10px 12px;border-radius:14px;
    border:1px solid var(--stroke);
    background:rgba(255,255,255,.06);
    display:inline-block;
  }

  .main{display:grid;grid-template-rows:auto 1fr;min-width:0}
  .topbar{
    display:flex;justify-content:space-between;gap:12px;align-items:center;
    padding:12px 14px;border-bottom:1px solid var(--stroke);
    background:rgba(0,0,0,.22);
    backdrop-filter: blur(6px);
  }
  .cards{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch}
  .card{
    background:var(--panel);border:1px solid var(--stroke);
    border-radius:16px;padding:10px 14px;min-width:160px;
    box-shadow:0 12px 28px rgba(0,0,0,.25);
  }
  .label{font-size:11px;color:var(--muted);letter-spacing:.6px}
  .n{font-size:26px;font-weight:900;margin-top:4px}
  .badge{display:inline-flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%}
  .dot.g{background:var(--green)} .dot.r{background:var(--red)} .dot.a{background:var(--amber)}

  .view{display:none;height:100%;min-height:0}
  .view.active{display:block}
  #map{height:100%}

  /* Control panel */
  .wrap{max-width:980px;margin:18px auto;padding:0 14px}
  .panel{
    background:var(--panel);border:1px solid var(--stroke);
    border-radius:18px;padding:16px;
    box-shadow:0 12px 28px rgba(0,0,0,.25);
  }
  .h{font-size:18px;font-weight:900}
  .p{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.4}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .grid1{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
  input,select,button{
    width:100%;padding:12px 12px;border-radius:14px;
    border:1px solid var(--stroke);
    background:rgba(0,0,0,.25);color:var(--txt);
    outline:none;
  }
  button{background:var(--blue);border-color:var(--blue);font-weight:900;cursor:pointer}
  .hint{font-size:12px;color:var(--muted)}
  .codebox{
    background:rgba(0,0,0,.35);border:1px solid var(--stroke);
    border-radius:14px;padding:12px;font-family:Consolas, monospace;font-size:12px;
    overflow:auto;white-space:pre-wrap;
  }
  .btnRow{display:flex;gap:10px;flex-wrap:wrap}
  .btn2{
    display:inline-block;width:auto;
    padding:10px 12px;border-radius:14px;
    border:1px solid var(--stroke);
    background:rgba(255,255,255,.06);
    color:var(--txt);text-decoration:none;font-weight:900;
  }

  /* Bottom-left watermark */
  .watermark{
    position:fixed;
    left:14px;
    bottom:14px;
    display:flex;
    gap:10px;
    align-items:center;
    padding:10px 12px;
    border-radius:14px;
    background:rgba(0,0,0,.28);
    border:1px solid var(--stroke);
    backdrop-filter: blur(6px);
    z-index:9999;
  }
  .watermark img{width:26px;height:26px;object-fit:contain}
  .watermark span{font-size:12px;color:var(--muted);font-weight:800}
</style>
</head>

<body>
<div class="layout">

  <!-- LEFT SIDEBAR -->
  <div class="side">
    <div class="brandRow">
      <div class="brandLogo"><img src="/image.png" /></div>
      <div>
        <div class="brandTitle">ARCADIS MONITOR</div>
        <div class="brandSub">Live junction status & display control</div>
      </div>
    </div>

    <div class="nav">
      <div class="btn active" id="bMap" onclick="showTab('map')">
        Map <small>Live</small>
      </div>
      <div class="btn" id="bCtl" onclick="showTab('ctl')">
        Control <small>Text/Force</small>
      </div>
    </div>

    <div class="logout">
      <a href="/logout">Logout</a>
    </div>
  </div>

  <!-- MAIN -->
  <div class="main">
    <div class="topbar">
      <div>
        <div style="font-weight:900;letter-spacing:.4px">CYBERABAD TRAFFIC DISPLAY MONITOR</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Google tiles + pin markers + 1s refresh</div>
      </div>

      <div class="cards">
        <div class="card">
          <div class="label">TOTAL DEVICES</div>
          <div class="n" id="total">0</div>
          <div class="badge"><span class="dot a"></span>Refresh: 1 sec</div>
        </div>
        <div class="card">
          <div class="label">ONLINE</div>
          <div class="n" id="on">0</div>
          <div class="badge"><span class="dot g"></span>Heartbeat OK</div>
        </div>
        <div class="card">
          <div class="label">OFFLINE</div>
          <div class="n" id="off">0</div>
          <div class="badge"><span class="dot r"></span>No heartbeat</div>
        </div>
      </div>
    </div>

    <div class="view active" id="viewMap"><div id="map"></div></div>

    <div class="view" id="viewCtl">
      <div class="wrap">
        <div class="panel">
          <div class="h">Control</div>
          <div class="p">
            <b>Local control</b> works when your laptop/phone is connected to that ESP Wi-Fi (ARCADIS_DISPLAY) or same LAN.
            <br>
            <b>Cloud control</b> stores commands in MongoDB. For the ESP to actually show it, the ESP must pull commands OR be reachable over the internet.
          </div>

          <div class="grid">
            <div>
              <div class="hint">Select Device</div>
              <select id="deviceSelect"></select>
            </div>
            <div>
              <div class="hint">ESP Local IP (when connected locally)</div>
              <input id="espIp" placeholder="Example: 192.168.4.1" value="192.168.4.1"/>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Signal Type (for /set)</div>
              <select id="type">
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <div class="hint">Force Signal (for /force)</div>
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
              <div class="hint">Message Line 1</div>
              <input id="msg1" placeholder="Enter line 1"/>
            </div>
            <div>
              <div class="hint">Message Line 2</div>
              <input id="msg2" placeholder="Enter line 2"/>
            </div>
          </div>

          <div class="grid1">
            <button onclick="buildLinks()">Generate Local ESP Links</button>
            <div class="btnRow" id="buttons"></div>
            <div class="codebox" id="out">Links will appear here...</div>

            <hr style="border:0;border-top:1px solid rgba(255,255,255,.12);margin:8px 0">

            <button onclick="sendCloudCommand()">Send Cloud Command (stores in MongoDB)</button>
            <div class="hint">This stores the command. For the ESP to apply it, ESP must pull /api/command/:device_id OR be internet-reachable.</div>
            <div class="codebox" id="cloudOut">Cloud status will appear here...</div>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

<div class="watermark">
  <img src="/image.png" />
  <span>Powered by Arcadis</span>
</div>

<script>
  // Sidebar tabs
  function showTab(which){
    document.getElementById("bMap").classList.toggle("active", which==="map");
    document.getElementById("bCtl").classList.toggle("active", which==="ctl");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewCtl").classList.toggle("active", which==="ctl");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // ===== MAP =====
  const map = L.map('map').setView([17.3850,78.4867], 11);

  // Google tiles
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  // Pin marker like your reference
  function makePinIcon(status){
    const isOn = (status === "online");
    const fill = isOn ? "#32ff7a" : "#ff3b3b";
    const halo = isOn ? "rgba(50,255,122,.35)" : "rgba(255,59,59,.30)";
    return L.divIcon({
      className:"",
      html: \`
      <div style="position:relative;width:28px;height:28px;transform:translate(-2px,-2px);">
        <div style="position:absolute;left:50%;top:50%;width:32px;height:32px;border-radius:50%;background:\${halo};transform:translate(-50%,-60%);filter:blur(.1px)"></div>
        <div style="position:absolute;left:50%;top:50%;width:22px;height:22px;border-radius:50%;
                    background:\${fill};border:3px solid #fff;transform:translate(-50%,-70%);
                    box-shadow:0 10px 18px rgba(0,0,0,.35)"></div>
        <div style="position:absolute;left:50%;top:50%;width:0;height:0;
                    border-left:10px solid transparent;border-right:10px solid transparent;border-top:18px solid \${fill};
                    transform:translate(-50%,-5%);filter:drop-shadow(0 10px 10px rgba(0,0,0,.35));"></div>
      </div>\`,
      iconSize:[28,28],
      iconAnchor:[14,28]
    });
  }

  async function load(){
    const res = await fetch('/devices', { cache: "no-store" });
    const data = await res.json();

    // dropdown
    const sel = document.getElementById("deviceSelect");
    const current = sel.value;
    sel.innerHTML = "";
    (data||[]).forEach(d=>{
      const opt = document.createElement("option");
      opt.value = d.device_id;
      opt.textContent = d.device_id + " (" + d.status + ")";
      sel.appendChild(opt);
    });
    if(current) sel.value = current;

    let on=0, off=0;

    (data||[]).forEach(d=>{
      const isOn = (d.status === "online");
      if(isOn) on++; else off++;

      const pos = [d.lat || 0, d.lng || 0];
      const icon = makePinIcon(d.status);

      const pop = "<b>"+d.device_id+"</b>"
        + "<br>Status: <b style='color:"+(isOn?"#32ff7a":"#ff3b3b")+"'>"+d.status+"</b>"
        + "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

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
  }

  load();
  setInterval(load, 1000);

  // ===== CONTROL: Local Links (no ESP change) =====
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
    a1.href = setUrl; a1.target = "_blank"; a1.className = "btn2";
    a1.textContent = "Open /set (Update Text)";
    btnBox.appendChild(a1);

    if(forceUrl){
      const a2 = document.createElement("a");
      a2.href = forceUrl; a2.target = "_blank"; a2.className = "btn2";
      a2.textContent = "Open /force (Force Signal)";
      btnBox.appendChild(a2);
    }

    document.getElementById("out").textContent =
      "SET (Update Text)\\n" + setUrl + "\\n\\n" +
      "FORCE (Optional)\\n" + (forceUrl || "Not selected") + "\\n\\n" +
      "NOTE: These links work only when connected to ESP Wi-Fi (ARCADIS_DISPLAY) or same LAN.";
  }

  // ===== CONTROL: Cloud Command (stored in DB) =====
  async function sendCloudCommand(){
    const device_id = document.getElementById("deviceSelect").value;
    const type = document.getElementById("type").value;
    const force = document.getElementById("force").value;
    const msg1 = document.getElementById("msg1").value || "";
    const msg2 = document.getElementById("msg2").value || "";

    const out = document.getElementById("cloudOut");
    out.textContent = "Sending cloud command...";

    const res = await fetch("/api/command", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ device_id, type, msg1, msg2, force })
    });

    const j = await res.json();
    if(!res.ok){
      out.textContent = "Error: " + (j.error || "failed");
      return;
    }

    out.textContent =
      "✅ Stored in MongoDB. command_id: " + j.command_id + "\\n\\n" +
      "Next step: ESP must pull /api/command/" + device_id + " to apply it, OR ESP must be internet-reachable.";
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
});