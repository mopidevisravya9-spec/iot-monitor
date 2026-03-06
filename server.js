// server.js
// DISPLAY HEALTH MONITOR
// NO DATABASE VERSION
// DEVICES APPEAR WHEN ESP SENDS JSON

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));


// ================= LOGIN =================

const ADMIN_USER="admin";
const ADMIN_PASS="Ibi@123";

const TOKENS=new Map();
const TOKEN_TTL=30*60*1000;

function makeToken(){
 return crypto.randomBytes(24).toString("hex");
}

function putToken(){
 const t=makeToken();
 TOKENS.set(t,{exp:Date.now()+TOKEN_TTL});
 return t;
}

function validToken(t){
 if(!t) return false;
 const r=TOKENS.get(t);
 if(!r) return false;
 if(Date.now()>r.exp){
   TOKENS.delete(t);
   return false;
 }
 return true;
}


// ================= MEMORY STORE =================

const DEVICES=new Map();
const CLOUD=new Map();

const OFFLINE_MS=30000;
const MSG_SLOTS=5;


// ================= DEFAULT PACKS =================

function defaultPacks(){

return{

red:[
{l1:"HURRY ENDS HERE",l2:"YOUR FAMILY WAITS"},
{l1:"BRAKE NOW",l2:"REGRET IS HEAVIER"},
{l1:"STOPPING IS STRENGTH",l2:"SMART DRIVERS WAIT"},
{l1:"THE ROAD IS NOT A GAME",l2:"PROTECT LIFE"},
{l1:"PAUSE YOUR SPEED",l2:"SAFETY FIRST"}
],

amber:[
{l1:"EASE OFF SPEED",l2:"SLOW DOWN"},
{l1:"CONTROL VEHICLE",l2:"PREPARE TO STOP"},
{l1:"REDUCE SPEED",l2:"WATCH SIGNAL"},
{l1:"SLOW YOUR DRIVE",l2:"STAY ALERT"},
{l1:"READY TO STOP",l2:"CHECK TRAFFIC"}
],

green:[
{l1:"MOVE SAFELY",l2:"KEEP SAFE DISTANCE"},
{l1:"GO WITH CONTROL",l2:"DRIVE RESPONSIBLY"},
{l1:"SAFE DRIVING",l2:"SMART DRIVING"},
{l1:"MAINTAIN SPEED",l2:"FOLLOW RULES"},
{l1:"DRIVE SAFE",l2:"ARRIVE SAFE"}
],

no:[
{l1:"SIGNAL HOLD",l2:"CONTROL SPEED"},
{l1:"WAIT AND WATCH",l2:"SAFE CROSSING"},
{l1:"MANUAL CONTROL",l2:"FOLLOW POLICE"},
{l1:"SIGNAL UNAVAILABLE",l2:"FOLLOW RULES"},
{l1:"NO CONTROLLER DATA",l2:"PROCEED CAREFULLY"}
],

ambulance:[
{l1:"AMBULANCE APPROACHING",l2:"CLEAR THE ROAD"},
{l1:"EMERGENCY VEHICLE",l2:"GIVE WAY"},
{l1:"LIFE SAVING VEHICLE",l2:"STOP IMMEDIATELY"},
{l1:"AMBULANCE PRIORITY",l2:"MOVE ASIDE"},
{l1:"EMERGENCY PASSAGE",l2:"KEEP ROAD CLEAR"}
]

};

}


// ================= AUTH =================

function requireAuth(req,res,next){
 const token=req.headers["x-auth-token"];
 if(validToken(token)) return next();
 res.status(401).json({error:"Unauthorized"});
}


// ================= HOME =================

app.get("/",(req,res)=>res.redirect("/login"));


// ================= LOGIN PAGE =================

