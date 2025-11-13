// src/core/Events.ts
// Central type definitions for MQTTWatcher "project overview" and code reuse.

export type Severity = "debug" | "info" | "warning" | "critical";

/**
 * Restricts when an event is active.
 * If no activeHours are defined, the event is always active.
 */
export interface ActiveHoursRange {
    /** "HH:MM" in local time (e.g. "22:00") */
    from: string;
    /** "HH:MM" in local time (e.g. "06:00") */
    to: string;
}

/**
 * Dependency on another watcher’s subject.
 * Path format: "<watchId>.<subject>".
 *
 * Example:
 *   { "path": "door.contact", "state": true }
 */
export interface DependencyDef {
    path: string;
    state: any;
}

/**
 * A single condition inside an event.
 *
 * You can either:
 *  - use `value` for simple equality, or
 *  - use `condition` for full expression support.
 */
export interface EventCondition {
    /**
     * Simple equality check against the event subject value.
     * If set and no `condition` is provided, we compare directly using type-aware logic.
     */
    value?: any;

    /**
     * Advanced expression including placeholders:
     *   - operators: !  == != >= <= > <  &&  ||
     *   - parentheses: ( ... )
     *   - operands: value, numbers, booleans, "str", 'str', ${payload.path}
     *   - cross-event reads: ${store.<watchId>.<subject>}
     *
     * Example:
     *   "(${fields.used_percent} >= 90 && ${tags.path} == \"/\") || ${fields.inodes_used_percent} >= 85"
     */
    condition?: string;

    /**
     * Log line to write when this condition matches.
     * Supports ${...} placeholders and helper functions.
     */
    log: string;

    /**
     * Human-facing notification message.
     * Also supports ${...} placeholders and helper functions.
     */
    message: string;

    /** Optional severity level used by notification routing. */
    severity?: Severity;

    /**
     * Optional delayed secondary warning:
     *  - If set, and the condition remains true for `warningThreshold` seconds,
     *    a second notification can be sent with a different severity/message.
     */
    warningSeverity?: Severity;
    warningThreshold?: number; // seconds
    warningMessage?: string;

    /**
     * Reset lastValue to default after N seconds (stateful events only).
     * Ignored when event.dynamic === true.
     */
    reset?: number;

    /**
     * Notification mode:
     *  - "level" (default): every evaluation where the condition is true *may* notify.
     *  - "rising": only notify when the condition transitions from false → true.
     */
    edge?: "level" | "rising";

    /**
     * Minimum seconds between notifications per *source key*.
     * Works together with `edge` and `key`.
     *
     * Example:
     *   "cooldownSec": 1800   // max one notification every 30 minutes per disk
     */
    cooldownSec?: number;

    /**
     * Template used to derive the "source key" for edge/cooldown tracking.
     *
     * Example:
     *   "key": "${tags.host}:${tags.path}"
     *
     * If missing, the watcher falls back to:
     *   - event.stateKey, then
     *   - "${tags.host}:${tags.path}" if available, then
     *   - event.subject
     */
    key?: string;
}

/**
 * A logical event for one subject path in the payload.
 * Example subject: "fields.used_percent".
 */
export interface EventItem {
    /**
     * Dotted path into the JSON payload, e.g.:
     *   "fields.used_percent"
     *   "tags.host"
     */
    subject: string;

    /**
     * Default value for this subject, used to initialize state in some cases.
     */
    default: any;

    /**
     * Optional active time windows.
     * If omitted or empty, the event is always active.
     */
    activeHours?: ActiveHoursRange[];

    /**
     * Optional dependencies on other watcher states.
     * Path: "<watchId>.<subject>".
     */
    dependencies?: DependencyDef[];

    /**
     * If true, treat each message as stateless:
     *  - do not store into GlobalEventStore
     *  - do not track last values (no legacy duplicate suppression)
     *  - ignore warningThreshold/reset timers
     *
     * This is ideal for high-frequency telemetry (e.g., Telegraf) where you
     * rely on edge + cooldown instead of strict state comparisons.
     */
    dynamic?: boolean;

    /**
     * Optional partitioned state key for *stateful* tracking.
     *
     * Example:
     *   "stateKey": "${tags.host}:${tags.path}"
     *
     * This allows:
     *  - per-host/per-path duplicate suppression
     *  - per-host/per-path warnings and resets
     *
     * If both dynamic===true and stateKey are set, dynamic wins (stateless).
     */
    stateKey?: string;

    /**
     * One or more conditions that can match for this event.
     * All conditions are evaluated independently for each incoming MQTT message.
     */
    conditions: EventCondition[];
}
