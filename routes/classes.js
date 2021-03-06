// import moment from "moment";
const moment = require("moment");
const express = require("express");
const _ = require("lodash");
const mongoose = require("mongoose");
const { Semesters } = require("../models/semesters");
const Fawn = require("../utils/transaction");

const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const validateObjectId = require("../middleware/validateObjectId");
const {
  Classes,
  validateClass,
  validateStudentInClass,
} = require("../models/classes");
const { Users } = require("../models/users");
const { Students } = require("../models/students");

const router = express.Router();

router.get("/", async (req, res) => {
  let classes = null;
  if (req.user?.role === "lecturer") {
    classes = await Classes.find({ "lecturer.mail": req.user.mail });
  } else {
    classes = await Classes.find();
  }

  res.send(classes);
});

router.get("/:id", async (req, res) => {
  let classOne = await Classes.findOne({ _id: req.params.id });
  res.send(classOne);
});

// api for get lessons of that student
router.get("/student/:studentId", async (req, res) => {
  const { studentId } = req.params;
  let classes = await Classes.find({});
});

router.post("/", [validate(validateClass), auth], async (req, res) => {
  const {
    classTermId,
    name,
    numOfCredits,
    courseType,
    schoolYear,
    startDate,
    endDate,
    session,
    room,
    dayOfWeek,
    numOfWeek,
    semesterId,
    lecturerMail,
  } = req.body;

  var io = req.app.get("socketIo");

  const editor = req.user;

  let myClass = await Classes.findOne({ classTermId });
  if (myClass) return res.status(400).send("Class Term Id was exist");

  let semester;
  if (mongoose.Types.ObjectId.isValid(semesterId)) {
    semester = await Semesters.findById(semesterId);
  } else {
    semester = await Semesters.findOne({ symbol: semesterId });
  }
  if (!semester) return res.status(400).send("Semester not found");

  let lecturer = await Users.findOne({ mail: lecturerMail });
  if (!lecturer) {
    lecturer = {
      name: "waiting lecturer registered...",
      userId: "waiting lecturer registered",
      mail: lecturerMail,
      degree: "lecturer",
    };
  }

  myClass = new Classes({
    classTermId,
    name,
    numOfCredits,
    courseType,
    schoolYear,
    startDate,
    endDate,
    room,
    dayOfWeek,
    session,
    numOfWeek,
    sumOfAttendance: 0,
    sumOfNonAttendance: 0,
    averageOfAttendance: 0,
    averageOfNonAttendance: 0,
    numOfStudents: 0,
    semester: {
      _id: semester._id,
      name: semester.name,
      symbol: semester.symbol,
      year: semester.year,
    },
    lecturer: {
      lecturerId: lecturer.userId,
      name: lecturer.name,
      mail: lecturer.mail,
      degree: lecturer.degree,
    },
    lessons: generateLessons(numOfWeek),
    editor: `${editor.mail} (${editor.role})`,
    lastUpdated: moment().locale("vi").format("L LTS"),
  });

  try {
    const task = new Fawn.Task();
    task.save("classes", myClass);
    task.update(
      "users",
      { mail: lecturer.mail },
      {
        $push: { classes: myClass._id },
      }
    );
    await task.run({ useMongoose: true });

    const classes = await Classes.find();

    // io.on("connection", (socket) => {
    //   console.log("hello ", socket.id);
    // });

    io.emit("getNewClasses", classes);

    res.send(myClass);
  } catch (error) {
    console.log(error);
    res.status(500).send("Something failed on server");
  }
});

