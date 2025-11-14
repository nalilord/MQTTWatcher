// src/core/Watcher.ts

import config from "./MQTTConfig";
import { MessageService } from "./MessageService";
import mqtt, { MqttClient } from "mqtt";
import { BaseClassLog } from "./MQTTLog";
import * as buffer from "node:buffer";
import { GlobalEventStore, EventUtils } from "./EventUtils";
import { EventItem, EventCondition} from "./Events";

/** ====================== Types ====================== */

interface EventStatus {
    lastValue: string;
    lastHandledValue: string | null;
    warningTimeout: NodeJS.Timeout | null;
    resetTimeout: NodeJS.Timeout | null;
    warningDone: boolean;
}

interface EventStatusList {
    [key: string]: EventStatus;
}

/** For edge/cooldown tracking per-condition per-source */
interface ConditionState {
    prevMatch: boolean;
    lastSentAt: number; // epoch seconds
}

/** ====================== Watcher ====================== */

export class Watcher extends BaseClassLog {

    protected mqttHost: string = "mqtt://" + config.mqtt.username + ":" + config.mqtt.password + "@" + config.mqtt.host + ":" + config.mqtt.port;
    protected mqttTopic: string = "";

    protected client: MqttClient | null = null;
    protected msgSvc: MessageService | null = null;
    protected messageListId: string | null = null;
    protected events: EventItem[];
    protected eventStatus: EventStatusList;

    /** condition-level state for edge and cooldown */
    protected conditionState: Record<string, ConditionState>;

    constructor(messageService: MessageService, messageListId: string, mqttTopic: string, events: EventItem[]) {
        super();

        this.msgSvc = messageService;
        this.messageListId = messageListId;
        this.mqttTopic = mqttTopic;
        this.events = events;
        this.eventStatus = {} as EventStatusList;
        this.conditionState = {};

        this.initializeEvents();
    }

    public isRunning() {
        return this.client?.connected ?? false;
    }

