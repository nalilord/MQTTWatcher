import * as config from "../config.json";
import {MessageService, NotificationMethod} from "./MessageService";
import mqtt, {MqttClient} from "mqtt";
import {BaseClassLog} from "./MQTTLog";
import * as buffer from "node:buffer";

interface EventItem {
    subject: string;
    default: any;
    conditions: EventCondition[];
}

interface EventCondition {
    value: any;
    log: string;
    message: string;
    warningThreshold?: number;
    warningMessage?: string;
    reset?: number;
}

interface EventStatus {
    lastValue: string;
    lastHandledValue: string;
    warningTimeout: NodeJS.Timeout;
    resetTimeout: NodeJS.Timeout;
    warningDone: boolean;
}

interface EventStatusList {
    [index: string]: EventStatus;
}

export class Watcher extends BaseClassLog {

    protected mqttHost: string = "mqtt://" + config.mqtt.username + ":" + config.mqtt.password + "@" + config.mqtt.host + ":" + config.mqtt.port;
    protected mqttTopic: string = "";

    protected client: MqttClient = null;
    protected msgSvc: MessageService = null;
    protected messageListId: string = null;
    protected events: EventItem[];
    protected eventStatus: EventStatusList;

    constructor(messageService: MessageService, messageListId: string, mqttTopic: string, events: EventItem[]) {
        super();

        this.msgSvc = messageService;
        this.messageListId = messageListId;
        this.mqttTopic = mqttTopic;
        this.events = events;
        this.eventStatus = {} as EventStatusList;

        this.initializeEvents();
    }

    public isRunning() {
        return false;
    }

    private initializeEvents() {
        this.events.forEach(function (event: EventItem) {
            this.eventStatus[event.subject] = {
                lastValue: String(event.default).valueOf(),
                lastHandledValue: null,
                warningTimeout: null,
                resetTimeout: null,
                warningDone: false
            };
        }.bind(this));
    }

    public run(): boolean {
        this.client = mqtt.connect(this.mqttHost);

        this.client.on("disconnect", () => {
            this.log("warn", "MQTT disconnected", this.messageListId);

            this.client.end();

            setTimeout(this.run.bind(this), 2500);
        });

        this.client.on("error", (error) => {
            this.log("error", "MQTT error: " + error.message, this.messageListId);

            this.client.end();

            setTimeout(this.run.bind(this), 2500);
        });

        this.client.on("connect", () => {
            this.log("info", "MQTT connected (" + config.mqtt.host + ":" + config.mqtt.port + ")", this.messageListId);

            this.client.subscribe(this.mqttTopic, (err: Error) => {
                this.log("info", "MQTT subscribed (" + this.mqttTopic + ")", this.messageListId);
            });
        });

        this.client.on("message", (topic: string, message: buffer.Buffer) => {
            if (topic == this.mqttTopic) {
                this.log("info", "MQTT new topic message: " + message.toString(), this.messageListId);

                let data: JSON = null;

                try {
                    data = JSON.parse(message.toString());
                } catch (e) {
                    this.log("debug", "Malformed JSON received processing ob message aborted!", this.messageListId);
                }

                if(data != null) {
                    this.log("debug", "Processing #" + this.events.length + " events...", this.messageListId);

                    this.events.forEach(function (event: EventItem) {
                        this.log("debug", "Processing Event for subject '" + event.subject + "'.", this.messageListId);

                        if (data.hasOwnProperty(event.subject)) {
                            this.log("debug", "Found matching property for Event subject '" + event.subject + "', checking #" + event.conditions.length + " conditions...", this.messageListId);

                            event.conditions.forEach(function (condition: EventCondition) {
                                let executeHandler: boolean = false;

                                if (condition.value === undefined || condition.value === null) {
                                    executeHandler = true;
                                } else if (typeof condition.value === "boolean") {
                                    executeHandler = (condition.value == Boolean(data[event.subject]).valueOf());
                                } else if (typeof condition.value === "number") {
                                    executeHandler = (condition.value == Number(data[event.subject]).valueOf());
                                } else if (typeof condition.value === "bigint") {
                                    executeHandler = (condition.value == BigInt(data[event.subject]).valueOf());
                                } else if (typeof condition.value === "string") {
                                    executeHandler = (condition.value == String(data[event.subject]).valueOf());
                                } else {
                                    // Unsupported Type
                                }

                                if (executeHandler) {
                                    this.log("debug", "Valid condition found (S[" + event.subject + "] / C[" + String(condition.value).toString() + "] == V[" + String(data[event.subject]).valueOf() + "]), executing handler...", this.messageListId);

                                    this.executeConditionHandler(condition, event, String(data[event.subject]).valueOf());
                                    this.eventStatus[event.subject].lastHandledValue = String(data[event.subject]).valueOf();

                                    this.log("debug", "Last handled event value changed to '" + this.eventStatus[event.subject].lastHandledValue + "'.", this.messageListId);
                                } else {
                                    this.log("debug", "Not executing condition handler (S[" + event.subject + "] / C[" + String(condition.value).toString() + "] != V[" + String(data[event.subject]).valueOf() + "]).", this.messageListId);
                                }
                            }.bind(this));

                            this.eventStatus[event.subject].lastValue = String(data[event.subject]).valueOf();
                            this.log("debug", "Last event value changed to '" + this.eventStatus[event.subject].lastValue + "'.", this.messageListId);
                        }
                    }.bind(this));
                }
            }
        });

        return true;
    }

