import config from "../config.json";

import {BaseClassLog} from "./MQTTLog";
const nodemailer = require("nodemailer");
const twilio = require("twilio")(config.messageService.sms.sid, config.messageService.sms.token);

export enum NotificationMethod {
    LOG,
    MAIL,
    SMS,
}

export namespace NotificationMethod {
    export function fromString(value: string): NotificationMethod {
        if (!(value in NotificationMethod)) {
            throw new Error(`Invalid NotificationMethod: ${value}`);
        }
        return NotificationMethod[value as keyof typeof NotificationMethod] as NotificationMethod;
    }
}

interface NotificationListItem {
    method: NotificationMethod;
    recipient: string;
    minSeverity?: "debug" | "info" | "warning" | "critical";
}

export class MessageService extends BaseClassLog {

    protected list: {[key: string]: NotificationListItem[]};
    protected mailTransport = nodemailer.createTransport({host: config.messageService.mail.host, port: config.messageService.mail.port, secure: false, auth: {}});

    public constructor() {
        super();

        this.list = {};
    }

    public addRecipient(method: NotificationMethod, listId: string, recipient: string, minSeverity: "debug" | "info" | "warning" | "critical" = "info") {
        this.log("debug", "Add new recipient (" + NotificationMethod[method] + ":" + recipient + ") for ID: " + listId);

        if(!this.list[listId])
            this.list[listId] = [];
        this.list[listId].push({method, recipient, minSeverity});
    }

    // Overloads
    public sendNotifications(listId: string, message: string, severity: string): void;
    public sendNotifications(listId: string, message: string, filter?: NotificationMethod[]): void;

    public sendNotifications(listId: string, message: string, filterOrSeverity?: NotificationMethod[] | string): void {
        this.log("debug", "Sending notifications for ID: " + listId);

        const severityOrder = { debug: 0, info: 1, warning: 2, critical: 3 };

        if(this.list[listId]) {
            for (let i = 0; i < this.list[listId].length; i++) {
                const item = this.list[listId][i];

                if (Array.isArray(filterOrSeverity)) {
                    if(filterOrSeverity.includes(item.method)) {
                        this.sendNotification(item.method, message, item.recipient);
                    }
                } else if (typeof filterOrSeverity === 'string') {
                    const level = severityOrder[filterOrSeverity as keyof typeof severityOrder] ?? 1;
                    const minLevel = severityOrder[item.minSeverity ?? 'info'] ?? 1;

                    if (level >= minLevel) {
                        this.sendNotification(item.method, message, item.recipient);
                    }
                } else {
                    this.sendNotification(item.method, message, item.recipient);
                }
            }
        }
    }

    public sendNotification(method: NotificationMethod, message: string, recipient: string) {
        this.log("debug", "Sending " + NotificationMethod[method] + " notification to: " + recipient);

        switch (method) {
            case NotificationMethod.LOG: {
                this.logger.info(message);
            } break;
            case NotificationMethod.MAIL: {
                this.mailTransport.sendMail({
                    from: config.messageService.mail.from,
                    to: recipient,
                    subject: "Notification Event",
                    text: message
                });
            } break;
            case NotificationMethod.SMS: {
                twilio.messages
                    .create({
                        body: message,
                        messagingServiceSid: config.messageService.sms.service,
                        to: recipient
                    });
            } break;
        }
    }
}
