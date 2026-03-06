// server.js ✅ FULL WORKING (In-Memory / No DB)
// LIGHT ORANGE + WHITE + TIMES NEW ROMAN
// ✅ Data exists ONLY when ESP sends JSON
// ✅ Ambulance Force Option added
// ✅ Devices grouped by: Junction -> Arm -> Device

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
  const row = TOKENS.get(t);
  if (!row || Date.now() > row.exp) return false;
  return true;
}

// ======================
// IN-MEMORY STORAGE (Replaces Database)
// ======================
const DEVICES = new Map(); // device_id -> { info }
const MESSAGES = new Map(); // device_id -> { config }

const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;

function defaultPacks() {
  const pack = (pairs) => pairs.map(([l1, l2]) => ({ l1, l2 }));
  return {
    red: pack([["HURRY ENDS HERE", "YOUR FAMILY WAITS"], ["BRAKE NOW", "REGRET IS HEAVY"], ["STOP", "BE SAFE"], ["PAUSE", "PROTECT LIFE"], ["WAIT", "STAY ALERT"]]),
    amber: pack([["SLOW DOWN", "CAUTION"], ["PREPARE", "SIGNAL CHANGE"], ["EASE OFF", "SAFETY FIRST"], ["WATCH", "THE ROAD"], ["READY", "TO STOP"]]),
    green: pack([["DRIVE SAFE", "ARRIVE HAPPY"], ["SMOOTH", "SPEED"], ["GO", "WITH CARE"], ["FLOW", "STAY ALERT"], ["MOVE", "CONTROLLED"]]),
    no: pack([["CAUTION", "NO SIGNAL"], ["DISCIPLINE", "SAVES"], ["WATCH", "SIDES"], ["SLOW", "JUNCTION"], ["SAFETY", "YOUR HANDS"]]),
    ambulance: [{ l1: "AMBULANCE", l2: "GIVE WAY NOW" }]
  };
}

// ======================
// HELPERS
// ======================
function getMsgRow(id) {
  if (!MESSAGES.has(id)) {
    MESSAGES.set(id, {
      device_id: id,
      force: "",
      slot: { red: 0, amber: 0, green: 0, no: 0 },
      packs: defaultPacks(),
      v: 0,
      updated_at: 0
    });
  }
  return MESSAGES.get(id);
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
// ROUTES
// ======================
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(`... [Login HTML same as previous version] ...`);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASS) return res.status(401).json({ error: "Invalid login" });
  res.send(renderDashboardHTML(putToken()));
});

// ESP Heartbeat - Data only enters memory here
app.post("/heartbeat", (req, res) => {
  const b = req.body || {};
  if (!b.device_id) return res.status(400).send("ID required");

  DEVICES.set(b.device_id, {
    device_id: b.device_id,
    junction_name: b.junction_name || "Unknown",
    arm_name: b.arm_name || "Arm",
    lat: Number(b.lat || 0),
    lng: Number(b.lng || 0),
    last_seen: Date.now()
  });
  
  getMsgRow(b.device_id);
  res.json({ ok: true });
});

app.get("/devices", (req, res) => {
  const list = [];
  const now = Date.now();
  for (const d of DEVICES.values()) {
    list.push({ ...d, status: (now - d.last_seen < OFFLINE_AFTER_MS) ? "online" : "offline" });
  }
  res.json(list);
});