router.post(
  "/:id",
  [validate(validateStudentInClass), auth],
  async (req, res) => {
    const { id } = req.params;
    const { mail } = req.body;

    var io = req.app.get("socketIo");

    var editor = req.user;

    let myClass = await Classes.findById(id);
    if (!myClass) return res.status(400).send("Given class id not found");

    const studentExist = myClass.lessons[0].students.find(
      (x) => x?.mail === mail
    );
    if (studentExist) return res.status(400).send("student was exist in class");

    let student = await Students.findOne({ mail });
    if (!student) {
      student = {
        name: "Student not login yet",
        studentId: "Student not login yet",
      };
    }

    // await Promise.all(
    //   myClass.lessons.map((x) => {
    //     x.students.push({
    //       mail,
    //       name: student["name"],
    //       studentId: student["studentId"],
    //       status: "Not Attended",
    //     });
    //     x.numOfNonAttendance++;
    //   })
    // );

    try {
      const task = new Fawn.Task();
      task.update(
        "classes",
        { _id: myClass?._id },
        {
          $set: {
            editor: `${editor.mail} (${editor.role})`,
            lastUpdated: moment().locale("vi").format("L LTS"),
          },
          $inc: {
            numOfStudents: 1,
            sumOfNonAttendance: myClass.lessons.length,
            "lessons.$[].numOfNonAttendance": 1,
          },
          $push: {
            "lessons.$[].students": {
              mail,
              name: student["name"],
              studentId: student["studentId"],
              status: "Not Attended",
            },
          },
        }
      );
      task.update(
        "students",
        { mail },
        {
          $push: {
            classes: {
              _id: myClass._id,
              classTermId: myClass.classTermId,
              name: myClass.name,
              lecturer: myClass.lecturer,
            },
            history: {
              _id: mongoose.Types.ObjectId(),
              time: new Date(),
              title: "You was added in Class",
              description: `You was Added in class ${myClass.name} - ${myClass.classTermId}`,
            },
          },
        }
      );
      await task.run({ useMongoose: true });

      const newClasses = await Classes.find();
      myClass = await Classes.findById(id);
      io.emit("getNewClasses", newClasses);
      io.emit("newStudent", myClass);
      res.send("Successfully");
    } catch (error) {
      console.log(error);
      res.status(500).send("Something failed");
    }
  }
);

router.put(
  "/:id/:mail",
  [validateObjectId, validate(validateStudentInClass), auth],
  async (req, res) => {
    const { id, mail } = req.params;
    const student = req.body;

    var io = req.app.get("socketIo");

    var editor = req.user;

    let myClass = await Classes.findById(id);
    if (!myClass) return res.status(400).send("Given input not found");

    const isExist = myClass.lessons[0].students.find((x) => x?.mail === mail);
    if (!isExist) return res.status(400).send("Student not found in Class");

    myClass.lessons.map((x) => {
      x.students.find((y) => {
        if (y.mail === mail) {
          y.name = student.name;
          y.studentId = student.studentId;
        }
      });
    });

    myClass.editor = `${editor.mail} (${editor.role})`;
    myClass.lastUpdated = moment().locale("vi").format("L LTS");
    await myClass.save();

    const newClasses = await Classes.find();
    io.emit("getNewClasses", newClasses);
    io.emit("newStudent", myClass);
    res.send("Successfully");
  }
);

router.delete("/:id/:mail", auth, async (req, res) => {
  const { id, mail } = req.params;

  var io = req.app.get("socketIo");

  const editor = req.user;

  let myClass = await Classes.findById(id);
  if (!myClass) return res.status(400).send("Given input not found");

  const student = myClass.lessons[0].students.find((x) => x?.mail === mail);
  if (!student) return res.status(400).send("Student not found in Class");

  myClass.lessons.map((x) => {
    x.students.map((y) => {
      if (y.mail === mail) {
        if (y.status === "Not Attended") {
          x.numOfNonAttendance--;
          x.averageOfNonAttendance = x.numOfNonAttendance / x.students.length;
        } else {
          x.numOfAttendance--;
          x.averageOfAttendance = x.numOfAttendance / x.students.length;
        }
      }
    });
  });

  try {
    const task = new Fawn.Task();
    task.update(
      "classes",
      { _id: myClass._id },
      {
        $inc: {
          numOfStudents: -1,
        },
        $set: {
          lessons: myClass.lessons,
          editor: `${editor.mail} (${editor.role})`,
          lastUpdated: moment().locale("vi").format("L LTS"),
        },
      }
    );
    task.update(
      "classes",
      { _id: myClass._id },
      {
        $pull: {
          "lessons.$[].students": {
            mail: student.mail,
          },
        },
      }
    );
    task.update(
      "classes",
      { _id: myClass._id },
      {
        $set: {
          sumOfAttendance: myClass.lessons.reduce((reducer, currentValue) => {
            return reducer + currentValue.numOfAttendance;
          }, 0),
          sumOfNonAttendance: myClass.lessons.reduce(
            (reducer, currentValue) => {
              return reducer + currentValue.numOfNonAttendance;
            },
            0
          ),
          averageOfAttendance:
            myClass.lessons.reduce((reducer, currentValue) => {
              return reducer + currentValue.averageOfAttendance;
            }, 0) / myClass.lessons.length,

          averageOfNonAttendance:
            myClass.lessons.reduce((reducer, currentValue) => {
              return reducer + currentValue.averageOfNonAttendance;
            }, 0) / myClass.lessons.length,
        },
      }
    );
    task.update(
      "students",
      { mail },
      {
        $pull: {
          classes: {
            _id: myClass._id,
          },
        },
        $push: {
          history: {
            _id: mongoose.Types.ObjectId(),
            time: new Date(),
            title: "You was removed",
            description: `You was removed in class ${myClass.name} - ${myClass.classTermId}`,
          },
        },
      }
    );
    await task.run({ useMongoose: true });

    const newData = await Classes.findById(id);

    const newClasses = await Classes.find();
    io.emit("getNewClasses", newClasses);
    io.emit("newStudent", newData);
    res.send(newData);
  } catch (error) {
    res.status(500).send("Something failed on server");
  }
});

