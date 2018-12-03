// External libraries
let http = null;

// Config
const {
  PORT = 1337,
  NODE_ENV = "development",
  MAX_IDLE_TIME_PASSWORD
} = process.env;

try {
  http = require("uws").http;
  console.log("supercharged!");
} catch (error) {
  console.log("slow...");
  http = require("http");
}

const polka = require("polka");
const logger = require("pino")({
  name: "asrtt-server"
});
const expressPino = require("express-pino-logger")({
  logger
});

const { json } = require("body-parser");
const queue = require("queue");

// Internal libraries
const gitlabClient = require("./gitlab-client");
const { TogglClient } = require("./toggl-client");

if (!MAX_IDLE_TIME_PASSWORD) {
  logger.warn(
    "MAX_IDLE_TIME_PASSWORD environment variable is not set.\n" +
      "You will not be able to update the maximum idle time"
  );
}

// App
const app = polka();

// State variables
const workTrack = {};
let maxIdleTime = 3 * 60;

//app.use(expressPino);

// Handlers
app.get("/should-track", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ maxIdleTime }));
});

app.use(json());

const stopWorking = async data => {
  const { gitlabHostname, gitlabProject, gitlabToken, togglToken } = data;

  const id = togglToken;

  workTrack[id].isWorking = false;

  // Get branch from track entry instead of request,
  // a branch change could have just happened
  // but we need to set the gitlab spent time on the old one
  const branch = workTrack[id].gitBranch;

  // Stop toggl timer

  logger.info(`[${id}]: toggl stop on ${branch}`);

  const togglClient = new TogglClient(togglToken);
  const time = await togglClient.stop();

  if (time) {
    await gitlabClient.logTime(
      time * 1000,
      gitlabHostname,
      gitlabToken,
      gitlabProject,
      branch
    );
  } else {
    logger.warn(
      `[${id}]: not logging time to gitlab because of an error with toggl`
    );
  }
};

const startWorking = async data => {
  const id = data.togglToken;
  workTrack[id].isWorking = true;
  workTrack[id].gitBranch = data.gitBranch;
  const togglClient = new TogglClient(data.togglToken);

  const current = await togglClient.current();

  if (!current) {
    logger.info(`[${id}]: toggl start on ${data.gitBranch}`);
    await togglClient.start(data.gitlabProject, data.gitBranch);
  }
};

app.post("/set-is-working", async (req, res) => {
  if (!req.body || !req.body.togglToken || !req.body.gitBranch) {
    logger.error("bad request");
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }

  const { togglToken, gitBranch } = req.body;

  // Use toggl token as worker id
  const id = togglToken;

  // Create work tracking entry if it does not exist
  workTrack[id] = workTrack[id] || {};

  workTrack[id].queue =
    workTrack[id].queue || queue({ autostart: true, concurrency: 1 });

  workTrack[id].queue.push(async function() {
    // If it wasn't working already
    if (!workTrack[id].isWorking) {
      await startWorking(req.body);
    } else {
      // Already working, check that the branch hasn't changed
      if (gitBranch !== workTrack[id].gitBranch) {
        logger.info(`[${id}]: branch change, restarting task`);
        // If it has changed, stop current work timer, start new one
        await stopWorking(req.body);
        await startWorking(req.body);
      }
    }

    // Clear previous timeout
    clearTimeout(workTrack[id].timeout);

    // Now the worker has maxIdleTime left again
    workTrack[id].timeout = setTimeout(() => {
      logger.info(`[${id}] timeout`);
      // Timed ran out boi, you're lazy as fuck!
      workTrack[id].queue.push(async function() {
        await stopWorking(req.body);
      });
    }, maxIdleTime * 1000);
  });

  res.end();
});

app.post("/set-not-working", (req, res) => {
  if (
    !req.body ||
    !req.body.togglToken ||
    !req.body.gitlabToken ||
    !req.body.gitBranch ||
    !req.body.gitlabProject ||
    !req.body.gitlabHostname
  ) {
    logger.error("bad request");
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }

  const id = req.body.togglToken;

  if (!workTrack[id] || !workTrack[id].queue) {
    logger.warn(`Try to stop work on non-tracked worker ${id}`);
    res.end();
    return;
  }

  clearTimeout(workTrack[id].timeout);

  if (workTrack[id].isWorking) {
    workTrack[id].queue.push(async function() {
      return await stopWorking(req.body);
    });
  }

  res.end();
});

app.put("/max-idle-time", (req, res) => {
  if (
    !req.body ||
    !req.body.password ||
    !req.body.time ||
    isNaN(req.body.time)
  ) {
    logger.error("bad max-idle-time request");
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }

  if (req.body.password !== MAX_IDLE_TIME_PASSWORD) {
    logger.error("unauthorized request to set max-idle-time");
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  maxIdleTime = parseInt(req.body.time);

  logger.info(`Set max idle time to ${maxIdleTime}`);

  res.end();
});

http.createServer(app.handler).listen(PORT, err => {
  console.log(`> Running on localhost:${PORT}`);
});
