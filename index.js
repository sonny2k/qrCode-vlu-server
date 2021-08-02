const express = require("express");
require("dotenv").config();
const config = require("config");

const app = express();
const httpServer = require("http").createServer(app);

const io = require("socket.io")(httpServer, {
  cors: {
    origin: ["https://vlu-qrcode-client.herokuapp.com"],
  },
});

app.set("socketIo", io);
// app.set("socketIoClasses", io.of("/api/classes"));
// app.set("socketIoUsers", io.of("/api/users"));

require("./startup/logging")();
require("./startup/prod")(app);
require("./startup/validation")();
require("./startup/db")();
require("./startup/routes")(app);

const port = process.env.PORT || 3900;

const server = httpServer.listen(port, () => {
  console.log(`Listening on Port ${port}...`);
});

module.exports = server;
