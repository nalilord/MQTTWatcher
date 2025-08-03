import {Logger} from "winston";
import fs from "fs";
import path from "path";

const winston = require('winston'), {combine, timestamp, printf, align} = winston.format;

let logDir: string = ".";

if(process.env.LOG_PATH) {
    logDir = process.env.LOG_PATH;
    if (!fs.existsSync(logDir)){
        fs.mkdirSync(logDir, { recursive: true });
    }
}

export const logger: Logger = winston.createLogger({
    level: 'debug',
    format: combine(
        timestamp({format: 'YYYY-MM-DD hh:mm:ss.SSS A'}),
        printf((info: any) => `[${info.timestamp}] <${info.level}> (${info.module}): ${info.message}`)
    ),
    defaultMeta: {
        module: "<none>",
    },
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: path.join(logDir, '/log.txt') })]
});

export abstract class BaseClassLog {

    protected logger: Logger = logger;

    protected constructor() {
    }

    protected log(level: string, message: string, subModule?: string | null) {
        let className: string = this.constructor['name'];

        if(typeof(subModule) !== "undefined") {
            className = className + "[" + subModule + "]";
        }

        switch (level) {
            case "info":
                this.logger.info(message, {module: className});
                break;
            case "warn":
                this.logger.warn(message, {module: className});
                break;
            case "error":
                this.logger.error(message, {module: className});
                break;
            default:
                this.logger.debug(message, {module: className});
                break;
        }
    }

}
