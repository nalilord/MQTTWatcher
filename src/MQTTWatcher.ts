import * as config from "./config.json";
import {logger} from "./core/MQTTLog";
import {NotificationMethod, MessageService} from "./core/MessageService";
import {Watcher} from "./core/Watcher";
import {Watchdog} from "./core/Watchdog";

logger.info("MQTTWatcher initializing", {module: "Core"});

let msgSvc: MessageService = new MessageService();
let watchdog: Watchdog = new Watchdog();

for (let i = 0; i < config.notificationList.length; i++) {
    for (let j = 0; j < config.notificationList[i].recipients.length; j++) {
        if(config.notificationList[i].recipients[j].enabled)
            msgSvc.addRecipient(NotificationMethod.fromString(config.notificationList[i].recipients[j].type),config.notificationList[i].id, config.notificationList[i].recipients[j].recipient);
    }
}

for (let i = 0; i < config.watchList.length; i++) {
    if(config.watchList[i].enabled)
        watchdog.add(new Watcher(msgSvc, config.watchList[i].id, config.watchList[i].topic, config.watchList[i].events));
}

watchdog.run();

logger.info("MQTTWatcher started",{module: "Core"});
