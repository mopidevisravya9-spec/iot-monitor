const express = require("express");
const app = express();

app.use(express.json());

let latestMessage = "Waiting sensor data...";

app.post("/update", (req, res) => {
  latestMessage = req.body.text;
  console.log("NEW DATA:", latestMessage);
  res.send({status:"ok"});
});

app.get("/read", (req, res) => {
  res.send({text: latestMessage});
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});