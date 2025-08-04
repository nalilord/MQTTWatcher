import config from "./MQTTConfig";
import { MessageService, NotificationMethod } from "./MessageService";
import mqtt, { MqttClient } from "mqtt";
import { BaseClassLog } from "./MQTTLog";
import * as buffer from "node:buffer";

interface EventItem {
    subject: string;
    default: any;
    activeHours?: { from: string; to: string }[];
    dependencies?: { path: string; state: any }[];
    conditions: EventCondition[];
}

interface EventCondition {
    value: any;
    log: string;
    message: string;
    severity?: "debug" | "info" | "warning" | "critical";
    warningSeverity?: "debug" | "info" | "warning" | "critical";
    warningThreshold?: number;
    warningMessage?: string;
    reset?: number;
}

interface EventStatus {
    lastValue: string;
    lastHandledValue: string | null;
    warningTimeout: NodeJS.Timeout | null;
    resetTimeout: NodeJS.Timeout | null;
    warningDone: boolean;
}

interface EventStatusList {
    [index: string]: EventStatus;
}

class GlobalEventStore {
    private static data: Record<string, Record<string, any>> = {};

    static update(watchId: string, subject: string, value: any) {
        if (!this.data[watchId]) this.data[watchId] = {};
        this.data[watchId][subject] = value;
    }

    static get(watchId: string, subject: string): any {
        return this.data[watchId]?.[subject];
    }

    static debugLog(): void {
        console.log("[GlobalEventStore]", JSON.stringify(this.data, null, 2));
    }
}

export class Watcher extends BaseClassLog {

    protected mqttHost: string = "mqtt://" + config.mqtt.username + ":" + config.mqtt.password + "@" + config.mqtt.host + ":" + config.mqtt.port;
    protected mqttTopic: string = "";

