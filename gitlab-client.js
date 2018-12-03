const { timeToString } = require("./utils/time-to-string");

const logger = require("pino")();
const request = require("request-promise-native");

exports.logTime = async function(time, host, token, project, branch) {
  const matches = /^(\d+)-/.exec(branch);
  const issueId = matches ? matches[1] : null;

  if (issueId) {
    try {
      JSON.parse(
        await request.post(
          `https://${host}/api/v4/projects/${project
            .split("/")
            .join(
              "%2F"
            )}/issues/${issueId}/add_spent_time?duration=${timeToString(time)}`,
          {
            headers: {
              "private-token": token
            },
            followRedirect: true
          }
        )
      );
    } catch (error) {
      if (error.statusCode === 401) {
        logger.error(`Invalid gitlab token`);
      } else {
        logger.error(
          `An error occurred when trying to log time spent to gitlab issue: ${
            error.error
          }`
        );
      }
    }
  } else {
    logger.warn(
      `Not logging time to gitlab because ${branch} is not an issue branch`
    );
  }
};
