// server.js ✅ FULL WORKING (Render-safe / In-Memory)
// LIGHT ORANGE + WHITE + TIMES NEW ROMAN
// ✅ Data exists ONLY when ESP sends JSON (No DB persistence)
// ✅ Login page (logo + username + password + powered by)
// ✅ Prevent browser autofill showing username/password before typing
// ✅ No session persistence: refresh -> login
// ✅ Dashboard has Logout ICON (top-right)
// ✅ Status is STATIC (changes ONLY when you click Send)
// ✅ If device OFFLINE -> server blocks /api/simple
// ✅ Devices grouped by: Junction -> Arm -> Device
// ✅ NEW: Ambulance Force Mode (Line 1 = DeviceID + STOP)

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); 

// ======================
// LOGIN (hardcoded)
// ======================
const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";

const TOKENS = new Map(); 
const TOKEN_TTL_MS = 30 * 60 * 1000;

function putToken() {
  const t = crypto.randomBytes(24).toString("hex");
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
// VOLATILE STORAGE (Replaces MongoDB)
// ======================
const DEVICES = new Map();  // device_id -> device object
const MESSAGES = new Map(); // device_id -> cloud message object

const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;

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
    ambulance: [{ l1: "AMBULANCE", l2: "GIVE WAY IMMEDIATELY" }]
  };
}

// ======================
// HELPERS
// ======================
const signals = ["red", "amber", "green", "no", "ambulance"];

function ensureMsgRow(device_id) {
  if (!MESSAGES.has(device_id)) {
    MESSAGES.set(device_id, {
      device_id,
      force: "",
      slot: { red: 0, amber: 0, green: 0, no: 0 },
      packs: defaultPacks(),
      v: 0,
      updated_at: 0,
    });
  }
  return MESSAGES.get(device_id);
}