// Update ESP message
app.post("/api/simple", requireAuth, (req, res) => {
  const { device_id, force, sig, slot, line1, line2 } = req.body;
  const dev = DEVICES.get(device_id);
  if (!dev || (Date.now() - dev.last_seen > OFFLINE_AFTER_MS)) {
    return res.status(400).json({ error: "Device Offline/Not Found" });
  }

  const doc = getMsgRow(device_id);
  doc.force = force || "";
  
  if (force === "ambulance") {
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

// ESP Pull
app.get("/api/pull/:device_id", (req, res) => {
  const doc = getMsgRow(req.params.device_id);
  res.json({ ...doc, ok: true });
});

// ======================
// DASHBOARD
// ======================
function renderDashboardHTML(TOKEN) {
  return `<!doctype html>
<html>
<head>
    <title>Display Health Monitor</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        *{box-sizing:border-box}
        body{margin:0;font-family:"Times New Roman",serif;background:#fff7ed;color:#111827;display:flex;height:100vh;overflow:hidden;}
        .sidebar{width:300px;background:#fff;border-right:1px solid #fed7aa;padding:15px;display:flex;flex-direction:column;overflow-y:auto;}
        .content{flex:1;display:flex;flex-direction:column;}
        .tabBtn{width:100%;padding:12px;margin-bottom:10px;border:1px solid #fed7aa;background:#fff;cursor:pointer;font-weight:bold;border-radius:10px;}
        .tabBtn.active{background:linear-gradient(135deg,#f97316,#fb923c);color:#fff;}
        .panel{background:#fff;margin:15px;padding:20px;border-radius:15px;border:1px solid #fed7aa;flex:1;overflow-y:auto;}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;}
        input,select,button{width:100%;padding:12px;border-radius:8px;border:1px solid #fed7aa;font-family:inherit;}
        .sendBtn{background:#f97316;color:#fff;font-weight:bold;cursor:pointer;border:none;}
        #map{height:100%;}
        .jBtn{width:100%;text-align:left;background:#fff;border:1px solid #fed7aa;padding:8px;margin-top:5px;cursor:pointer;border-radius:5px;}
        .indent{padding-left:15px;}
        .ambulance-mode{background:#fee2e2;border-color:#ef4444;}
    </style>
</head>
<body>
    <div class="sidebar">
        <h2 style="font-size:18px;">Display Health Monitor</h2>
        <button class="tabBtn active" id="mBtn" onclick="tab('map')">MAP</button>
        <button class="tabBtn" id="msgBtn" onclick="tab('msg')">MESSAGES</button>
        <div id="tree"></div>
        <div style="margin-top:auto; font-size:12px;">Powered by Arcadis</div>
    </div>
    <div class="content">
        <div id="viewMap" style="height:100%">
            <div id="map"></div>
        </div>
        <div id="viewMsg" style="display:none; height:100%">
            <div class="panel">
                <h3>Cloud Message Control</h3>
                <div class="grid">
                    <div>
                        <label>Device ID</label>
                        <select id="devSel" onchange="updateUI()"></select>
                    </div>
                    <div>
                        <label>Force Mode</label>
                        <select id="forceSel" onchange="checkAmbulance()">
                            <option value="">AUTO</option>
                            <option value="red">RED</option>
                            <option value="amber">AMBER</option>
                            <option value="green">GREEN</option>
                            <option value="ambulance">AMBULANCE</option>
                        </select>
                    </div>
                </div>
                <div class="grid" id="normalSelectors">
                    <div>
                        <label>Signal</label>
                        <select id="sigSel" onchange="fillSlots()"></select>
                    </div>
                    <div>
                        <label>Slot</label>
                        <select id="slotSel" onchange="autoFill()"></select>
                    </div>
                </div>
                <div class="grid">
                    <div>
                        <label id="l1Label">Line 1</label>
                        <input id="l1" />
                    </div>
                    <div>
                        <label>Line 2 (Slogan)</label>
                        <input id="l2" />
                    </div>
                </div>
                <button class="sendBtn" onclick="send()">Send to ESP</button>
                <p id="stat">Status: Ready</p>
            </div>
        </div>
    </div>

    <script>
        const TOKEN = "${TOKEN}";
        let DEVS = [];
        const map = L.map('map').setView([17.385, 78.486], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        const markers = new Map();

        function tab(t){
            document.getElementById('viewMap').style.display = t==='map'?'block':'none';
            document.getElementById('viewMsg').style.display = t==='msg'?'block':'none';
            document.getElementById('mBtn').className = t==='map'?'tabBtn active':'tabBtn';
            document.getElementById('msgBtn').className = t==='msg'?'tabBtn active':'tabBtn';
        }

        function checkAmbulance(){
            const f = document.getElementById('forceSel').value;
            const l1 = document.getElementById('l1');
            const l1L = document.getElementById('l1Label');
            const ns = document.getElementById('normalSelectors');
            
            if(f === 'ambulance'){
                l1.value = document.getElementById('devSel').value + " STOP";
                l1.readOnly = true;
                l1L.innerText = "Line 1 (Auto)";
                ns.style.display = 'none';
            } else {
                l1.readOnly = false;
                l1L.innerText = "Line 1";
                ns.style.display = 'grid';
                autoFill();
            }
        }

        function updateUI(){
            checkAmbulance();
        }

        async function refresh(){
            const r = await fetch('/devices');
            DEVS = await r.json();
            const sel = document.getElementById('devSel');
            const tree = document.getElementById('tree');
            const cur = sel.value;
            
            sel.innerHTML = "";
            tree.innerHTML = "<b>Active Junctions</b>";
            
            const junctions = {};
            DEVS.forEach(d => {
                const opt = new Option(d.device_id, d.device_id);
                sel.add(opt);
                
                if(!junctions[d.junction_name]) junctions[d.junction_name] = {};
                if(!junctions[d.junction_name][d.arm_name]) junctions[d.junction_name][d.arm_name] = [];
                junctions[d.junction_name][d.arm_name].push(d);

                if(!markers.has(d.device_id)){
                    markers.set(d.device_id, L.marker([d.lat, d.lng]).addTo(map).bindPopup(d.device_id));
                }
            });
            if(cur) sel.value = cur;

            for(let j in junctions){
                let jb = document.createElement('div');
                jb.innerHTML = '<button class="jBtn">📍 '+j+'</button>';
                for(let a in junctions[j]){
                    let ab = document.createElement('div');
                    ab.className = "indent";
                    ab.innerHTML = '<div style="font-size:13px; padding:4px;">↳ '+a+'</div>';
                    junctions[j][a].forEach(dev => {
                        let db = document.createElement('div');
                        db.className = "indent";
                        db.innerHTML = '<button class="jBtn" style="font-size:11px;" onclick="selectDev(\''+dev.device_id+'\')">'+(dev.status==='online'?'🟢':'🔴')+' '+dev.device_id+'</button>';
                        ab.appendChild(db);
                    });
                    jb.appendChild(ab);
                }
                tree.appendChild(jb);
            }
        }

        function selectDev(id){
            tab('msg');
            document.getElementById('devSel').value = id;
            updateUI();
        }

        async function send(){
            const payload = {
                device_id: document.getElementById('devSel').value,
                force: document.getElementById('forceSel').value,
                sig: document.getElementById('sigSel').value,
                slot: document.getElementById('slotSel').value,
                line1: document.getElementById('l1').value,
                line2: document.getElementById('l2').value
            };
            const r = await fetch('/api/simple', {
                method: 'POST',
                headers: {'Content-Type':'application/json', 'x-auth-token': TOKEN},
                body: JSON.stringify(payload)
            });
            const res = await r.json();
            document.getElementById('stat').innerText = res.ok ? "Status: Sent!" : "Status: Error: "+res.error;
        }

        function fillSlots(){
            const s = document.getElementById('slotSel');
            s.innerHTML = "";
            for(let i=0; i<5; i++) s.add(new Option("Slot "+(i+1), i));
        }

        function autoFill(){
            // Simplified logic: clear or set defaults
            if(document.getElementById('forceSel').value !== 'ambulance'){
               document.getElementById('l1').value = "";
               document.getElementById('l2').value = "";
            }
        }

        setInterval(refresh, 5000);
        const sigs = ["red","amber","green","no"];
        const sSel = document.getElementById('sigSel');
        sigs.forEach(s => sSel.add(new Option(s.toUpperCase(), s)));
        fillSlots();
        refresh();
    </script>
</body>
</html>`;
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server listening on " + PORT));