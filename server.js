const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // /public/image.png

// ======================
// DATABASE
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
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

const commandSchema = new mongoose.Schema({
  device_id: { type: String, required: true },
  type: { type: String, default: "red" },     // red/amber/green/no (text set)
  msg1: { type: String, default: "" },
  msg2: { type: String, default: "" },
  force: { type: String, default: "" },       // red/amber/green/"" (optional)
  dur: { type: Number, default: 10000 },      // ✅ duration in ms
  created_at: { type: Number, default: () => Date.now() },
  delivered: { type: Boolean, default: false }
});
const Command = mongoose.model("Command", commandSchema);

// ======================
// SIMPLE LOGIN (cookie)
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin1234";

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
app.get("/", (req, res) => res.send("Server Running ✅"));

// ======================
// LOGIN
// ======================
app.get("/login", (req, res) => {
  res.send(`<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Login • Arcadis Monitor</title>
<style>
  :root{--bg1:#0b1423;--bg2:#081a2c;--card:rgba(255,255,255,.08);--stroke:rgba(255,255,255,.14);
        --txt:#eaf2ff;--muted:rgba(234,242,255,.72);--blue:#2b8cff;}
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;color:var(--txt)}
  body{background:radial-gradient(1200px 800px at 20% 20%, #133a63, transparent 60%),
               radial-gradient(900px 600px at 80% 40%, #2b8cff33, transparent 55%),
               linear-gradient(160deg,var(--bg1),var(--bg2));
       overflow:hidden;display:grid;place-items:center;}
  .card{width:min(420px,92vw);background:var(--card);border:1px solid var(--stroke);border-radius:22px;
        box-shadow:0 22px 60px rgba(0,0,0,.35);backdrop-filter: blur(10px);padding:18px;}
  .row{display:flex;gap:12px;align-items:center}
  .logo{width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.10);
        border:1px solid var(--stroke);display:grid;place-items:center;overflow:hidden;}
  .logo img{width:44px;height:44px;object-fit:contain}
  .title{font-weight:900;letter-spacing:.4px}
  .sub{font-size:12px;color:var(--muted);margin-top:3px}
  .form{margin-top:14px;display:grid;gap:10px}
  input,button{width:100%;padding:12px;border-radius:14px;border:1px solid var(--stroke);
               background:rgba(0,0,0,.25);color:var(--txt);outline:none;}
  button{background:var(--blue);border-color:var(--blue);font-weight:900;cursor:pointer}
  .err{font-size:12px;color:#ffb3b3;min-height:16px}
</style>
</head>
<body>
  <div class="card">
    <div class="row">
      <div class="logo"><img src="/image.png" onerror="this.style.display='none'"/></div>
      <div>
        <div class="title">ARCADIS • Traffic Display Monitor</div>
        <div class="sub">Secure access</div>
      </div>
    </div>

    <form class="form" method="POST" action="/auth">
      <input name="username" placeholder="Username" required />
      <input name="password" type="password" placeholder="Password" required />
      <button type="submit">Login</button>
      <div class="err" id="err"></div>
    </form>
<script>
  const p=new URLSearchParams(location.search);
  if(p.get("e")==="1") document.getElementById("err").textContent="Invalid username or password.";
</script>
  </div>
</body></html>`);
});