    protected client: MqttClient | null = null;
    protected msgSvc: MessageService | null = null;
    protected messageListId: string | null = null;
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
        return this.client?.connected ?? false;
    }

    private initializeEvents() {
        this.events.forEach((event: EventItem) => {
            this.eventStatus[event.subject] = {
                lastValue: String(event.default),
                lastHandledValue: null,
                warningTimeout: null,
                resetTimeout: null,
                warningDone: false
            };

            GlobalEventStore.update(this.messageListId!, event.subject, event.default);
        });
    }

    public run(): boolean {
        this.client = mqtt.connect(this.mqttHost);

        this.client.on("disconnect", () => {
            this.log("warn", "MQTT disconnected", this.messageListId);
            this.client?.end();
            setTimeout(this.run.bind(this), 2500);
        });

        this.client.on("error", (error) => {
            this.log("error", "MQTT error: " + error.message, this.messageListId);
            this.client?.end();
            setTimeout(this.run.bind(this), 2500);
        });

        this.client.on("connect", () => {
            this.log("info", `MQTT connected (${config.mqtt.host}:${config.mqtt.port})`, this.messageListId);
            this.client?.subscribe(this.mqttTopic, {}, (err: Error | null, granted) => {
                if (err) {
                    this.log("error", "Subscribe error: " + err.message, this.messageListId);
                } else {
                    this.log("info", `MQTT subscribed to topic '${this.mqttTopic}'`, this.messageListId);
                }
            });
        });

        this.client.on("message", (topic: string, message: buffer.Buffer) => {
            this.log("info", `MQTT new topic message from '${topic}': ${message.toString()}`, this.messageListId);

            let data: Record<string, any> | null = null;
            try {
                data = JSON.parse(message.toString());
            } catch (e) {
                this.log("debug", "Malformed JSON received, processing of message aborted!", this.messageListId);
                return;
            }

            if(!data) {
                this.log("debug", "Malformed JSON received (null), processing of message aborted!", this.messageListId);
                return;
            }

            this.log("debug", "Processing #" + this.events.length + " events...", this.messageListId);

            this.events.forEach((event: EventItem) => {
                this.log("debug", `Processing Event for subject '${event.subject}'`, this.messageListId);

                if (!data.hasOwnProperty(event.subject)) {
                    this.log("debug", `No matching property found for Event subject '${event.subject}'`, this.messageListId);
                    return;
                }

                if (!this.isInActiveHours(event)) {
                    this.log("debug", `Event '${event.subject}' ignored: outside activeHours`, this.messageListId);
                    return;
                }

                if (!this.dependenciesSatisfied(event)) {
                    this.log("debug", `Event '${event.subject}' ignored: unmet dependencies`, this.messageListId);
                    return;
                }

                this.log("debug", `Found matching property for Event subject '${event.subject}', checking ${event.conditions.length} conditions`, this.messageListId);

                const val = String(data[event.subject]);
                GlobalEventStore.update(this.messageListId!, event.subject, val);

                event.conditions.forEach((condition: EventCondition) => {
                    let match = this.compareValues(condition.value, data![event.subject]);
                    if (match) {
                        this.log("debug", `Condition match: value = ${data![event.subject]}, executing handler`, this.messageListId);
                        this.executeConditionHandler(condition, event, val);
                        this.eventStatus[event.subject].lastHandledValue = val;
                        this.log("debug", `Last handled value for '${event.subject}' updated to '${val}'`, this.messageListId);
                    } else {
                        this.log("debug", `Condition not matched for value = ${data![event.subject]}`, this.messageListId);
                    }
                });

                this.eventStatus[event.subject].lastValue = val;
                this.log("debug", `Last value for '${event.subject}' updated to '${val}'`, this.messageListId);
            });
        });

        return true;
    }

    protected normalizeValue(input: any): string | number | boolean {
        if (typeof input === "string") {
            if (input === "true") return true;
            if (input === "false") return false;
            if (!isNaN(Number(input))) return Number(input);
            return input;
        }
        return input;
    }

    protected compareValues(expected: any, actual: any): boolean {
        if (expected === undefined || expected === null) return true;
        if (typeof expected === "boolean") return expected == Boolean(actual);
        if (typeof expected === "number") return expected == Number(actual);
        if (typeof expected === "string") return expected == String(actual);
        return false;
    }

    protected isInActiveHours(event: EventItem): boolean {
        if (!event.activeHours || event.activeHours.length === 0) return true;

        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();

        return event.activeHours.some(({ from, to }) => {
            const [fh, fm] = from.split(":" ).map(Number);
            const [th, tm] = to.split(":" ).map(Number);
            const fromMin = fh * 60 + fm;
            const toMin = th * 60 + tm;
            return fromMin <= toMin
                ? minutes >= fromMin && minutes <= toMin
                : minutes >= fromMin || minutes <= toMin;
        });
    }

    protected dependenciesSatisfied(event: EventItem): boolean {
        if (!event.dependencies) return true;
        return event.dependencies.every(dep => {
            const parts = dep.path.split(".");
            if (parts.length !== 2) {
                this.log("warn", `Invalid dependency path '${dep.path}'`, this.messageListId);
                return false;
            }
            const [watchId, subject] = parts;
            const actual = this.normalizeValue(GlobalEventStore.get(watchId, subject));
            const expected = this.normalizeValue(dep.state);
            const result = actual === expected;
            this.log("debug", `Dependency check: ${dep.path} = ${actual}, expected ${dep.state} → ${result}`, this.messageListId);
            return result;
        });
    }

    protected executeConditionHandler(condition: EventCondition, event: EventItem, eventValue: string) {
        this.log("info", condition.log, this.messageListId);

        if (this.eventStatus[event.subject].lastValue !== eventValue) {
            this.msgSvc!.sendNotifications(this.messageListId!, condition.message, condition.severity ?? "info");
        } else {
            this.log("debug", `Duplicate event value '${eventValue}' for subject '${event.subject}', no immediate notification sent`, this.messageListId);
        }

        if (condition.warningThreshold && condition.warningThreshold > 0) {
            this.log("debug", `Setting warning threshold of ${condition.warningThreshold} seconds for '${event.subject}'`, this.messageListId);

            if (this.eventStatus[event.subject].warningTimeout == null)
                this.eventStatus[event.subject].warningTimeout = setTimeout(
                    this.warningConditionHandler.bind(this, event, eventValue, condition),
                    condition.warningThreshold * 1000
                );
        } else {
            if (this.eventStatus[event.subject].warningTimeout != null)
                clearTimeout(this.eventStatus[event.subject].warningTimeout!);
            this.eventStatus[event.subject].warningTimeout = null;
            this.eventStatus[event.subject].warningDone = false;
        }

        if (this.eventStatus[event.subject].resetTimeout != null)
            clearTimeout(this.eventStatus[event.subject].resetTimeout!);
        this.eventStatus[event.subject].resetTimeout = null;

        if (condition.reset && condition.reset > 0)
            this.eventStatus[event.subject].resetTimeout = setTimeout(this.resetLastValueHandler.bind(this, event), condition.reset * 1000);
    }

    protected warningConditionHandler(event: EventItem, warningValue: string, condition: EventCondition) {
        this.log("info", `Threshold for '${event.subject}' reached, evaluating warning condition`, this.messageListId);

        if (this.eventStatus[event.subject].warningTimeout != null && !this.eventStatus[event.subject].warningDone) {
            if (this.eventStatus[event.subject].lastValue === warningValue) {
                this.msgSvc!.sendNotifications(
                    this.messageListId!,
                    condition.warningMessage ?? condition.message,
                    condition.warningSeverity ?? "warning"
                );
            } else {
                this.log("info", `Skipping warning: current value '${this.eventStatus[event.subject].lastValue}' differs from warning value '${warningValue}'`, this.messageListId);
            }

            this.eventStatus[event.subject].warningDone = true;
        }
    }

    protected resetLastValueHandler(event: EventItem) {
        this.log("debug", `Resetting last value for '${event.subject}' to default '${event.default}'`, this.messageListId);
        this.eventStatus[event.subject].lastValue = String(event.default);
    }
}
