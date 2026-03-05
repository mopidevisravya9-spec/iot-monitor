const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ======================
// LOGIN
// ======================
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

// ======================
// DATABASE
// ======================
mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/iot-monitor")
.then(()=>console.log("MongoDB Connected"))
.catch(e=>console.log("DB Error",e));

// ======================
// DEVICE MODEL
// ======================
const deviceSchema = new mongoose.Schema({
  device_id:String,
  lat:Number,
  lng:Number,
  last_seen:Number,
  status:String
});

const Device = mongoose.model("Device",deviceSchema);

// ======================
// LOGIN PAGE
// ======================
app.get("/login",(req,res)=>{
res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Login</title>
</head>
<body style="font-family:Times New Roman">
<h2>Display Monitor Login</h2>
<form method="POST" action="/login">
<input name="username" placeholder="username"/><br><br>
<input name="password" type="password" placeholder="password"/><br><br>
<button type="submit">Login</button>
</form>
</body>
</html>
`);
});

// ======================
// LOGIN POST
// ======================
app.post("/login",(req,res)=>{
const {username,password}=req.body;

if(username!==ADMIN_USER || password!==ADMIN_PASS)
return res.send("Invalid login");

const token=putToken();

res.send(renderDashboardHTML(token));
});

// ======================
// DEVICE HEARTBEAT
// ======================
app.post("/heartbeat",async(req,res)=>{

const {device_id,lat,lng}=req.body;

await Device.findOneAndUpdate(
{device_id},
{
device_id,
lat,
lng,
last_seen:Date.now(),
status:"online"
},
{upsert:true}
);

res.json({ok:true});

});

// ======================
// DEVICES LIST
// ======================
app.get("/devices",async(req,res)=>{

const devices=await Device.find();

devices.forEach(d=>{
if(Date.now()-d.last_seen>30000)
d.status="offline";
});

res.json(devices);

});

// ======================
// MESSAGE API
// ======================
app.post("/api/simple",async(req,res)=>{

const {device_id,line1,line2}=req.body;

console.log("SEND TO",device_id,line1,line2);

res.json({ok:true});

});

// ======================
// DASHBOARD
// ======================
function renderDashboardHTML(TOKEN){

return `
<!DOCTYPE html>
<html>
<head>

<meta charset="utf-8"/>

<style>

body{
margin:0;
font-family:"Times New Roman";
background:#fff7ed;
}

.sidebar{
width:250px;
background:white;
height:100vh;
float:left;
padding:20px;
border-right:1px solid #fed7aa;
}

.content{
margin-left:250px;
padding:20px;
}

.junction{
padding:10px;
border:1px solid #fed7aa;
margin-bottom:6px;
cursor:pointer;
border-radius:8px;
}

.arm{
margin-left:20px;
margin-top:4px;
}

button{
padding:10px;
border:none;
background:#f97316;
color:white;
border-radius:8px;
cursor:pointer;
}

input{
padding:8px;
width:200px;
}

</style>

</head>

<body>

<div class="sidebar">

<h3>MESSAGES</h3>

<div id="junctionList"></div>

</div>

<div class="content">

<h3>Send Message</h3>

Device : <span id="device"></span>

<br><br>

Line1<br>
<input id="line1"/>

<br><br>

Line2<br>
<input id="line2"/>

<br><br>

<button onclick="send()">Send to ESP</button>

</div>

<script>

const TOKEN="${TOKEN}"

let selectedDevice=""

const JUNCTIONS={

"Ameerpet":{
"Road1":"ameerpet_1",
"Road2":"ameerpet_2",
"Road3":"ameerpet_3",
"Road4":"ameerpet_4"
},

"Paradise":{
"Road1":"paradise_1",
"Road2":"paradise_2",
"Road3":"paradise_3",
"Road4":"paradise_4"
},

"Punjagutta":{
"Road1":"punjagutta_1",
"Road2":"punjagutta_2",
"Road3":"punjagutta_3",
"Road4":"punjagutta_4"
}

}

function renderJunctions(){

const div=document.getElementById("junctionList")

Object.keys(JUNCTIONS).forEach(j=>{

const junc=document.createElement("div")
junc.className="junction"
junc.innerText=j

const arms=document.createElement("div")
arms.style.display="none"

Object.keys(JUNCTIONS[j]).forEach(a=>{

const arm=document.createElement("div")
arm.className="arm"

const btn=document.createElement("button")
btn.innerText=a

btn.onclick=()=>{

selectedDevice=JUNCTIONS[j][a]

document.getElementById("device").innerText=selectedDevice

}

arm.appendChild(btn)

arms.appendChild(arm)

})

junc.onclick=()=>{

arms.style.display=
arms.style.display==="none"?"block":"none"

}

div.appendChild(junc)
div.appendChild(arms)

})

}

renderJunctions()

async function send(){

if(!selectedDevice){

alert("select junction arm")

return

}

const payload={

device_id:selectedDevice,

line1:document.getElementById("line1").value,

line2:document.getElementById("line2").value

}

await fetch("/api/simple",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify(payload)

})

alert("sent")

}

</script>

</body>
</html>
`

}

// ======================
const PORT=process.env.PORT||5000;

app.listen(PORT,()=>{

console.log("Server started "+PORT)

});