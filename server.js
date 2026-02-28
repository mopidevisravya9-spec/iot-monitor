// ======================
// DASHBOARD (MAP + DISPLAY UI ONLY) - UPDATED THEME
// ======================
app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Junction Operations Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;font-family:Segoe UI,Arial;background:#0b1020;color:#e9eefc;overflow:hidden}

  /* background vibe */
  .bg{
    position:fixed;inset:0;
    background:
      radial-gradient(1200px 600px at 20% 10%, rgba(11,94,215,.35), transparent 60%),
      radial-gradient(900px 500px at 85% 25%, rgba(45,187,78,.22), transparent 55%),
      radial-gradient(700px 450px at 40% 95%, rgba(208,139,25,.18), transparent 55%),
      linear-gradient(180deg, #070b16 0%, #0b1020 60%, #070b16 100%);
    filter:saturate(1.1);
    z-index:-2;
  }
  .noise{
    position:fixed;inset:0;z-index:-1;opacity:.06;pointer-events:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
  }

  /* layout */
  .app{height:100%;display:flex;gap:12px;padding:12px}
  .sidebar{
    width:84px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    backdrop-filter: blur(10px);
    display:flex;flex-direction:column;align-items:center;
    padding:10px 8px;gap:10px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
  }

  .navbtn{
    width:64px;height:64px;border-radius:16px;
    display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;
    cursor:pointer;user-select:none;
    border:1px solid rgba(255,255,255,.10);
    background:rgba(255,255,255,.04);
    transition:.18s ease;
  }
  .navbtn:hover{transform:translateY(-1px);background:rgba(255,255,255,.07)}
  .navbtn.active{
    background:linear-gradient(135deg, rgba(11,94,215,.35), rgba(255,255,255,.06));
    border-color: rgba(173,210,255,.35);
    box-shadow:0 12px 30px rgba(11,94,215,.18);
  }
  .navico{font-size:20px}
  .navtxt{font-size:10px;font-weight:900;opacity:.85;letter-spacing:.6px}

  .content{
    flex:1;display:flex;flex-direction:column;
    background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    backdrop-filter: blur(10px);
    overflow:hidden;
    box-shadow:0 18px 50px rgba(0,0,0,.35);
  }

  .topbar{
    height:62px;
    display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;
    border-bottom:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  }
  .topLeft{
    display:flex;align-items:center;gap:10px;
    font-weight:1000;letter-spacing:.4px;
  }
  .pill{
    padding:8px 10px;border-radius:999px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.05);
    font-size:12px;font-weight:900;opacity:.9;
  }
  .logoutIcon{
    width:40px;height:40px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.06);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;transition:.18s ease;
  }
  .logoutIcon:hover{transform:translateY(-1px);background:rgba(255,255,255,.09)}
  .logoutIcon svg{opacity:.9}

  .cards{
    display:flex;gap:12px;padding:12px;
    border-bottom:1px solid rgba(255,255,255,.10);
    flex-wrap:wrap;
    background:rgba(255,255,255,.03);
  }
  .card{
    flex:0 0 220px;
    border-radius:16px;
    border:1px solid rgba(255,255,255,.10);
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    padding:12px 12px;
    box-shadow:0 14px 34px rgba(0,0,0,.25);
    position:relative;
    overflow:hidden;
  }
  .card:before{
    content:"";
    position:absolute;inset:-2px;
    background:radial-gradient(300px 100px at 20% 0%, rgba(255,255,255,.15), transparent 60%);
    opacity:.7;
  }
  .card .k{font-size:11px;opacity:.75;font-weight:900;letter-spacing:.8px;position:relative}
  .card .v{font-size:28px;font-weight:1000;margin-top:6px;position:relative}

  .view{display:none;flex:1}
  .view.active{display:flex;flex-direction:column}

  #map{flex:1}

  /* Display UI panel */
  .ctlwrap{padding:14px;max-width:1020px}
  .panel{
    background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
    border:1px solid rgba(255,255,255,.10);
    border-radius:18px;
    padding:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.30);
  }
  .hint{font-size:12px;opacity:.75;line-height:1.35}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}

  input,select,button{
    width:100%;
    padding:12px;border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:rgba(10,14,28,.55);
    color:#e9eefc;
    outline:none;
    font-size:14px;
  }
  button{
    cursor:pointer;
    background:linear-gradient(135deg, rgba(11,94,215,.95), rgba(11,94,215,.65));
    border-color: rgba(173,210,255,.35);
    font-weight:1000;
    transition:.15s ease;
  }
  button:hover{transform:translateY(-1px)}
  .btnSmall{
    width:auto;padding:10px 12px;border-radius:14px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.12);
    font-weight:1000;
  }
  .btnRed{background:linear-gradient(135deg, rgba(217,65,65,.95), rgba(217,65,65,.65));border-color:rgba(255,190,190,.35)}
  .btnAmb{background:linear-gradient(135deg, rgba(208,139,25,.95), rgba(208,139,25,.65));border-color:rgba(255,230,190,.35)}
  .btnGrn{background:linear-gradient(135deg, rgba(45,187,78,.95), rgba(45,187,78,.65));border-color:rgba(190,255,210,.35)}
  .btnGry{background:linear-gradient(135deg, rgba(17,24,39,.95), rgba(17,24,39,.65));border-color:rgba(255,255,255,.18)}

  /* Login */
  .loginOverlay{
    position:fixed;inset:0;
    background:linear-gradient(135deg,#0b5ed7,#061a3a);
    display:flex;align-items:center;justify-content:center;
    z-index:10000;
  }
  .loginCard{
    width:min(420px,92vw);
    background:rgba(255,255,255,.96);
    border-radius:18px;
    border:1px solid rgba(255,255,255,.5);
    padding:18px;
    box-shadow:0 30px 60px rgba(0,0,0,.35);
    animation:pop .35s ease;
  }
  @keyframes pop{from{transform:scale(.96);opacity:.5}to{transform:scale(1);opacity:1}}
  .loginTop{display:flex;align-items:center;gap:12px}
  .loginTop img{height:34px}
  .loginTop .h{font-size:18px;font-weight:1000}
  .err{color:#b91c1c;font-size:12px;font-weight:900;margin-top:8px;display:none}

  /* Single logo only (watermark) */
  .watermark{
    position:fixed;left:12px;bottom:12px;
    background:rgba(255,255,255,.90);
    border:1px solid #e6e8ee;border-radius:14px;
    padding:8px 10px;display:flex;align-items:center;gap:10px;
    box-shadow:0 10px 20px rgba(0,0,0,.18);
    z-index:9999;
  }
  .watermark img{height:26px}
  .watermark .p{font-size:12px;font-weight:1000;color:#111827}
  .watermark .s{font-size:11px;color:#6b7280;margin-top:1px}

  @media (max-width: 920px){
    .cards{gap:10px}
    .card{flex:1 1 160px}
    .grid{grid-template-columns:1fr}
  }
</style>
</head>

<body>
<div class="bg"></div>
<div class="noise"></div>

<!-- LOGIN -->
<div class="loginOverlay" id="loginOverlay">
  <div class="loginCard">
    <div class="loginTop">
      <img src="/image.png" onerror="this.style.display='none'"/>
      <div>
        <div class="h">Operations Console</div>
        <div class="hint">Access control enabled</div>
      </div>
    </div>
    <div style="margin-top:12px">
      <div class="hint">Username</div>
      <input id="u" placeholder="admin"/>
    </div>
    <div style="margin-top:10px">
      <div class="hint">Password</div>
      <input id="p" type="password" placeholder="admin123"/>
    </div>
    <div class="err" id="err">Invalid login</div>
    <div style="margin-top:12px">
      <button onclick="doLogin()">Login</button>
    </div>
  </div>
</div>

<div class="app">

  <!-- SIDEBAR (NO TOP LOGO / NO NAMES) -->
  <div class="sidebar">
    <div class="navbtn active" id="navMap" onclick="showTab('map')">
      <div class="navico">🗺️</div>
      <div class="navtxt">MAP</div>
    </div>
    <div class="navbtn" id="navEsp" onclick="showTab('esp')">
      <div class="navico">🖥️</div>
      <div class="navtxt">DISPLAY</div>
    </div>
  </div>

  <!-- MAIN -->
  <div class="content">
    <div class="topbar">
      <div class="topLeft">
        <div class="pill">Junction Operations</div>
        <div class="pill" id="liveTag">Live</div>
      </div>

      <!-- logout icon -->
      <div class="logoutIcon" title="Logout" onclick="logout()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1" stroke="white" stroke-width="2" stroke-linecap="round"/>
          <path d="M15 12H3m0 0 3-3m-3 3 3 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- KPI cards (NO refresh card) -->
    <div class="cards">
      <div class="card"><div class="k">TOTAL DEVICES</div><div class="v" id="total">0</div></div>
      <div class="card"><div class="k">ONLINE</div><div class="v" id="on">0</div></div>
      <div class="card"><div class="k">OFFLINE</div><div class="v" id="off">0</div></div>
      <div class="card"><div class="k">HEARTBEAT HEALTH</div><div class="v" id="hb">-</div></div>
    </div>

    <!-- MAP -->
    <div class="view active" id="viewMap">
      <div id="map"></div>
    </div>

    <!-- DISPLAY UI -->
    <div class="view" id="viewEsp">
      <div class="ctlwrap">
        <div class="panel">
          <div style="font-weight:1000;font-size:16px">Display Configuration</div>
          <div class="hint" style="margin-top:6px">
            Signal → Message Slot → Save → Apply ACTIVE. Force is optional and overrides signals.
          </div>

          <div class="grid">
            <div>
              <div class="hint">Device</div>
              <select id="espDevice" onchange="loadConfigToUI()"></select>
            </div>
            <div>
              <div class="hint">Action Status</div>
              <input id="espStatus" readonly value="Idle"/>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Select Signal</div>
              <select id="sigSel" onchange="refreshSlotDropdown(true)">
                <option value="red">RED → STOP</option>
                <option value="amber">AMBER → WAIT</option>
                <option value="green">GREEN → GO</option>
                <option value="no">NO SIGNAL</option>
              </select>
            </div>
            <div>
              <div class="hint">Select Message Slot</div>
              <select id="slotSel" onchange="loadSlotLines()"></select>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Message Line 1</div>
              <input id="line1" placeholder="Enter message line 1"/>
            </div>
            <div>
              <div class="hint">Message Line 2</div>
              <input id="line2" placeholder="Enter message line 2"/>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="hint">Save Slot</div>
              <button onclick="saveSlot()">Save</button>
            </div>
            <div>
              <div class="hint">Apply Slot as ACTIVE</div>
              <button onclick="applySlot()">Apply ACTIVE</button>
            </div>
          </div>

          <div style="margin-top:12px;font-weight:1000">Force Signal</div>
          <div class="row">
            <button class="btnSmall btnRed" onclick="forceNow('red')">RED</button>
            <button class="btnSmall btnAmb" onclick="forceNow('amber')">AMBER</button>
            <button class="btnSmall btnGrn" onclick="forceNow('green')">GREEN</button>
            <button class="btnSmall btnGry" onclick="forceNow('')">AUTO</button>
          </div>

          <div class="grid" style="margin-top:12px">
            <div>
              <div class="hint">Active Slot (Selected Signal)</div>
              <input id="activeInfo" readonly value="-"/>
            </div>
            <div>
              <div class="hint">Config Version (updated_at)</div>
              <input id="verInfo" readonly value="-"/>
            </div>
          </div>

        </div>
      </div>
    </div>

  </div>
</div>

<!-- SINGLE LOGO ONLY -->
<div class="watermark">
  <img src="/image.png" onerror="this.style.display='none'"/>
  <div>
    <div class="p">Powered by Arcadis</div>
    <div class="s">Operations monitoring</div>
  </div>
</div>

<script>
  // ===== LOGIN (UI only) =====
  function doLogin(){
    const u = document.getElementById("u").value.trim();
    const p = document.getElementById("p").value.trim();
    const ok = (u==="admin" && p==="admin123");
    document.getElementById("err").style.display = ok ? "none" : "block";
    if(ok){
      localStorage.setItem("arcadis_auth_user","admin");
      localStorage.setItem("arcadis_auth_pass","admin123");
      document.getElementById("loginOverlay").style.display="none";
      loadDevices();
    }
  }
  function logout(){
    localStorage.removeItem("arcadis_auth_user");
    localStorage.removeItem("arcadis_auth_pass");
    location.reload();
  }
  (function boot(){
    const u = localStorage.getItem("arcadis_auth_user");
    const p = localStorage.getItem("arcadis_auth_pass");
    if(u==="admin" && p==="admin123"){
      document.getElementById("loginOverlay").style.display="none";
      loadDevices();
    }
  })();

  function authHeaders(){
    return {
      "x-admin-user": localStorage.getItem("arcadis_auth_user") || "",
      "x-admin-pass": localStorage.getItem("arcadis_auth_pass") || ""
    };
  }

  // ===== TABS =====
  function showTab(which){
    document.getElementById("navMap").classList.toggle("active", which==="map");
    document.getElementById("navEsp").classList.toggle("active", which==="esp");
    document.getElementById("viewMap").classList.toggle("active", which==="map");
    document.getElementById("viewEsp").classList.toggle("active", which==="esp");
    if(which==="map"){ setTimeout(()=>map.invalidateSize(), 200); }
    if(which==="esp"){ setTimeout(loadConfigToUI, 0); }
  }

  // ===== MAP =====
  const map = L.map('map').setView([17.3850,78.4867], 12);

  // Google tiles
  L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3'],
    maxZoom: 20
  }).addTo(map);

  const markers = new Map();

  function pinIcon(status){
    const isOn = (status === "online");
    const fill = isOn ? "#2dbb4e" : "#d94141";
    const shadow = "rgba(0,0,0,.28)";
    const html = \`
      <div style="width:28px;height:28px;transform:translate(-14px,-28px);">
        <svg width="28" height="28" viewBox="0 0 64 64">
          <path d="M32 2C20 2 10.5 11.6 10.5 23.5 10.5 40.5 32 62 32 62S53.5 40.5 53.5 23.5C53.5 11.6 44 2 32 2Z"
                fill="\${fill}" stroke="white" stroke-width="4" style="filter:drop-shadow(0 6px 6px \${shadow});"/>
          <circle cx="32" cy="24" r="10" fill="white" opacity="0.95"/>
        </svg>
      </div>\`;
    return L.divIcon({ className:"", html, iconSize:[28,28], iconAnchor:[14,28] });
  }

  // ===== DEVICES + KPIs =====
  async function loadDevices(){
    try{
      const res = await fetch('/devices');
      const data = await res.json();

      // dropdown (display UI)
      const sel2 = document.getElementById("espDevice");
      const cur2 = sel2.value;
      sel2.innerHTML = "";
      (data||[]).forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.device_id;
        opt.textContent = d.device_id + " (" + d.status + ")";
        sel2.appendChild(opt);
      });
      if(cur2) sel2.value = cur2;

      let on=0, off=0;
      let lastSeenMax = 0;
      (data||[]).forEach(d=>{
        const isOn = (d.status==="online");
        if(isOn) on++; else off++;
        lastSeenMax = Math.max(lastSeenMax, d.last_seen||0);

        const pos = [d.lat || 0, d.lng || 0];
        const icon = pinIcon(d.status);
        const pop =
          "<b>"+d.device_id+"</b>" +
          "<br>Status: <b style='color:"+(isOn?"#2dbb4e":"#d94141")+"'>"+d.status+"</b>" +
          "<br>Last seen: " + new Date(d.last_seen||0).toLocaleString();

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

      // Heartbeat health KPI = seconds since last seen (best-effort)
      const secAgo = lastSeenMax ? Math.floor((Date.now()-lastSeenMax)/1000) : "-";
      document.getElementById("hb").innerText = (secAgo==="-"? "-" : (secAgo + "s"));

      // Live tag pulse based on any online devices
      const liveTag = document.getElementById("liveTag");
      liveTag.textContent = on>0 ? "Live" : "Degraded";
      liveTag.style.borderColor = on>0 ? "rgba(190,255,210,.35)" : "rgba(255,190,190,.35)";
      liveTag.style.background = on>0 ? "rgba(45,187,78,.12)" : "rgba(217,65,65,.12)";
    }catch(e){
      console.log(e);
    }
  }

  setInterval(loadDevices, 1000);

  // ===== DISPLAY UI TAB (cloud config) =====
  let cachedConfig = null;

  async function loadConfigToUI(){
    const device_id = document.getElementById("espDevice").value;
    if(!device_id) return;

    document.getElementById("espStatus").value = "Loading...";
    try{
      const res = await fetch("/api/config/" + encodeURIComponent(device_id));
      const cfg = await res.json();
      cachedConfig = cfg;

      document.getElementById("verInfo").value = String(cfg.updated_at || 0);
      refreshSlotDropdown(false);
      document.getElementById("espStatus").value = "Ready ✅";
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }

  function refreshSlotDropdown(resetSlot){
    if(!cachedConfig) return;
    const sig = document.getElementById("sigSel").value;
    const slotSel = document.getElementById("slotSel");

    const msgs = (cachedConfig.messages && cachedConfig.messages[sig]) ? cachedConfig.messages[sig] : [];
    const active = (cachedConfig.active && Number.isFinite(cachedConfig.active[sig])) ? cachedConfig.active[sig] : 0;

    let cur = slotSel.value;
    if(resetSlot) cur = "0";

    slotSel.innerHTML = "";
    const slots = cachedConfig.slots || msgs.length || 5;

    for(let i=0;i<slots;i++){
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "Message " + (i+1) + (i===active ? " (ACTIVE)" : "");
      slotSel.appendChild(opt);
    }
    slotSel.value = cur || "0";

    document.getElementById("activeInfo").value = "Message " + (active+1);
    loadSlotLines();
  }

  function loadSlotLines(){
    if(!cachedConfig) return;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);

    const arr = (cachedConfig.messages && cachedConfig.messages[sig]) ? cachedConfig.messages[sig] : [];
    const it = arr[slot] || { l1:"", l2:"" };

    document.getElementById("line1").value = it.l1 || "";
    document.getElementById("line2").value = it.l2 || "";
  }

  async function saveSlot(){
    const device_id = document.getElementById("espDevice").value;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);
    const l1 = document.getElementById("line1").value || "";
    const l2 = document.getElementById("line2").value || "";

    document.getElementById("espStatus").value = "Saving...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"save_slot", sig, slot, l1, l2 })
      });
      const out = await res.json();
      if(res.ok){
        cachedConfig = out.config;
        document.getElementById("verInfo").value = String(out.config.updated_at || 0);
        document.getElementById("espStatus").value = "Saved ✅";
        refreshSlotDropdown(false);
      }else{
        document.getElementById("espStatus").value = "Failed ❌ " + (out.error||"");
      }
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }

  async function applySlot(){
    const device_id = document.getElementById("espDevice").value;
    const sig = document.getElementById("sigSel").value;
    const slot = Number(document.getElementById("slotSel").value || 0);

    document.getElementById("espStatus").value = "Applying...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"apply_slot", sig, slot })
      });
      const out = await res.json();
      if(res.ok){
        cachedConfig = out.config;
        document.getElementById("verInfo").value = String(out.config.updated_at || 0);
        document.getElementById("espStatus").value = "Applied ✅";
        refreshSlotDropdown(false);
      }else{
        document.getElementById("espStatus").value = "Failed ❌ " + (out.error||"");
      }
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }

  async function forceNow(force){
    const device_id = document.getElementById("espDevice").value;
    document.getElementById("espStatus").value = "Forcing...";
    try{
      const res = await fetch("/api/config", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...authHeaders() },
        body: JSON.stringify({ device_id, action:"force", force })
      });
      const out = await res.json();
      if(res.ok){
        cachedConfig = out.config;
        document.getElementById("verInfo").value = String(out.config.updated_at || 0);
        document.getElementById("espStatus").value = force ? ("Forced " + force.toUpperCase() + " ✅") : "AUTO ✅";
        refreshSlotDropdown(false);
      }else{
        document.getElementById("espStatus").value = "Failed ❌ " + (out.error||"");
      }
    }catch(e){
      document.getElementById("espStatus").value = "Error ❌";
    }
  }
</script>
</body>
</html>`);
});
// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));