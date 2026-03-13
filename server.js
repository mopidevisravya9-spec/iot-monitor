const express = require("express");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.get("/air/update", async (req, res) => {
  try {

    const response = await axios.get(
      "https://iot-monitor-tol4.onrender.com/api/air/update",
      { params: req.query }
    );

    res.json(response.data);

  } catch (error) {
    res.status(500).json({ error: "Forwarding failed" });
  }
});

app.listen(PORT, () => {
  console.log("Proxy running on port", PORT);
});