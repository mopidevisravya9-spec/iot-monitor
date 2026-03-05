// ======================
// IMPORTS
// ======================

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
// LOGIN CONFIG
// ======================

const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";

const TOKENS = new Map();
const TOKEN_TTL_MS = 30 * 60 * 1000;

function makeToken(){
  return crypto.randomBytes(24).toString("hex");
}

function putToken(){
  const t = makeToken();
  TOKENS.set(t,{exp:Date.now()+TOKEN_TTL_MS});
  return t;
}

function isValidToken(t){
  if(!t) return false;
  const row = TOKENS.get(t);
  if(!row) return false;
  if(Date.now()>row.exp){
    TOKENS.delete(t);
    return false;
  }
  return true;
}

setInterval(()=>{
  const now=Date.now();
  for(const [t,row] of TOKENS.entries()){
    if(now>row.exp) TOKENS.delete(t);
  }
},60000);


// ======================
// DATABASE
// ======================

const MONGO_URI =
process.env.MONGO_URI ||
"mongodb://127.0.0.1:27017/iot-monitor";

mongoose.connect(MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log("DB Error:",err));


// ======================
// CONSTANTS
// ======================

const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;


// ======================
// JUNCTION CONFIG
// ======================

const JUNCTIONS = {

  "NALLAGUTTA":{
    arms:{
      "KIMS HOSPITAL":"ESP_001",
      "RANIGUNJ":"ESP_002"
    }
  }

};


// ======================
// MODELS
// ======================

const deviceSchema = new mongoose.Schema({

  device_id:{type:String,unique:true,required:true},
  lat:{type:Number,default:0},
  lng:{type:Number,default:0},
  last_seen:{type:Number,default:0},
  status:{type:String,default:"offline"}

});


const cloudMsgSchema = new mongoose.Schema({

  device_id:{type:String,unique:true,required:true},

  force:{type:String,default:""},

  slot:{
    red:{type:Number,default:0},
    amber:{type:Number,default:0},
    green:{type:Number,default:0},
    no:{type:Number,default:0}
  },

  packs:{
    red:{type:Array,default:[]},
    amber:{type:Array,default:[]},
    green:{type:Array,default:[]},
    no:{type:Array,default:[]}
  },

  v:{type:Number,default:0},
  updated_at:{type:Number,default:0}

});

const Device = mongoose.model("Device",deviceSchema);
const CloudMsg = mongoose.model("CloudMsg",cloudMsgSchema);


// ======================
// HELPERS
// ======================

async function ensureMsgRow(device_id){

  return CloudMsg.findOneAndUpdate(
    {device_id},
    {$setOnInsert:{device_id}},
    {upsert:true,new:true}
  );

}

function isDeviceOnlineRow(dev){

  if(!dev) return false;

  return (Date.now()-dev.last_seen) <= OFFLINE_AFTER_MS;

}


// ======================
// AUTH
// ======================

function requireAuth(req,res,next){

  const token=req.headers["x-auth-token"];

  if(isValidToken(token)) return next();

  res.status(401).json({error:"Unauthorized"});

}


// ======================
// LOGIN ROUTES
// ======================

app.get("/",(req,res)=>res.redirect("/login"));

app.get("/login",(req,res)=>{

  res.send("LOGIN PAGE");

});

app.post("/login",(req,res)=>{

  const {username,password}=req.body;

  if(username!==ADMIN_USER || password!==ADMIN_PASS)
    return res.status(401).json({error:"Invalid login"});

  const token=putToken();

  res.json({token});

});

app.get("/dashboard",(req,res)=>res.redirect("/login"));


// ======================
// DEVICE REGISTER
// ======================

app.post("/register",async(req,res)=>{

  const {device_id,lat,lng}=req.body;

  const now=Date.now();

  const doc=await Device.findOneAndUpdate(
    {device_id},
    {
      device_id,
      lat,
      lng,
      last_seen:now,
      status:"online"
    },
    {upsert:true,new:true}
  );

  await ensureMsgRow(device_id);

  res.json({message:"Registered",device:doc});

});


// ======================
// HEARTBEAT
// ======================

app.post("/heartbeat",async(req,res)=>{

  const {device_id,lat,lng}=req.body;

  const now=Date.now();

  await Device.findOneAndUpdate(
    {device_id},
    {
      last_seen:now,
      status:"online",
      lat,
      lng
    },
    {upsert:true}
  );

  await ensureMsgRow(device_id);

  res.json({message:"OK"});

});


// ======================
// DEVICES
// ======================

app.get("/devices",async(req,res)=>{

  const now=Date.now();

  await Device.updateMany(
    {last_seen:{$lt:now-OFFLINE_AFTER_MS}},
    {$set:{status:"offline"}}
  );

  const data=await Device.find();

  res.json(data);

});


// ======================
// GET JUNCTIONS
// ======================

app.get("/junctions",(req,res)=>{

  res.json(JUNCTIONS);

});


// ======================
// SIMPLE MESSAGE SEND
// ======================

app.post("/api/simple",requireAuth,async(req,res)=>{

  const {device_id,sig,slot,line1,line2}=req.body;

  const dev=await Device.findOne({device_id});

  if(!isDeviceOnlineRow(dev))
    return res.status(400).json({error:"Device offline"});

  const doc=await ensureMsgRow(device_id);

  const packs=doc.packs||{};

  if(!packs[sig]) packs[sig]=[];

  packs[sig][slot]={l1:line1,l2:line2};

  doc.packs=packs;

  const slotObj=doc.slot||{};

  slotObj[sig]=slot;

  doc.slot=slotObj;

  doc.v++;

  doc.updated_at=Date.now();

  await doc.save();

  res.json({ok:true});

});


// ======================
// JUNCTION MESSAGE SEND
// ======================

app.post("/api/junctionSend",requireAuth,async(req,res)=>{

  const {junction,arm,sig,slot,line1,line2}=req.body;

  const j=JUNCTIONS[junction];

  if(!j) return res.status(404).json({error:"junction not found"});

  let devices=[];

  if(arm==="ALL")
    devices=Object.values(j.arms);
  else
    devices=[j.arms[arm]];

  for(const device_id of devices){

    const dev=await Device.findOne({device_id});

    if(!isDeviceOnlineRow(dev)) continue;

    const doc=await ensureMsgRow(device_id);

    const packs=doc.packs||{};

    if(!packs[sig]) packs[sig]=[];

    packs[sig][slot]={l1:line1,l2:line2};

    doc.packs=packs;

    const slotObj=doc.slot||{};

    slotObj[sig]=slot;

    doc.slot=slotObj;

    doc.v++;

    doc.updated_at=Date.now();

    await doc.save();

  }

  res.json({ok:true,devices});

});


// ======================
// ESP PULL
// ======================

app.get("/api/pull/:device_id",async(req,res)=>{

  const device_id=req.params.device_id;

  const since=Number(req.query.since||0);

  const doc=await ensureMsgRow(device_id);

  const v=doc.v||0;

  if(since>=v)
    return res.json({ok:true,changed:false,v});

  res.json({
    ok:true,
    changed:true,
    v,
    force:doc.force,
    slot:doc.slot,
    packs:doc.packs
  });

});


// ======================
// START SERVER
// ======================

const PORT=process.env.PORT||5000;

app.listen(PORT,()=>{

  console.log("Server started on port "+PORT);

});