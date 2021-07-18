const express = require("express");
const _ = require("lodash");
const mongoose = require("mongoose");
const { Semesters } = require("../models/semesters");
const Fawn = require("../utils/transaction");
const Joi = require("joi");

const validate = require("../middleware/validate");
const validateObjectId = require("../middleware/validateObjectId");
const { Classes } = require("../models/classes");

const router = express.Router();

router.get("/:id", async (req, res) => {
  let myClass = await Classes.findById(req.params.id);
  if (myClass) return res.status(400).send("Id class not exist in system");

  res.send(myClass.lesson);
});

router.get("/:id/order", async (req, res) => {
  const order = req.params.order;

  let myClass = await Classes.findById(id);
  if (!myClass) return res.status(400).send("Id class not exist in system");

  if (isNaN(order) || order < 1 || order > myClass.lessons.length) {
    return res.status(400).send("Invalid order");
  }

  res.send(myClass.lesson[order - 1]);
});

router.post(
  "/:id/:order",
  [validateObjectId, validate(validateLesson)],
  async (req, res) => {
    const { expiredTime, qrCode } = req.body;
    const { id, order } = req.params;

    let myClass = await Classes.findById(id);
    if (!myClass) return res.status(400).send("Id class not exist in system");

    if (isNaN(order) || order < 1 || order > myClass.lessons.length) {
      return res.status(400).send("Invalid order");
    }
    myClass.lessons[order - 1].expiredTime = expiredTime;
    myClass.lessons[order - 1].qrCode = qrCode;
    myClass.lessons[order - 1].status = "Activated";

    myClass.save();
    res.send(myClass);
  }
);

router.put("/:id/:order", validate(validateAttendance), async (req, res) => {
  const { mail } = req.body;
  const { id, order } = req.params;

  let myClass = await Classes.findById(id);
  if (!myClass) return res.status(400).send("Id class not exist in system");

  if (isNaN(order) || order < 1 || order > myClass.lessons.length) {
    return res.status(400).send("Invalid order");
  }

  const expiredTime = myClass.lessons[order - 1].expiredTime;

  const qrCode = myClass.lessons[order - 1].qrCode;

  const timeSet = _.split(qrCode, "_", 3);

  const diff = new Date() - new Date(timeSet[2]);

  if (new Date(diff).getMinutes() >= expiredTime) {
    return res.status(403).send("Expired QrCode");
  }

  const result = myClass.lessons[order - 1].students.find((x) => {
    if (x.mail === mail) {
      const currentStatus = new Date(x.status);
      if (currentStatus == "Invalid Date") {
        myClass.lessons[order - 1].numOfAttendance++;
        myClass.lessons[order - 1].numOfNonAttendance--;
        myClass.sumOfAttendance++;
        myClass.sumOfNonAttendance--;

        myClass.lessons[order - 1].averageOfAttendance =
          myClass.lessons.reduce((reducer, currentValue) => {
            return reducer + currentValue.numOfAttendance;
          }) / myClass.numOfStudents;

        myClass.lessons[order - 1].averageOfAttendance =
          myClass.lessons.reduce((reducer, currentValue) => {
            return reducer + currentValue.numOfNonAttendance;
          }) / myClass.numOfStudents;

        myClass.averageOfAttendance =
          myClass.lessons.reduce((reducer, currentValue) => {
            return reducer + currentValue.averageOfAttendance;
          }) / myClass.lessons.length;

        myClass.averageOfNonAttendance =
          myClass.lessons.reduce((reducer, currentValue) => {
            return reducer + currentValue.averageOfNonAttendance;
          }) / myClass.lessons.length;

        const date = new Date();
        x.status = `${date.getFullYear()}-${
          date.getMonth() + 1
        }-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
      } else {
        myClass.lessons[order - 1].numOfAttendance--;
        myClass.lessons[order - 1].numOfNonAttendance++;
        myClass.sumOfAttendance--;
        myClass.sumOfNonAttendance++;
        x.status = "Not Attended";
      }
      return x;
    }
  });

  if (!result) return res.status(404).send("Not find student in Class");

  myClass.save();
  res.send(myClass);
});

function validateLesson(req) {
  const schema = Joi.object({
    expiredTime: Joi.number().required(),
    qrCode: Joi.string().required(),
  });
  return schema.validate(req);
}

function validateAttendance(req) {
  const schema = Joi.object({
    mail: Joi.string()
      .email({ tlds: { allow: false } })
      .required(),
  });
  return schema.validate(req);
}

module.exports = router;
