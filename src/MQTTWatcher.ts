import rawConfig from "./core/MQTTConfig";
import { logger } from "./core/MQTTLog";
import { NotificationMethod, MessageService } from "./core/MessageService";
import { Watcher } from "./core/Watcher";
import { Watchdog } from "./core/Watchdog";

type Config = typeof rawConfig;

class MQTTWatcherApp {
    private msgSvc: MessageService;
    private watchdog: Watchdog;

    constructor(private config: Config) {
        this.msgSvc = new MessageService();
        this.watchdog = new Watchdog();
    }

    public start(): void {
        logger.info("MQTTWatcher initializing", { module: "Core" });

        if (!Array.isArray(this.config.notificationList) || !Array.isArray(this.config.watchList)) {
            logger.error("Configuration error: notificationList and watchList must be arrays", { module: "Core" });
            process.exit(1);
        }

        this.setupNotifications();
        this.setupWatchers();
        this.watchdog.run();

        logger.info("MQTTWatcher started", { module: "Core" });

        process.on("SIGINT", () => {
            logger.info("MQTTWatcher shutting down gracefully", { module: "Core" });
            process.exit(0);
        });
    }

    private setupNotifications(): void {
        for (const item of this.config.notificationList) {
            for (const recipient of item.recipients) {
                if (recipient.enabled) {
                    const method = NotificationMethod.fromString(recipient.type);
                    const minSeverity = recipient.minSeverity ?? "info";
                    this.msgSvc.addRecipient(method, item.id, recipient.recipient, minSeverity);
                }
            }
        }
    }

    private setupWatchers(): void {
        for (const item of this.config.watchList) {
            if (item.enabled) {
                this.watchdog.add(new Watcher(this.msgSvc, item.id, item.topic, item.events));
            }
        }
    }
}

const app = new MQTTWatcherApp(rawConfig);
app.start();
