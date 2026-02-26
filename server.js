const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ======================
// DATABASE (Local + Render)
// ======================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose
  .connect(MONGO_URI)
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
// HOME
// ======================
app.get("/", (req, res) => {
  res.send("Server Running");
});

// ======================
// REGISTER
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
// DEVICES (auto-offline FAST)
// ======================
app.get("/devices", async (req, res) => {
  try {
    const now = Date.now();
    const OFFLINE_AFTER_MS = 5000; // 5 sec offline (fast)

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
// DASHBOARD (NEW LOOK + 2 TABS)
// Tab1: MAP
// Tab2: CONTROL (generates ESP /set and /force links)
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Traffic Display Monitor</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  :root{
    --bg:#071422;
    --panel:rgba(255,255,255,.06);
    --stroke:rgba(255,255,255,.10);
    --txt:#eaf2ff;
    --muted:rgba(234,242,255,.70);
    --blue:#2b8cff;
    --green:#32ff7a;
    --red:#ff3b3b;
    --amber:#ffc84a;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:var(--bg);color:var(--txt)}
  .topbar{
    display:flex;align-items:center;justify-content:space-between;gap:14px;
    padding:12px 14px;background:rgba(0,0,0,.22);
    border-bottom:1px solid var(--stroke);
    backdrop-filter: blur(6px);
  }
  .brand{font-weight:900;letter-spacing:.6px}
  .sub{font-size:12px;color:var(--muted);margin-top:2px}
  .left{display:flex;gap:14px;align-items:center}
  .tabs{display:flex;gap:10px}
  .tab{
    cursor:pointer;user-select:none;
    padding:8px 14px;border-radius:14px;
    background:var(--panel);border:1px solid var(--stroke);
    font-weight:800;
  }
  .tab.active{background:var(--blue);border-color:var(--blue)}
  .cards{display:flex;gap:10px;flex-wrap:wrap}
  .card{
    background:var(--panel);border:1px solid var(--stroke);
    border-radius:16px;padding:10px 14px;min-width:150px;
    box-shadow:0 12px 28px rgba(0,0,0,.25);
  }
  .label{font-size:11px;color:var(--muted);letter-spacing:.6px}
  .n{font-size:26px;font-weight:900;margin-top:4px}
  .badge{display:inline-flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%}
  .dot.g{background:var(--green)} .dot.r{background:var(--red)} .dot.a{background:var(--amber)}

  .view{display:none;height:calc(100% - 78px)}
  .view.active{display:block}

  #map{height:100%}

  /* Control view */
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
  button{
    background:var(--blue);border-color:var(--blue);
    font-weight:900;cursor:pointer;
  }
  .hint{font-size:12px;color:var(--muted)}
  .codebox{
    background:rgba(0,0,0,.35);border:1px solid var(--stroke);
    border-radius:14px;padding:12px;font-family:Consolas, monospace;font-size:12px;
    overflow:auto;
    white-space:pre-wrap;
  }
  .btnRow{display:flex;gap:10px;flex-wrap:wrap}
  .btn2{
    display:inline-block;
    width:auto;
    padding:10px 12px;border-radius:14px;
    border:1px solid var(--stroke);
    background:rgba(255,255,255,.06);
    color:var(--txt);
    text-decoration:none;
    font-weight:900;
  }
  .btn2:hover{border-color:rgba(255,255,255,.22)}
</style>
</head>

<body>

<div class="topbar">
  <div class="left">
    <div>
      <div class="brand">CYBERABAD TRAFFIC DISPLAY MONITOR</div>
      <div class="sub">Live status + location overview</div>
    </div>
    <div class="tabs">
      <div class="tab active" id="tMap" onclick="showTab('map')">Map</div>
      <div class="tab" id="tCtl" onclick="showTab('ctl')">Control</div>
    </div>
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

<div class="view active" id="viewMap">
  <div id="map"></div>
</div>

<div class="view" id="viewCtl">
  <div class="wrap">
    <div class="panel">
      <div class="h">Control Tab (Same like ESP Browser Control)</div>
      <div class="p">
        Your ESP control page runs inside the ESP (<b>/set</b> and <b>/force</b>).
        So these buttons work only when your laptop/phone is connected to that ESP Wi-Fi (<b>ARCADIS_DISPLAY</b>)
        OR same router LAN.
      </div>

      <div class="grid">
        <div>
          <div class="hint">Select Device</div>
          <select id="deviceSelect"></select>
        </div>
        <div>
          <div class="hint">ESP IP (Local)</div>
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
        <button onclick="buildLinks()">Create Control Links</button>

        <div class="btnRow" id="buttons"></div>

        <div class="hint">Copy links or click them when you are connected to ESP Wi-Fi.</div>
        <div class="codebox" id="out">Links will appear here...</div>
      </div>
    </div>
  </div>
</div>

<script>
  // Tabs
  function showTab(which){
    document.getElementById("tMap").classList.toggle("active", which==="map");
    document.getElementById("tCtl").classList.toggle("active", which==="ctl");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewCtl").classList.toggle("active", which==="ctl");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
  }

  // Map
  const map = L.map('map').setView([17.3850,78.4867], 11);
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  function makeMarkerIcon(status){
    const isOn = (status === "online");
    const c = isOn ? "#32ff7a" : "#ff3b3b";
    const ring = isOn ? "rgba(50,255,122,.45)" : "rgba(255,59,59,.40)";
    return L.divIcon({
      className:"",
      html: \`
        <div style="position:relative;width:22px;height:22px;">
          <div style="position:absolute;inset:-10px;border-radius:50%;background:\${ring};"></div>
          <div style="position:absolute;left:50%;top:50%;width:18px;height:18px;border-radius:50%;background:\${c};border:2px solid #fff;transform:translate(-50%,-50%);box-shadow:0 0 14px \${ring};"></div>
          <div style="position:absolute;left:50%;top:100%;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:11px solid \${c};transform:translate(-50%,-2px);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35));"></div>
        </div>\`,
      iconSize:[22,22],
      iconAnchor:[11,22]
    });
  }

  async function load(){
    const res = await fetch('/devices');
    const data = await res.json();

    // fill control dropdown
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
      const icon = makeMarkerIcon(d.status);

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
  setInterval(load, 1000); // refresh every 1 sec

  // CONTROL: build ESP links (NO ESP change needed)
  function buildLinks(){
    const ip = (document.getElementById("espIp").value || "192.168.4.1").trim();
    const type = document.getElementById("type").value;
    const msg1 = encodeURIComponent(document.getElementById("msg1").value || "");
    const msg2 = encodeURIComponent(document.getElementById("msg2").value || "");
    const force = document.getElementById("force").value;

    const setUrl = "http://" + ip + "/set?type=" + type + "&msg1=" + msg1 + "&msg2=" + msg2;
    const forceUrl = force ? ("http://" + ip + "/force?sig=" + force) : "";

    // show clickable buttons
    const btnBox = document.getElementById("buttons");
    btnBox.innerHTML = "";

    const a1 = document.createElement("a");
    a1.href = setUrl;
    a1.target = "_blank";
    a1.className = "btn2";
    a1.textContent = "Open /set (Update Text)";
    btnBox.appendChild(a1);

    if(forceUrl){
      const a2 = document.createElement("a");
      a2.href = forceUrl;
      a2.target = "_blank";
      a2.className = "btn2";
      a2.textContent = "Open /force (Force Signal)";
      btnBox.appendChild(a2);
    }

    let out = "";
    out += "SET (Update Text)\\n" + setUrl + "\\n\\n";
    out += "FORCE (Optional)\\n" + (forceUrl || "Not selected") + "\\n\\n";
    out += "NOTE: These links work only when your device is connected to ESP Wi-Fi (ARCADIS_DISPLAY) or same LAN.";
    document.getElementById("out").textContent = out;
  }
</script>

</body>
</html>
  `);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});