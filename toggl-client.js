const Toggl = require("toggl-api");
const util = require("util");
const logger = require("pino")();

class TogglClient {
  constructor(apiToken) {
    this.apiToken = apiToken;
    this.client = new Toggl({ apiToken });
    const methods = [
      "startTimeEntry",
      "getCurrentTimeEntry",
      "stopTimeEntry",
      "getWorkspaces",
      "getWorkspaceProjects"
    ];
    for (const fn of methods) {
      this.client[fn] = util.promisify(this.client[fn]);
    }
  }

  async start(projectName, description) {
    let workspaces = null;

    try {
      workspaces = await this.client.getWorkspaces();
    } catch (error) {
      this.handleError(
        error,
        `An error occurred when trying to get toggl workspaces: ${
          error.message
        }`
      );
      return null;
    }

    let projectId = null;
    for (const workspace of workspaces) {
      let projects = null;
      try {
        projects = await this.client.getWorkspaceProjects(workspace.id);
      } catch (error) {
        this.handleError(
          error,
          `An error occurred when trying to retrieve toggl workspace projects: ${
            error.message
          }`
        );
        return null;
      }

      if (!projects) {
        continue;
      }

      for (const project of projects) {
        if (project.name === projectName) {
          projectId = project.id;
          break;
        }
      }

      if (projectId) {
        break;
      }
    }

    if (!projectId) {
      logger.error(
        `[${
          this.apiToken
        }]: Toggl project ${projectName} not found in any workspace`
      );
      return null;
    }
    try {
      return await this.client.startTimeEntry({
        description,
        pid: projectId,
        created_with: "asrtt"
      });
    } catch (error) {
      this.handleError(
        error,
        `An error occurred when trying to start toggl time entry: ${
          error.message
        }`
      );
      return null;
    }
  }
  async current() {
    let result = null;
    try {
      result = await this.client.getCurrentTimeEntry();
    } catch (error) {
      this.handleError(
        error,
        `An error occurred when trying to get current toggl time entry: ${
          error.message
        }`
      );
      return null;
    }
    return result;
  }
  async stop() {
    const current = await this.current();
    if (!current) {
      logger.error(`[${this.apiToken}]: There is no current task in progress`);
      return null;
    }
    let duration = null;
    try {
      ({ duration } = await this.client.stopTimeEntry(current.id));
    } catch (error) {
      this.handleError(
        error,
        `An error occurred when trying to stop toggl time entry: ${
          error.message
        }`
      );
      return null;
    }
    return duration;
  }
  handleError(error, defaultMessage) {
    if (error.code === 403) {
      logger.error(`[${this.apiToken}]: Invalid toggl token`);
    } else {
      logger.error(`[${this.apiToken}]: ${defaultMessage}`);
    }
  }
}

exports.TogglClient = TogglClient;