app.post("/auth", express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
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
// HEARTBEAT (ESP -> Server)
// ======================
app.post("/heartbeat", async (req, res) => {
  try {
    const { device_id, lat, lng } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const now = Date.now();
    await Device.findOneAndUpdate(
      { device_id },
      {
        $setOnInsert: { device_id },
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
// DEVICES LIST
// ======================
app.get("/devices", async (req, res) => {
  try {
    const now = Date.now();
    const OFFLINE_AFTER_MS = 15000; // stable 15 sec

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
// COMMAND API (Dashboard -> DB)
// ======================
app.post("/api/command", async (req, res) => {
  try {
    const { device_id, type, msg1, msg2, force, dur } = req.body || {};
    if (!device_id) return res.status(400).json({ error: "device_id required" });

    const cmd = await Command.create({
      device_id,
      type: type || "red",
      msg1: msg1 || "",
      msg2: msg2 || "",
      force: force || "",
      dur: Number(dur || 10000),
      delivered: false
    });

    res.json({ ok: true, command_id: cmd._id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ESP pulls latest undelivered command
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
        dur: cmd.dur,
        created_at: cmd.created_at
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ======================
// DASHBOARD (FULL)
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
    --bg:#071422;--panel:rgba(255,255,255,.07);--stroke:rgba(255,255,255,.12);
    --txt:#eaf2ff;--muted:rgba(234,242,255,.72);--blue:#2b8cff;
    --green:#32ff7a;--red:#ff3b3b;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:var(--bg);color:var(--txt)}
  .layout{display:grid;grid-template-columns:260px 1fr;height:100%}
  .side{border-right:1px solid var(--stroke);background:linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.18));
        padding:14px;display:flex;flex-direction:column;gap:12px;}
  .brandRow{display:flex;align-items:center;gap:12px}
  .brandLogo{width:46px;height:46px;border-radius:14px;background:rgba(255,255,255,.08);
             border:1px solid var(--stroke);overflow:hidden;display:grid;place-items:center;}
  .brandLogo img{width:40px;height:40px;object-fit:contain}
  .brandTitle{font-weight:900;letter-spacing:.3px}
  .brandSub{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.3}
  .nav{display:grid;gap:10px;margin-top:6px}
  .btn{user-select:none;cursor:pointer;padding:12px;border-radius:14px;background:var(--panel);
       border:1px solid var(--stroke);font-weight:900;display:flex;justify-content:space-between;align-items:center;}
  .btn.active{background:var(--blue);border-color:var(--blue)}
  .logout{margin-top:auto}
  .logout a{color:var(--txt);text-decoration:none;font-weight:900;padding:10px 12px;border-radius:14px;
            border:1px solid var(--stroke);background:rgba(255,255,255,.06);display:inline-block;}
  .main{display:grid;grid-template-rows:auto 1fr;min-width:0}
  .topbar{display:flex;justify-content:space-between;gap:12px;align-items:center;
          padding:12px 14px;border-bottom:1px solid var(--stroke);background:rgba(0,0,0,.22);backdrop-filter: blur(6px);}
  .cards{display:flex;gap:10px;flex-wrap:wrap}
  .card{background:var(--panel);border:1px solid var(--stroke);border-radius:16px;padding:10px 14px;min-width:160px;
        box-shadow:0 12px 28px rgba(0,0,0,.25);}
  .label{font-size:11px;color:var(--muted);letter-spacing:.6px}
  .n{font-size:26px;font-weight:900;margin-top:4px}
  .view{display:none;height:100%;min-height:0}
  .view.active{display:block}
  #map{height:100%}

  .wrap{max-width:980px;margin:18px auto;padding:0 14px}
  .panel{background:var(--panel);border:1px solid var(--stroke);border-radius:18px;padding:16px;
         box-shadow:0 12px 28px rgba(0,0,0,.25);}
  .h{font-size:18px;font-weight:900}
  .p{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.4}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .grid1{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
  input,select,button{width:100%;padding:12px;border-radius:14px;border:1px solid var(--stroke);
                      background:rgba(0,0,0,.25);color:var(--txt);outline:none;}
  button{background:var(--blue);border-color:var(--blue);font-weight:900;cursor:pointer}
  .hint{font-size:12px;color:var(--muted)}
  .codebox{background:rgba(0,0,0,.35);border:1px solid var(--stroke);border-radius:14px;padding:12px;
           font-family:Consolas, monospace;font-size:12px;overflow:auto;white-space:pre-wrap;}

  /* NEW MARKER STYLE */
  .mkWrap{position:relative;width:160px;height:44px;transform:translate(-22px,-26px);pointer-events:none}
  .mkGlow{position:absolute;left:18px;top:18px;width:26px;height:26px;border-radius:50%;filter:blur(1px);opacity:.35}
  .mkPin{position:absolute;left:22px;top:6px;width:18px;height:18px;border-radius:50%;
         border:3px solid #fff;box-shadow:0 10px 18px rgba(0,0,0,.35);}
  .mkTail{position:absolute;left:23px;top:20px;width:0;height:0;border-left:8px solid transparent;
          border-right:8px solid transparent;border-top:14px solid;filter:drop-shadow(0 8px 10px rgba(0,0,0,.35));}
  .mkLabel{position:absolute;left:54px;top:8px;padding:6px 10px;border-radius:12px;
           border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.30);font-size:12px;font-weight:900;
           white-space:nowrap;box-shadow:0 10px 22px rgba(0,0,0,.30)}
  .mkSub{display:block;font-size:10px;font-weight:800;margin-top:2px}
</style>
</head>

<body>
<div class="layout">
  <div class="side">
    <div class="brandRow">
      <div class="brandLogo"><img src="/image.png"/></div>
      <div>
        <div class="brandTitle">ARCADIS MONITOR</div>
        <div class="brandSub">Live status + cloud control</div>
      </div>
    </div>
    <div class="nav">
      <div class="btn active" id="bMap" onclick="showTab('map')">Map <small>Live</small></div>
      <div class="btn" id="bCtl" onclick="showTab('ctl')">Control <small>Send</small></div>
    </div>
    <div class="logout"><a href="/logout">Logout</a></div>
  </div>

  <div class="main">
    <div class="topbar">
      <div>
        <div style="font-weight:900;letter-spacing:.4px">CYBERABAD TRAFFIC DISPLAY MONITOR</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">1s refresh • Mongo command</div>
      </div>
      <div class="cards">
        <div class="card"><div class="label">TOTAL</div><div class="n" id="total">0</div></div>
        <div class="card"><div class="label">ONLINE</div><div class="n" id="on">0</div></div>
        <div class="card"><div class="label">OFFLINE</div><div class="n" id="off">0</div></div>
      </div>
    </div>

    <div class="view active" id="viewMap"><div id="map"></div></div>

    <div class="view" id="viewCtl">
      <div class="wrap">
        <div class="panel">
          <div class="h">Send to Display (Cloud)</div>
          <div class="p">Select device → type message → (optional force) → SEND. ESP will pull and update.</div>

          <div class="grid">
            <div>
              <div class="hint">Select Device</div>
              <select id="deviceSelect"></select>
            </div>
            <div>
              <div class="hint">Force Duration (ms)</div>
              <input id="dur" type="number" value="10000" min="1000" step="500"/>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Signal Type (update text set)</div>
              <select id="type">
                <option value="red">RED</option>
                <option value="amber">AMBER</option>
                <option value="green">GREEN</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <div class="hint">Force Signal (optional)</div>
              <select id="force">
                <option value="">No Force</option>
                <option value="red">Force RED</option>
                <option value="amber">Force AMBER</option>
                <option value="green">Force GREEN</option>
              </select>
            </div>
          </div>

          <div class="grid">
            <div><div class="hint">Message Line 1</div><input id="msg1" placeholder="Enter line 1"/></div>
            <div><div class="hint">Message Line 2</div><input id="msg2" placeholder="Enter line 2"/></div>
          </div>

          <div class="grid1">
            <button onclick="sendCloudCommand()">SEND</button>
            <div class="codebox" id="cloudOut">Status will appear here...</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  function showTab(which){
    document.getElementById("bMap").classList.toggle("active", which==="map");
    document.getElementById("bCtl").classList.toggle("active", which==="ctl");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewCtl").classList.toggle("active", which==="ctl");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  const map = L.map('map').setView([17.3850,78.4867], 11);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  function markerIcon(d){
    const isOn = (d.status === "online");
    const fill = isOn ? "#32ff7a" : "#ff3b3b";
    const glow = isOn ? "rgba(50,255,122,.40)" : "rgba(255,59,59,.35)";
    const subColor = isOn ? "rgba(50,255,122,.95)" : "rgba(255,179,179,.95)";
    return L.divIcon({
      className:"",
      html:\`
        <div class="mkWrap">
          <div class="mkGlow" style="background:\${glow}"></div>
          <div class="mkPin" style="background:\${fill}"></div>
          <div class="mkTail" style="border-top-color:\${fill}"></div>
          <div class="mkLabel">
            \${d.device_id}
            <span class="mkSub" style="color:\${subColor}">\${isOn ? "ONLINE" : "OFFLINE"}</span>
          </div>
        </div>\`,
      iconSize:[160,44],
      iconAnchor:[30,36]
    });
  }

  async function load(){
    const res = await fetch('/devices', { cache:"no-store" });
    const data = await res.json();

    const sel = document.getElementById("deviceSelect");
    const cur = sel.value;
    sel.innerHTML = "";
    (data||[]).forEach(d=>{
      const opt = document.createElement("option");
      opt.value = d.device_id;
      opt.textContent = d.device_id + " (" + d.status + ")";
      sel.appendChild(opt);
    });
    if(cur) sel.value = cur;

    let on=0, off=0;
    (data||[]).forEach(d=>{
      const isOn = (d.status === "online");
      if(isOn) on++; else off++;

      const pos = [d.lat || 0, d.lng || 0];
      const icon = markerIcon(d);

      const pop =
        "<b>"+d.device_id+"</b>" +
        "<br>Status: <b style='color:"+(isOn?"#32ff7a":"#ff3b3b")+"'>"+d.status+"</b>" +
        "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

      if(markers.has(d.device_id)){
        markers.get(d.device_id).setLatLng(pos).setIcon(icon).setPopupContent(pop);
      } else {
        markers.set(d.device_id, L.marker(pos,{icon}).addTo(map).bindPopup(pop));
      }
    });

    document.getElementById("total").innerText = (data||[]).length;
    document.getElementById("on").innerText = on;
    document.getElementById("off").innerText = off;
  }

  load();
  setInterval(load, 1000);

  async function sendCloudCommand(){
    const device_id = document.getElementById("deviceSelect").value;
    const type = document.getElementById("type").value;
    const force = document.getElementById("force").value;
    const msg1 = document.getElementById("msg1").value || "";
    const msg2 = document.getElementById("msg2").value || "";
    const dur = Number(document.getElementById("dur").value || 10000);

    const out = document.getElementById("cloudOut");
    out.textContent = "Sending...";

    const res = await fetch("/api/command", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ device_id, type, msg1, msg2, force, dur })
    });

    const j = await res.json();
    if(!res.ok){
      out.textContent = "Error: " + (j.error || "failed");
      return;
    }

    out.textContent =
      "✅ SENT\\n" +
      "command_id: " + j.command_id + "\\n" +
      "ESP will pull and update in 1-2 seconds.";
  }
</script>
</body></html>`);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));