    protected executeConditionHandler(condition: EventCondition, event: EventItem, eventValue: string) {
        this.log("info", condition.log, this.messageListId);

        if (this.eventStatus[event.subject].lastValue != eventValue)
            this.msgSvc.sendNotifications(this.messageListId, condition.message, [NotificationMethod.MAIL])
        else
            this.log("debug", "No message send, repeated condition/event value! (" + eventValue + ")", this.messageListId);

        if (condition.warningThreshold && condition.warningThreshold > 0) {
            this.log("debug", "Warning threshold (" + condition.warningThreshold + ") defined, setting timeout for event warning!", this.messageListId);

            if (this.eventStatus[event.subject].warningTimeout == null)
                this.eventStatus[event.subject].warningTimeout = setTimeout(this.warningConditionHandler.bind(this, event, eventValue, condition.warningMessage), condition.warningThreshold * 1000);
        } else {
            this.log("debug", "Warning threshold NOT defined, clearing timeout for event warning!", this.messageListId);

            if (this.eventStatus[event.subject].warningTimeout != null)
                clearTimeout(this.eventStatus[event.subject].warningTimeout);

            this.eventStatus[event.subject].warningTimeout = null;
            this.eventStatus[event.subject].warningDone = false;
        }

        if (this.eventStatus[event.subject].resetTimeout != null)
            clearTimeout(this.eventStatus[event.subject].resetTimeout);

        this.eventStatus[event.subject].resetTimeout = null;

        if (condition.reset && condition.reset > 0)
            this.eventStatus[event.subject].resetTimeout = setTimeout(this.resetLastValueHandler.bind(this, event), condition.reset * 1000);
    }

    protected warningConditionHandler(event: EventItem, warningValue: string, warningMessage: string) {
        this.log("info", "Threshold for warning condition at event '" + event.subject + "' on '" + this.messageListId + "' reached!", this.messageListId);

        if (this.eventStatus[event.subject].warningTimeout != null && !this.eventStatus[event.subject].warningDone) {
            if (this.eventStatus[event.subject].lastValue == warningValue) {
                this.msgSvc.sendNotifications(this.messageListId, warningMessage);
            } else {
                this.log("info", "Warning condition (" + event.subject + ": " + warningValue + " == " + this.eventStatus[event.subject].lastValue + ") on '" + this.messageListId + "' no longer valid, message not send!", this.messageListId);
            }

            this.eventStatus[event.subject].warningDone = true;
        }
    }

    protected resetLastValueHandler(event: EventItem) {
        this.log("debug", "No new values, resetting last value for '" + event.subject + "' to default '" + event.default + "'.", this.messageListId);

        this.eventStatus[event.subject].lastValue = String(event.default).valueOf();
    }
}

