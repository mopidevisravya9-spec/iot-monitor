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

function makeToken(){ return crypto.randomBytes(24).toString("hex"); }
function putToken(){
const t = makeToken();
TOKENS.set(t,{exp:Date.now()+TOKEN_TTL_MS});
return t;
}
function isValidToken(t){
if(!t) return false;
const row=TOKENS.get(t);
if(!row) return false;
if(Date.now()>row.exp){TOKENS.delete(t);return false;}
return true;
}

setInterval(()=>{
const now=Date.now();
for(const [t,row] of TOKENS.entries()){
if(now>row.exp) TOKENS.delete(t);
}
},60000);

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor";

mongoose.connect(MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log("DB Error:",err));

const OFFLINE_AFTER_MS=30000;
const MSG_SLOTS=5;

const deviceSchema=new mongoose.Schema({
device_id:{type:String,unique:true,required:true},
lat:{type:Number,default:0},
lng:{type:Number,default:0},
last_seen:{type:Number,default:0},
status:{type:String,default:"offline"}
});

const cloudMsgSchema=new mongoose.Schema({
device_id:{type:String,unique:true,required:true},
force:{type:String,default:""},
slot:{
red:{type:Number,default:0},
amber:{type:Number,default:0},
green:{type:Number,default:0},
no:{type:Number,default:0}
},
packs:{type:Object,default:{}},
v:{type:Number,default:0},
updated_at:{type:Number,default:0}
});

const Device=mongoose.model("Device",deviceSchema);
const CloudMsg=mongoose.model("CloudMsg",cloudMsgSchema);

async function ensureMsgRow(device_id){
return CloudMsg.findOneAndUpdate(
{device_id},
{$setOnInsert:{device_id}},
{upsert:true,new:true}
);
}

function requireAuth(req,res,next){
const token=req.headers["x-auth-token"];
if(isValidToken(token)) return next();
res.status(401).json({error:"Unauthorized"});
}

app.get("/",(req,res)=>res.redirect("/login"));

app.get("/login",(req,res)=>{
res.send(`

<html>
<head>
<title>Login</title>
<style>
body{font-family:Times New Roman;background:#fff7ed;display:flex;align-items:center;justify-content:center;height:100vh}
.card{background:white;padding:30px;border-radius:12px;border:1px solid #fed7aa}
input{display:block;margin-top:10px;padding:10px;width:220px}
button{margin-top:10px;padding:10px;width:220px;background:#f97316;color:white;border:none}
</style>
</head>
<body>
<div class="card">
<h2>Display Health Monitor</h2>
<form id="f">
<input id="u" placeholder="Username">
<input id="p" type="password" placeholder="Password">
<button>Login</button>
</form>
<div id="err"></div>
</div>

<script>
document.getElementById("f").onsubmit=async e=>{
e.preventDefault()
const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u.value,password:p.value})})
if(!r.ok){err.innerText="Invalid login";return}
document.open();document.write(await r.text());document.close();
}
</script>

</body>
</html>
`);
});

app.post("/login",(req,res)=>{
const {username,password}=req.body||{};
if(username!==ADMIN_USER||password!==ADMIN_PASS)
return res.status(401).json({error:"Invalid"});
const token=putToken();
res.send(renderDashboardHTML(token));
});

app.get("/devices",async(req,res)=>{
const now=Date.now();
await Device.updateMany(
{last_seen:{$lt:now-OFFLINE_AFTER_MS}},
{$set:{status:"offline"}}
);
res.json(await Device.find());
});

app.post("/register",async(req,res)=>{
const {device_id,lat,lng}=req.body;
const now=Date.now();

const d=await Device.findOneAndUpdate(
{device_id},
{$set:{lat,lng,last_seen:now,status:"online"}},
{upsert:true,new:true}
);

await ensureMsgRow(device_id);

res.json({ok:true});
});

app.post("/heartbeat",async(req,res)=>{
const {device_id}=req.body;
await Device.findOneAndUpdate(
{device_id},
{$set:{last_seen:Date.now(),status:"online"}}
);
res.json({ok:true});
});

app.post("/api/simple",requireAuth,async(req,res)=>{

const {device_id,force,sig,slot,line1,line2}=req.body;

const dev=await Device.findOne({device_id});
if(!dev||dev.status!=="online")
return res.status(400).json({error:"Device offline"});

const doc=await ensureMsgRow(device_id);

doc.force=force||"";
doc.v++;
doc.updated_at=Date.now();

await doc.save();

res.json({ok:true});
});

