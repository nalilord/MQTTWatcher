import * as config from "../config.json";

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
        return NotificationMethod[value];
    }
}

interface NotificationListItem {
    method: NotificationMethod;
    recipient: string;
}

export class MessageService extends BaseClassLog {

    protected list: {[key: string]: NotificationListItem[]};
    protected mailTransport = nodemailer.createTransport({host: config.messageService.mail.host, port: config.messageService.mail.port, secure: false, auth: {}});

    public constructor() {
        super();

        this.list = {};
    }

    public addRecipient(method: NotificationMethod, listId: string, recipient: string) {
        this.log("debug", "Add new recipient (" + NotificationMethod[method] + ":" + recipient + ") for ID: " + listId);

        if(!this.list[listId])
            this.list[listId] = [];
        this.list[listId].push({method, recipient});
    }

    public sendNotifications(listId: string, message: string, filter?: NotificationMethod[]) {
        this.log("debug", "Sending notifications for ID: " + listId);

        if(this.list[listId]) {
            for (let i = 0; i < this.list[listId].length; i++) {
                if(!(typeof(filter) !== 'undefined') || (typeof(filter) !== 'undefined' && filter.indexOf(this.list[listId][i].method) >= 0))
                    this.sendNotification(this.list[listId][i].method, message, this.list[listId][i].recipient);
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
