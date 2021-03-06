const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

module.exports = function (app) {
  app.use(helmet());
  app.use(
    cors({
      origin: "https://vlu-qrcode-client.herokuapp.com",
      // origin: "http://localhost:3000",
    })
  );
  app.use(compression());
};
