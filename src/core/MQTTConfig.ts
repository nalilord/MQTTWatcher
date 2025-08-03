import fs from "fs";
import path from "path";

let configPath = path.resolve(__dirname, process.env.CONFIG_FILE ?? "../config.json");

if (!fs.existsSync(configPath)) {
    console.warn(`[MQTTConfig] Config file not found at ${configPath}, exiting...`);
    process.exit(1);
}

const config = require(configPath);
export default config;