    private initializeEvents() {
        // For non-dynamic events without stateKey, initialize a single legacy bucket.
        this.events.forEach((event: EventItem) => {
            if (!event.dynamic && !event.stateKey) {
                this.eventStatus[event.subject] = {
                    lastValue: String(event.default),
                    lastHandledValue: null,
                    warningTimeout: null,
                    resetTimeout: null,
                    warningDone: false
                };
                GlobalEventStore.update(this.messageListId!, event.subject, event.default);
            }
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
            this.client?.subscribe(this.mqttTopic, {}, (err: Error | null) => {
                if (err) {
                    this.log("error", "Subscribe error: " + err.message, this.messageListId);
                } else {
                    this.log("info", `MQTT subscribed to topic '${this.mqttTopic}'`, this.messageListId);
                }
            });
        });

        this.client.on("message", (topic: string, message: buffer.Buffer) => {
            this.log("debug", `MQTT new topic message from '${topic}': ${message.toString().trim()}`, this.messageListId);

            let data: Record<string, any> | null = null;
            try {
                data = JSON.parse(message.toString());
            } catch {
                this.log("debug", "Malformed JSON received, processing of message aborted!", this.messageListId);
                return;
            }
            if (!data) {
                this.log("debug", "Malformed JSON received (null), processing of message aborted!", this.messageListId);
                return;
            }

            this.log("debug", "Processing #" + this.events.length + " events...", this.messageListId);

            this.events.forEach((event: EventItem) => {
                this.log("debug", `Processing Event for subject '${event.subject}'`, this.messageListId);

                const actual = EventUtils.getValueByPath(data!, event.subject);
                if (typeof actual === "undefined") {
                    this.log("debug", `No matching property found for Event subject path '${event.subject}'`, this.messageListId);
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

                const valStr = String(actual);
                const isDynamic = event.dynamic === true;

                const statusKey = this.computeStatusKey(event, data);
                if (!isDynamic && statusKey && !this.eventStatus[statusKey]) {
                    this.eventStatus[statusKey] = {
                        lastValue: String(event.default),
                        lastHandledValue: null,
                        warningTimeout: null,
                        resetTimeout: null,
                        warningDone: false
                    };
                }

                if (!isDynamic) {
                    GlobalEventStore.update(this.messageListId!, event.subject, valStr);
                }

                this.log("debug", `Found value for '${event.subject}': ${JSON.stringify(actual)} → checking ${event.conditions.length} conditions`, this.messageListId);

                event.conditions.forEach((cond, condIdx) => {
                    const matched = (typeof cond.condition === "string" && cond.condition.trim())
                        ? EventUtils.evaluateExpression(cond.condition!, actual, data!)
                        : EventUtils.compareValues(cond.value, actual);

                    if (!matched && (cond.edge === "rising")) {
                        const ckey = this.computeConditionKey(event, cond, condIdx, data);
                        const st = this.conditionState[ckey] || { prevMatch: false, lastSentAt: 0 };
                        st.prevMatch = false;
                        this.conditionState[ckey] = st;
                    }

                    if (!matched) {
                        this.log("debug", `Condition not matched for '${event.subject}' (value=${JSON.stringify(actual)})`, this.messageListId);
                        return;
                    }

                    const logTxt = EventUtils.interpolate(cond.log, data!);
                    this.log("info", logTxt, this.messageListId);

                    const msgText = EventUtils.interpolate(cond.message, data!);

                    const shouldByEdgeCooldown = this.shouldNotifyByEdgeCooldown(
                        event, cond, condIdx, data, Date.now() / 1000
                    );

                    if (!shouldByEdgeCooldown) {
                        this.log("debug", `Edge/cooldown suppressed notification for condition #${condIdx}`, this.messageListId);
                        return;
                    }

                    if (isDynamic) {
                        this.msgSvc!.sendNotifications(this.messageListId!, msgText, cond.severity ?? "info");
                    } else {
                        const userControls = (cond.edge && cond.edge !== "level") || (cond.cooldownSec && cond.cooldownSec > 0);
                        if (!userControls && statusKey) {
                            const st = this.eventStatus[statusKey];
                            if (st.lastValue !== valStr) {
                                this.msgSvc!.sendNotifications(this.messageListId!, msgText, cond.severity ?? "info");
                            } else {
                                this.log("debug", `Duplicate event value '${valStr}' for key '${statusKey}', no immediate notification sent`, this.messageListId);
                            }

                            if (cond.warningThreshold && cond.warningThreshold > 0) {
                                if (st.warningTimeout == null) {
                                    const safeCond: EventCondition = {
                                        ...cond,
                                        warningMessage: cond.warningMessage ? EventUtils.interpolate(cond.warningMessage, data!) : cond.message
                                    };
                                    st.warningTimeout = setTimeout(
                                        () => this.warningConditionHandler(event, statusKey!, valStr, safeCond),
                                        cond.warningThreshold * 1000
                                    );
                                }
                            } else {
                                if (st.warningTimeout != null) clearTimeout(st.warningTimeout);
                                st.warningTimeout = null;
                                st.warningDone = false;
                            }

                            if (st.resetTimeout != null) clearTimeout(st.resetTimeout);
                            st.resetTimeout = null;
                            if (cond.reset && cond.reset > 0) {
                                st.resetTimeout = setTimeout(
                                    () => this.resetLastValueHandler(event, statusKey!),
                                    cond.reset * 1000
                                );
                            }

                            st.lastHandledValue = valStr;
                            this.log("debug", `Last handled value for key '${statusKey}' updated to '${valStr}'`, this.messageListId);
                        } else {
                            this.msgSvc!.sendNotifications(this.messageListId!, msgText, cond.severity ?? "info");
                        }
                    }
                });

                if (!isDynamic && statusKey) {
                    this.eventStatus[statusKey].lastValue = valStr;
                    this.log("debug", `Last value for key '${statusKey}' updated to '${valStr}'`, this.messageListId);
                }
            });
        });

        return true;
    }

    /** ====================== Edge/Cooldown ====================== */

    protected computeConditionKey(event: EventItem, cond: EventCondition, condIdx: number, payload: any): string {
        const base =
            (cond.key && EventUtils.interpolate(cond.key, payload)) ||
            (event.stateKey && EventUtils.interpolate(event.stateKey, payload)) ||
            (payload?.tags && (payload.tags.host || payload.tags.path)
                ? `${payload.tags.host ?? ""}:${payload.tags.path ?? ""}`
                : event.subject);
        return `${this.messageListId}::${event.subject}::${condIdx}::${base}`;
    }

    protected shouldNotifyByEdgeCooldown(
        event: EventItem,
        cond: EventCondition,
        condIdx: number,
        payload: any,
        nowEpochSec: number
    ): boolean {
        const edge = cond.edge ?? "level";
        const cooldown = cond.cooldownSec ?? 0;

        const key = this.computeConditionKey(event, cond, condIdx, payload);
        const st = this.conditionState[key] || { prevMatch: false, lastSentAt: 0 };

        let allow = false;

        if (edge === "rising") {
            allow = !st.prevMatch;
            st.prevMatch = true;
        } else {
            allow = true;
            st.prevMatch = true;
        }

        if (allow && cooldown > 0) {
            if ((nowEpochSec - st.lastSentAt) < cooldown) {
                allow = false;
            }
        }

        if (allow) {
            st.lastSentAt = nowEpochSec;
        }

        this.conditionState[key] = st;
        return allow;
    }

    /** ====================== Helpers: Keys, Time, Deps ====================== */

    protected computeStatusKey(event: EventItem, payload: any): string | null {
        if (event.dynamic) return null;
        if (event.stateKey && typeof event.stateKey === "string" && event.stateKey.trim()) {
            return EventUtils.interpolate(event.stateKey, payload) + "::" + event.subject;
        }
        return event.subject;
    }

    protected isInActiveHours(event: EventItem): boolean {
        if (!event.activeHours || event.activeHours.length === 0) return true;

        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();

        return event.activeHours.some(({ from, to }) => {
            const [fh, fm] = from.split(":").map(Number);
            const [th, tm] = to.split(":").map(Number);
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
            const actual = EventUtils.normalizeValue(GlobalEventStore.get(watchId, subject));
            const expected = EventUtils.normalizeValue(dep.state);
            const result = actual === expected;
            this.log("debug", `Dependency check: ${dep.path} = ${actual}, expected ${dep.state} → ${result}`, this.messageListId);
            return result;
        });
    }

    /** ====================== Warning & Reset Handlers (stateful only) ====================== */

    protected warningConditionHandler(event: EventItem, statusKey: string, warningValue: string, condition: EventCondition) {
        this.log("info", `Threshold for '${statusKey}' reached, evaluating warning condition`, this.messageListId);

        const st = this.eventStatus[statusKey];
        if (!st) return;

        if (st.warningTimeout != null && !st.warningDone) {
            if (st.lastValue === warningValue) {
                this.msgSvc!.sendNotifications(
                    this.messageListId!,
                    condition.warningMessage ?? condition.message,
                    condition.warningSeverity ?? "warning"
                );
            } else {
                this.log("info", `Skipping warning: current value '${st.lastValue}' differs from warning value '${warningValue}'`, this.messageListId);
            }
            st.warningDone = true;
        }
    }

    protected resetLastValueHandler(event: EventItem, statusKey: string) {
        const st = this.eventStatus[statusKey];
        if (!st) return;
        this.log("debug", `Resetting last value for '${statusKey}' to default '${event.default}'`, this.messageListId);
        st.lastValue = String(event.default);
    }
}