app.get("/login",(req,res)=>{

res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Display Health Monitor</title>

<style>

body{
font-family:Times New Roman;
background:#f8efe6;
display:flex;
align-items:center;
justify-content:center;
height:100vh;
margin:0;
}

.card{
width:420px;
background:white;
padding:30px;
border-radius:18px;
box-shadow:0 15px 40px rgba(0,0,0,0.1);
}

input{
width:100%;
padding:12px;
margin:10px 0;
border-radius:10px;
border:1px solid #ddd;
}

button{
width:100%;
padding:12px;
border:none;
border-radius:10px;
background:#f97316;
color:white;
font-weight:bold;
cursor:pointer;
}

</style>

</head>

<body>

<div class="card">

<h2>Display Health Monitor</h2>
<p>Secure Login</p>

<input id="u" placeholder="Username">
<input id="p" type="password" placeholder="Password">

<button onclick="login()">Login</button>

<p id="err"></p>

</div>

<script>

async function login(){

const r=await fetch("/login",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({
username:document.getElementById("u").value,
password:document.getElementById("p").value
})
});

if(!r.ok){
document.getElementById("err").innerText="Invalid login";
return;
}

const html=await r.text();

document.open();
document.write(html);
document.close();

}

</script>

</body>
</html>
`);

});


// ================= LOGIN POST =================

app.post("/login",(req,res)=>{

const {username,password}=req.body;

if(username!==ADMIN_USER || password!==ADMIN_PASS)
return res.status(401).json({error:"Invalid login"});

const token=putToken();

res.send(renderDashboard(token));

});


// ================= HEARTBEAT FROM ESP =================

app.post("/heartbeat",(req,res)=>{

const {device_id,lat,lng}=req.body;

if(!device_id)
return res.status(400).json({error:"device_id required"});

DEVICES.set(device_id,{
device_id,
lat:lat||0,
lng:lng||0,
last_seen:Date.now()
});

if(!CLOUD.has(device_id)){
CLOUD.set(device_id,{
force:"",
slot:{red:0,amber:0,green:0,no:0,ambulance:0},
packs:defaultPacks(),
v:0
});
}

res.json({ok:true});

});


// ================= DEVICE LIST =================

app.get("/devices",(req,res)=>{

const arr=[];
const now=Date.now();

DEVICES.forEach(d=>{

const online=(now-d.last_seen)<=OFFLINE_MS;

arr.push({
device_id:d.device_id,
lat:d.lat,
lng:d.lng,
status:online?"online":"offline",
last_seen:d.last_seen
});

});

res.json(arr);

});


// ================= SEND MESSAGE =================

app.post("/api/simple",requireAuth,(req,res)=>{

const {device_id,force,sig,slot,line1,line2}=req.body;

if(!CLOUD.has(device_id))
return res.status(400).json({error:"device not registered"});

const m=CLOUD.get(device_id);

m.force=force||"";

m.packs[sig][slot]={l1:line1,l2:line2};

m.slot[sig]=slot;

m.v++;

CLOUD.set(device_id,m);

res.json({ok:true,v:m.v});

});


// ================= ESP PULL =================

app.get("/api/pull/:device_id",(req,res)=>{

const id=req.params.device_id;

if(!CLOUD.has(id))
return res.json({changed:false});

const m=CLOUD.get(id);

res.json({
changed:true,
force:m.force,
slot:m.slot,
packs:m.packs,
v:m.v
});

});


// ================= DASHBOARD =================

function renderDashboard(TOKEN){

return `
<!DOCTYPE html>
<html>

<head>

<title>Display Health Monitor</title>

<link rel="stylesheet"
href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>

<script
src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>

body{
margin:0;
font-family:Times New Roman;
background:#fff7ed;
}

#map{
height:100vh;
}

</style>

</head>

<body>

<div id="map"></div>

<script>

const TOKEN="${TOKEN}";

const map=L.map('map').setView([17.385,78.486],12);

L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
).addTo(map);

const markers=new Map();

async function load(){

const r=await fetch("/devices");
const data=await r.json();

data.forEach(d=>{

if(!markers.has(d.device_id)){

const m=L.marker([d.lat,d.lng])
.addTo(map)
.bindPopup(d.device_id+" "+d.status);

markers.set(d.device_id,m);

}else{

markers.get(d.device_id)
.setLatLng([d.lat,d.lng]);

}

});

}

load();
setInterval(load,2000);

</script>

</body>
</html>

`;

}


// ================= START =================

const PORT=process.env.PORT||5000;

app.listen(PORT,()=>{

console.log("Server started on "+PORT);

});