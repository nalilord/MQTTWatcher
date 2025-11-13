import config from "./MQTTConfig";
import {BaseClassLog} from "./MQTTLog";

// Nodemailer (commonjs import to match existing style)
const nodemailer = require("nodemailer");

/**
 * Twilio can be completely disabled by omitting credentials or setting
 * config.messageService.sms.enabled = false. We lazy-initialize the client
 * to avoid crashes when SMS isn't configured.
 */
function createTwilioClientOrNull(cfg: any) {
    try {
        const sms = (cfg && cfg.messageService && cfg.messageService.sms) ? cfg.messageService.sms : {};
        const enabled = sms.enabled !== false; // default true unless explicitly false
        if (!enabled) return null;

        const sid = sms.sid;
        const token = sms.token;

        // Only initialize when credentials look sane
        if (typeof sid === "string" && sid.startsWith("AC") && typeof token === "string" && token.length > 0) {
            return require("twilio")(sid, token);
        }
    } catch {
        // fall through to null; we will log on use
    }
    return null;
}

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

    protected list: { [key: string]: NotificationListItem[] };
    protected mailTransport: any;     // keep 'any' to avoid nodemailer type import churn
    protected twilioClient: any | null;

    public constructor() {
        super();

        this.list = {};

        // ---- Mail transport: pass through TLS options from config ----
        const mailCfg = (config.messageService && config.messageService.mail) ? config.messageService.mail : {};
        const tlsCfg = mailCfg.tls || {};

        this.mailTransport = nodemailer.createTransport({
            host: mailCfg.host,
            port: mailCfg.port,
            secure: false,                        // STARTTLS if available (unless ignoreTLS=true)
            name: mailCfg.name,                   // optional SMTP HELO name
            ignoreTLS: mailCfg.ignoreTLS === true,
            requireTLS: mailCfg.requireTLS === true,
            tls: {
                // SNI override when connecting by IP but cert is for a hostname
                servername: typeof tlsCfg.servername === "string" ? tlsCfg.servername : undefined,
                // ONLY disable verification on trusted LAN/test
                ...(typeof tlsCfg.rejectUnauthorized === "boolean" ? {rejectUnauthorized: tlsCfg.rejectUnauthorized} : {})
            },
            auth: mailCfg.auth || {}              // keep empty by default for relay
        });

        // ---- SMS (Twilio) lazy init ----
        this.twilioClient = createTwilioClientOrNull(config);
        if (!this.twilioClient) {
            this.log("info", "SMS service disabled (no credentials or sms.enabled=false).", "MessageService");
        }
    }

    public addRecipient(
        method: NotificationMethod,
        listId: string,
        recipient: string,
        minSeverity: "debug" | "info" | "warning" | "critical" = "info"
    ) {
        this.log("debug", "Add new recipient (" + NotificationMethod[method] + ":" + recipient + ") for ID: " + listId);

        if (!this.list[listId]) this.list[listId] = [];
        this.list[listId].push({method, recipient, minSeverity});
    }

    // Overloads
    public sendNotifications(listId: string, message: string, severity: string): void;
    public sendNotifications(listId: string, message: string, filter?: NotificationMethod[]): void;

    public sendNotifications(listId: string, message: string, filterOrSeverity?: NotificationMethod[] | string): void {
        this.log("debug", "Sending notifications for ID: " + listId);

        const severityOrder = {debug: 0, info: 1, warning: 2, critical: 3};

        const items = this.list[listId];
        if (!items || items.length === 0) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (Array.isArray(filterOrSeverity)) {
                if (filterOrSeverity.includes(item.method)) {
                    this.sendNotification(item.method, message, item.recipient);
                }
            } else if (typeof filterOrSeverity === "string") {
                const level = severityOrder[filterOrSeverity as keyof typeof severityOrder] ?? 1;
                const minLevel = severityOrder[item.minSeverity ?? "info"] ?? 1;

                if (level >= minLevel) {
                    this.sendNotification(item.method, message, item.recipient);
                }
            } else {
                this.sendNotification(item.method, message, item.recipient);
            }
        }
    }

    public sendNotification(method: NotificationMethod, message: string, recipient: string) {
        this.log("debug", "Sending " + NotificationMethod[method] + " notification to: " + recipient);

        // Local server timestamp (YYYY-MM-DD HH:mm:ss)
        const now = new Date();
        const timestamp =
            now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0") + " " +
            String(now.getHours()).padStart(2, "0") + ":" +
            String(now.getMinutes()).padStart(2, "0") + ":" +
            String(now.getSeconds()).padStart(2, "0");

        const fullMessage = `[${timestamp}] ${message}`;

        switch (method) {
            case NotificationMethod.LOG: {
                this.logger.info(fullMessage);
                break;
            }
            case NotificationMethod.MAIL: {
                this.mailTransport.sendMail({
                    from: config.messageService.mail.from,
                    to: recipient,
                    subject: "Notification Event",
                    text: fullMessage
                });
                break;
            }
            case NotificationMethod.SMS: {
                if (!this.twilioClient) {
                    this.log("warn", "SMS notification skipped: SMS service is disabled or not configured.", "MessageService");
                    return;
                }
                this.twilioClient.messages.create({
                    body: fullMessage,
                    messagingServiceSid: config.messageService.sms.service,
                    to: recipient
                });
                break;
            }
        }
    }
}