function renderDashboardHTML(TOKEN){
return `

<html>
<head>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>
body{margin:0;font-family:Times New Roman;background:#fff7ed}
.sidebar{width:260px;background:white;border-right:1px solid #fed7aa;height:100vh;float:left;padding:15px}
.content{margin-left:260px;height:100vh}
button{padding:10px;margin-top:6px;border:1px solid #fed7aa;background:white;width:100%;cursor:pointer}
#map{height:100%}
.panel{padding:15px}
</style>

</head>

<body>

<div class="sidebar">

<h3>Display Monitor</h3>

<button onclick="showTab('map')">MAP</button> <button onclick="showTab('msg')">MESSAGES</button>

</div>

<div class="content">

<div id="mapView">
<div id="map"></div>
</div>

<div id="msgView" style="display:none">

<div class="panel">

<h3>Junction Messages</h3>

<div id="junctions"></div>

<div id="arms" style="margin-top:10px"></div>

<hr>

<h3>Send Message</h3>

<input id="device" placeholder="Selected device" readonly>

<select id="force">
<option value="">AUTO</option>
<option value="red">RED</option>
<option value="amber">AMBER</option>
<option value="green">GREEN</option>
</select>

<select id="sig">
<option value="red">RED</option>
<option value="amber">AMBER</option>
<option value="green">GREEN</option>
<option value="no">NO SIGNAL</option>
</select>

<input id="line1" placeholder="Line1">
<input id="line2" placeholder="Line2">

<button onclick="sendMsg()">Send</button>

<div id="status"></div>

</div>
</div>

</div>

<script>

const AUTH_TOKEN="${TOKEN}"

function showTab(t){
mapView.style.display=t==="map"?"block":"none"
msgView.style.display=t==="msg"?"block":"none"
}

const map=L.map('map').setView([17.3850,78.4867],12)

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)

const JUNCTIONS={

"Ameerpet":[
{name:"North Road",device:"ameerpet_arm1"},
{name:"South Road",device:"ameerpet_arm2"},
{name:"East Road",device:"ameerpet_arm3"},
{name:"West Road",device:"ameerpet_arm4"}
],

"Paradise":[
{name:"Secunderabad Road",device:"paradise_arm1"},
{name:"Begumpet Road",device:"paradise_arm2"},
{name:"Tankbund Road",device:"paradise_arm3"},
{name:"MG Road",device:"paradise_arm4"}
],

"Punjagutta":[
{name:"Arm1",device:"punjagutta_arm1"},
{name:"Arm2",device:"punjagutta_arm2"},
{name:"Arm3",device:"punjagutta_arm3"},
{name:"Arm4",device:"punjagutta_arm4"}
]

}

let openJunction=null

function loadJunctions(){

const box=document.getElementById("junctions")

Object.keys(JUNCTIONS).forEach(j=>{

const b=document.createElement("button")
b.innerText=j
b.onclick=()=>toggleJunction(j)

box.appendChild(b)

})

}

function toggleJunction(j){

const arms=document.getElementById("arms")

if(openJunction===j){
arms.innerHTML=""
openJunction=null
return
}

openJunction=j
arms.innerHTML=""

JUNCTIONS[j].forEach(a=>{

const b=document.createElement("button")
b.innerText=a.name
b.onclick=()=>selectArm(a.device)

arms.appendChild(b)

})

}

function selectArm(device){

document.getElementById("device").value=device

}

async function sendMsg(){

const device=document.getElementById("device").value

if(!device){
status.innerText="Select arm first"
return
}

const payload={
device_id:device,
force:force.value,
sig:sig.value,
slot:0,
line1:line1.value,
line2:line2.value
}

const r=await fetch("/api/simple",{
method:"POST",
headers:{
"Content-Type":"application/json",
"X-Auth-Token":AUTH_TOKEN
},
body:JSON.stringify(payload)
})

if(r.ok) status.innerText="Sent"
else status.innerText="Failed"

}

loadJunctions()

</script>

</body>
</html>
`;
}

const PORT=process.env.PORT||5000;

app.listen(PORT,()=>console.log("Server started on port "+PORT));