function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (isValidToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// ROUTES
// ======================
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Display Health Monitor - Login</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:"Times New Roman", Times, serif;background:#fff7ed;color:#111827}
  :root{ --orange:#f97316; --orange2:#fb923c; --card:#ffffff; --border:#fed7aa; --muted:#6b7280; }
  .wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:18px}
  .card{width:min(520px, 94vw);background:linear-gradient(180deg,#ffffff, #fffaf5);border:1px solid var(--border);border-radius:18px;box-shadow:0 20px 40px rgba(17,24,39,.12);padding:18px;position:relative;overflow:hidden;}
  .top{display:flex;align-items:center;gap:12px;position:relative}
  .logo{width:56px;height:56px;border-radius:14px;background:#fff;border:1px solid var(--border);object-fit:contain;padding:6px;}
  h1{margin:0;font-size:22px;font-weight:800}
  form{margin-top:16px;position:relative}
  label{display:block;font-size:12px;color:var(--muted);font-weight:800;margin:10px 0 6px}
  input{width:100%;padding:12px;border-radius:14px;border:1px solid var(--border);background:#fff;font-family:inherit;font-size:15px;outline:none;}
  button{width:100%;margin-top:14px;padding:12px;border-radius:14px;border:1px solid var(--orange2);background:linear-gradient(135deg,var(--orange),var(--orange2));color:#fff;font-weight:900;font-size:15px;cursor:pointer;box-shadow:0 14px 26px rgba(249,115,22,.25);}
  .err{margin-top:10px;color:#dc2626;font-weight:800;font-size:13px;min-height:18px}
  .footer{margin-top:14px;color:var(--muted);font-size:12px;font-weight:800}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="top">
      <img class="logo" src="/arcadis.png" alt="Arcadis" onerror="this.onerror=null; this.src='/image.png';" />
      <div><h1>Display Health Monitor</h1><div style="font-size:13px;color:var(--muted);font-weight:700">Secure Login</div></div>
    </div>
    <form id="loginForm" autocomplete="off">
      <input style="position:absolute;left:-9999px" autocomplete="username">
      <input style="position:absolute;left:-9999px" type="password" autocomplete="current-password">
      <label>Username</label><input id="u" placeholder="Username" readonly>
      <label>Password</label><input id="p" type="password" placeholder="Password" readonly>
      <button type="submit">Login</button>
      <div class="err" id="err"></div>
    </form>
    <div class="footer">Powered by <b>Arcadis</b></div>
  </div>
</div>
<script>
  const u = document.getElementById("u"), p = document.getElementById("p");
  function unlock(){ u.removeAttribute("readonly"); p.removeAttribute("readonly"); }
  u.addEventListener("focus", unlock, { once:true }); p.addEventListener("focus", unlock, { once:true });
  document.getElementById("loginForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const r = await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u.value,password:p.value})});
    if(!r.ok){ document.getElementById("err").textContent = "Invalid login"; return; }
    const html = await r.text(); document.open(); document.write(html); document.close();
  });
</script>
</body>
</html>`);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (String(username) !== ADMIN_USER || String(password) !== ADMIN_PASS) return res.status(401).json({ error: "Invalid" });
  res.send(renderDashboardHTML(putToken()));
});

// ======================
// DEVICE LOGIC (ESP Interaction)
// ======================
app.post("/heartbeat", (req, res) => {
  const b = req.body || {};
  if (!b.device_id) return res.status(400).json({ error: "No ID" });
  
  DEVICES.set(b.device_id, {
    device_id: b.device_id,
    junction_name: b.junction_name || "Unknown Junction",
    arm_name: b.arm_name || "Device Arm",
    lat: Number(b.lat || 0),
    lng: Number(b.lng || 0),
    last_seen: Date.now()
  });
  
  ensureMsgRow(b.device_id);
  res.json({ ok: true });
});

app.get("/devices", (req, res) => {
  const now = Date.now();
  const list = Array.from(DEVICES.values()).map(d => ({
    ...d,
    status: (now - d.last_seen <= OFFLINE_AFTER_MS) ? "online" : "offline"
  }));
  res.json(list);
});

app.post("/api/simple", requireAuth, (req, res) => {
  const { device_id, force, sig, slot, line1, line2 } = req.body;
  const dev = DEVICES.get(device_id);
  if (!dev || (Date.now() - dev.last_seen > OFFLINE_AFTER_MS)) return res.status(400).json({ error: "Device Offline" });

  const doc = ensureMsgRow(device_id);
  doc.force = force || "";

  if (force === "ambulance") {
    // Specific logic: Line 1 is Device ID + STOP
    doc.packs.ambulance = [{ l1: line1, l2: line2 }];
  } else {
    const s = sig || "red";
    const sl = Math.min(Math.max(Number(slot || 0), 0), MSG_SLOTS - 1);
    doc.packs[s][sl] = { l1: line1, l2: line2 };
    doc.slot[s] = sl;
  }

  doc.v++;
  doc.updated_at = Date.now();
  res.json({ ok: true, v: doc.v });
});

app.get("/api/pull/:device_id", (req, res) => {
  const doc = ensureMsgRow(req.params.device_id);
  res.json({ ...doc, ok: true });
});

// ======================
// DASHBOARD HTML (FULL UI)
// ======================
function renderDashboardHTML(TOKEN) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Display Health Monitor</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:"Times New Roman", Times, serif;background:#fff7ed;color:#111827;overflow:hidden}
  :root{ --orange:#f97316; --orange2:#fb923c; --border:#fed7aa; --muted:#6b7280; }
  .app{height:100%;display:flex;gap:12px;padding:12px;}
  .sidebar{width:300px;background:#fff;border:1px solid var(--border);border-radius:16px;display:flex;flex-direction:column;padding:14px;overflow-y:auto;box-shadow:0 10px 26px rgba(0,0,0,0.05);}
  .content{flex:1;display:flex;flex-direction:column;background:#fff;border:1px solid var(--border);border-radius:16px;overflow:hidden;position:relative;}
  .tabBtn{width:100%;padding:14px;border-radius:14px;cursor:pointer;border:1px solid var(--border);background:#fff;font-weight:900;margin-bottom:10px;transition:0.2s;}
  .tabBtn.active{background:linear-gradient(135deg,var(--orange),var(--orange2));color:#fff;box-shadow:0 10px 20px rgba(249,115,22,0.2);}
  .topbar{height:54px;display:flex;align-items:center;justify-content:flex-end;padding:0 12px;border-bottom:1px solid var(--border);}
  .iconBtn{width:40px;height:40px;border-radius:12px;background:var(--orange);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .panel{padding:20px;max-width:1000px;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:15px;}
  input,select,button.sendBtn{width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);font-family:inherit;font-size:14px;}
  button.sendBtn{background:var(--orange);color:#fff;font-weight:900;cursor:pointer;margin-top:20px;}
  .treeItem{margin-top:8px;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fffaf5;}
  .jName{font-weight:900;cursor:pointer;display:block;padding:5px;}
  .indent{padding-left:15px;border-left:1px dashed var(--border);margin-left:10px;}
  #map{flex:1;width:100%;height:100%;}
  .statusLine{margin-top:10px;font-size:13px;font-weight:bold;}
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <img src="/arcadis.png" style="width:40px" onerror="this.src='/image.png'">
      <b style="font-size:16px">Display Monitor</b>
    </div>
    <div class="tabBtn active" id="t1" onclick="showTab('map')">MAP</div>
    <div class="tabBtn" id="t2" onclick="showTab('msg')">MESSAGES</div>
    <div id="treeContainer"></div>
    <div style="margin-top:auto;font-size:11px;color:var(--muted)">Powered by <b>Arcadis</b></div>
  </div>
  <div class="content">
    <div class="topbar"><button class="iconBtn" onclick="location.href='/login'"><svg viewBox="0 0 24 24" width="20" fill="white"><path d="M10 17l1.41-1.41L8.83 13H20v-2H8.83l2.58-2.59L10 7l-5 5 5 5zM4 4h8V2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h8v-2H4V4z"/></svg></button></div>
    <div id="viewMap" style="flex:1"><div id="map"></div></div>
    <div id="viewMsg" style="display:none;flex:1">
      <div class="panel">
        <h2 style="margin:0">Cloud Message Control</h2>
        <div class="grid">
          <div><label style="font-size:11px;font-weight:900">Device</label><select id="devSel" onchange="syncAmbulance()"></select></div>
          <div><label style="font-size:11px;font-weight:900">Force Mode</label><select id="forceSel" onchange="syncAmbulance()">
            <option value="">AUTO</option><option value="red">RED</option><option value="amber">AMBER</option><option value="green">GREEN</option><option value="ambulance">AMBULANCE</option>
          </select></div>
        </div>
        <div id="normalFields">
          <div class="grid">
            <div><label style="font-size:11px;font-weight:900">Signal Group</label><select id="sigSel"></select></div>
            <div><label style="font-size:11px;font-weight:900">Slot</label><select id="slotSel"></select></div>
          </div>
        </div>
        <div class="grid">
          <div><label style="font-size:11px;font-weight:900">Line 1</label><input id="l1"></div>
          <div><label style="font-size:11px;font-weight:900">Line 2 (Slogan)</label><input id="l2"></div>
        </div>
        <button class="sendBtn" onclick="sendToESP()">Send to ESP</button>
        <div class="statusLine" id="stat">Status: Ready</div>
      </div>
    </div>
  </div>
</div>
<script>
  let DEVICES = [];
  const map = L.map('map').setView([17.385, 78.486], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  const markers = new Map();

  function showTab(t){
    document.getElementById('viewMap').style.display = t==='map'?'block':'none';
    document.getElementById('viewMsg').style.display = t==='msg'?'block':'none';
    document.getElementById('t1').classList.toggle('active', t==='map');
    document.getElementById('t2').classList.toggle('active', t==='msg');
    if(t==='map') map.invalidateSize();
  }

  function syncAmbulance(){
    const f = document.getElementById('forceSel').value;
    const l1 = document.getElementById('l1');
    const nf = document.getElementById('normalFields');
    if(f === 'ambulance'){
      l1.value = document.getElementById('devSel').value + " STOP";
      l1.readOnly = true;
      nf.style.opacity = '0.3';
      nf.style.pointerEvents = 'none';
    } else {
      l1.readOnly = false;
      nf.style.opacity = '1';
      nf.style.pointerEvents = 'auto';
    }
  }

  async function updateData(){
    const r = await fetch('/devices');
    DEVICES = await r.json();
    const sel = document.getElementById('devSel');
    const tree = document.getElementById('treeContainer');
    const cur = sel.value;
    
    sel.innerHTML = "";
    tree.innerHTML = "<b style='font-size:12px'>Active Junctions</b>";
    
    const groups = {};
    DEVICES.forEach(d => {
      sel.add(new Option(d.device_id + " ("+d.status+")", d.device_id));
      if(!groups[d.junction_name]) groups[d.junction_name] = {};
      if(!groups[d.junction_name][d.arm_name]) groups[d.junction_name][d.arm_name] = [];
      groups[d.junction_name][d.arm_name].push(d);

      const color = d.status === 'online' ? '#16a34a' : '#dc2626';
      if(!markers.has(d.device_id)){
        markers.set(d.device_id, L.marker([d.lat, d.lng]).addTo(map));
      }
      markers.get(d.device_id).bindPopup("<b>"+d.device_id+"</b><br>"+d.junction_name);
    });
    if(cur) sel.value = cur;

    for(let j in groups){
      const div = document.createElement('div');
      div.className = 'treeItem';
      div.innerHTML = '<span class="jName">📍 '+j+'</span>';
      for(let a in groups[j]){
        const armDiv = document.createElement('div');
        armDiv.className = 'indent';
        armDiv.innerHTML = '<div style="font-size:12px;font-weight:bold;margin:4px 0">↳ '+a+'</div>';
        groups[j][a].forEach(dev => {
          const dBtn = document.createElement('button');
          dBtn.className = 'tabBtn'; dBtn.style.padding = '5px'; dBtn.style.fontSize='11px';
          dBtn.innerHTML = (dev.status==='online'?'🟢':'🔴') + ' ' + dev.device_id;
          dBtn.onclick = () => { sel.value = dev.device_id; showTab('msg'); syncAmbulance(); };
          armDiv.appendChild(dBtn);
        });
        div.appendChild(armDiv);
      }
      tree.appendChild(div);
    }
  }

  async function sendToESP(){
    const stat = document.getElementById('stat');
    stat.innerHTML = "Sending...";
    const payload = {
      device_id: document.getElementById('devSel').value,
      force: document.getElementById('forceSel').value,
      sig: document.getElementById('sigSel').value,
      slot: document.getElementById('slotSel').value,
      line1: document.getElementById('l1').value,
      line2: document.getElementById('l2').value
    };
    try {
      const r = await fetch('/api/simple', {
        method:'POST', headers:{'Content-Type':'application/json','x-auth-token':'${TOKEN}'},
        body: JSON.stringify(payload)
      });
      if(r.ok) stat.innerHTML = "Status: <span style='color:green'>Sent successfully!</span>";
      else { const e = await r.json(); stat.innerHTML = "Status: <span style='color:red'>"+e.error+"</span>"; }
    } catch(e) { stat.innerHTML = "Status: Connection Error"; }
  }

  // Init
  const sigs = ["red","amber","green","no"];
  sigs.forEach(s => document.getElementById('sigSel').add(new Option(s.toUpperCase(), s)));
  for(let i=0; i<5; i++) document.getElementById('slotSel').add(new Option("Message "+(i+1), i));
  
  setInterval(updateData, 5000);
  updateData();
</script>
</body>
</html>`;
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server running on " + PORT));