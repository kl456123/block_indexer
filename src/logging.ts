import * as log4js from "log4js";

log4js.configure({
  appenders: { console: { type: "console" } },
  categories: { default: { appenders: ["console"], level: "INFO" } },
});

export const logger = log4js.getLogger("blockIndexer");