router.put(
  "/:id",
  [validateObjectId, validate(validateClass), auth],
  async (req, res) => {
    const { id } = req.params;
    const {
      classTermId,
      name,
      numOfCredits,
      courseType,
      schoolYear,
      startDate,
      endDate,
      room,
      numOfWeek,
      dayOfWeek,
      session,
      semesterId,
      lecturerMail,
    } = req.body;

    var io = req.app.get("socketIo");

    const editor = req.user;

    let myClass = await Classes.findById(id);
    if (!myClass) return res.status(400).send("Invalid class id");

    let lecturer = await Users.findOne({ mail: lecturerMail });
    if (!lecturer) {
      lecturer = {
        name: "waiting lecturer registered",
        lecturerId: "waiting lecturer registered",
        mail: lecturerMail,
        degree: "waiting lecturer registered",
      };
    } else {
      lecturer = {
        _id: lecturer._id,
        name: lecturer.name,
        lecturerId: lecturer.userId,
        mail: lecturer.mail,
        degree: lecturer.degree,
      };
    }

    const semester = await Semesters.findOne({ _id: semesterId });
    if (!semester) return res.status(400).send("Invalid semester Id");

    try {
      const task = new Fawn.Task();

      task.update(
        "classes",
        { _id: myClass._id },
        {
          $set: {
            classTermId,
            name,
            numOfCredits,
            courseType,
            schoolYear,
            startDate,
            endDate,
            room,
            numOfWeek,
            dayOfWeek,
            session,
            lecturer,
            semester,
            editor: `${editor.mail} (${editor.role})`,
            lastUpdated: moment().locale("vi").format("L LTS"),
          },
        }
      );
      if (myClass.lecturer.mail !== lecturerMail) {
        task.update(
          "users",
          { mail: myClass.lecturer.mail },
          {
            $pull: { classes: myClass._id },
          }
        );
      }
      task.update(
        "users",
        { mail: lecturerMail },
        {
          $push: { classes: myClass._id },
        }
      );
      myClass.lessons[0].students.map((x) => {
        task.update(
          "students",
          { mail: x.mail, "classes._id": myClass._id },
          { $set: { "classes.$.lecturer": lecturer } }
        );
      });

      await task.run({ useMongoose: true });

      myClass = await Classes.findById(id);

      const classes = await Classes.find();
      io.emit("getNewClasses", classes);
      res.send(myClass);
    } catch (error) {
      res.status(500).send("Something failed on server");
    }
  }
);

router.delete("/:id", validateObjectId, async (req, res) => {
  const classes = await Classes.findById(req.params.id);
  var io = req.app.get("socketIo");

  if (!classes)
    return res.status(404).send("The Classes with the given ID was not found");

  try {
    const task = new Fawn.Task();
    await Promise.all(
      classes.lessons[0].students.map(async (x) => {
        await task.update(
          "students",
          { mail: x.mail },
          {
            $pull: {
              classes: {
                _id: classes._id,
              },
            },
          }
        );
      })
    );
    task.remove("classes", { _id: classes._id });
    await task.run({ useMongoose: true });
    const newClasses = await Classes.find();
    io.emit("deleteClasses", newClasses);
    res.send("Delete Successfully");
  } catch (error) {
    console.log(error);
    res.status(500).send("Something failed to server");
  }
});

function generateLessons(numOfWeek) {
  let lessons = [];
  let num = numOfWeek;
  for (var i = 1; i <= num; i++) {
    lessons.push({
      order: i,
      name: `Lesson ${i}`,
      students: [],
      numOfAttendance: 0,
      numOfNonAttendance: 0,
      averageOfAttendance: 0,
      averageOfNonAttendance: 0,
      expiredTime: null,
      qrCode: null,
      status: "Availability",
      devicesId: [],
    });
  }

  return lessons;
}

module.exports = router;
