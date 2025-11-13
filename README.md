# MQTTWatcher
A flexible rule-based MQTT event processor with support for smart notifications, advanced condition logic, templating, edge detection, cooldowns, and dynamic high-frequency telemetry handling.

## Features
- Expression engine (==, !=, >=, <=, >, <, &&, ||, parentheses)
- Template helpers (:upper, :lower, :toFixed, :pct, :bytes, :sub, :cat, etc.)
- Dynamic stateless mode for fast telemetry
- Per-source state via `stateKey`
- Edge detection (`edge: "rising"`)
- Cooldowns (`cooldownSec`)
- Active hours
- Cross-watcher dependencies
- MQTT wildcards
- OpenRC init script included

## Requirements

- Node.js >= 18
- A running MQTT broker (e.g. Mosquitto)
- A configured SMTP mail server (optional)
- Twilio credentials (optional for SMS)

## Project Structure
```
mqttwatcher/
├── dist/
│   └── <build project>
├── files/
│   └── mqttwatcher.openrc.init
├── src/
│   ├── MQTTWatcher.ts
│   ├── config.json
│   └── core/
│       ├── Events.ts
│       ├── EventUtils.ts
│       ├── MessageService.ts
│       ├── MQTTConfig.ts
│       ├── MQTTLog.ts
│       ├── Watchdog.ts
│       └── Watcher.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Install
```
npm install
npm run build
```

## Run
```
CONFIG_FILE=/etc/mqttwatcher/config.json LOG_PATH=/var/log/mqttwatcher node dist/MQTTWatcher.js
```

## Config Example
```json
{
  "mqtt": { "host": "mqtt.server.local", "port": 1883, "username": "mqtt", "password": "secret" },

  "messageService": {
    "mail": { "host": "mail.server.local", "port": 25, "from": "\"MQTTWatcher\" <mqttwatcher@server.local>", "ignoreTLS": true }
  },

  "watchList": [
    {
      "id": "door",
      "topic": "zigbee2mqtt/DoorSensor",
      "events": [
        {
          "subject": "contact",
          "default": true,
          "activeHours": [{ "from": "22:00", "to": "06:00" }],
          "dependencies": [{ "path": "lock.contact", "state": true }],
          "conditions": [
            {
              "value": false,
              "message": "Door open!",
              "log": "New door state: OPEN",
              "warningThreshold": 300,
              "warningMessage": "Door has been open for over 5 minutes!",
              "severity": "warning"
            }
          ]
        }
      ]
    },
    {
      "id": "diskroot",
      "topic": "telegraf/+/disk/_",
      "enabled": true,
      "dynamic": true,
      "events": [
        {
          "subject": "fields.used_percent",
          "default": 0,
          "conditions": [
            {
              "condition": "${fields.used_percent} >= 90 && ${tags.path} == \"/\"",
              "edge": "rising",
              "cooldownSec": 1800,
              "key": "${tags.host}:${tags.path}",
              "log": "Disk usage high on ${tags.host}",
              "message": "ALERT: ${tags.path} ${fields.used_percent:toFixed(1):pct()} used on ${tags.host:upper}",
              "severity": "warning"
            }
          ]
        }
      ]
    }
  ],

  "notificationList": [
    {
      "id": "door",
      "recipients": [
        { "type": "MAIL", "recipient": "you@example.com", "enabled": true },
        { "type": "SMS", "recipient": "+491234567890", "enabled": true, "minSeverity": "warning" }
      ]
    },
    {
      "id": "diskroot",
      "recipients": [
        { "type": "MAIL", "enabled": true, "recipient": "alerts@example.com", "minSeverity": "warning" }
      ]
    }
  ]
}
```

## OpenRC Service
Located at: `files/mqttwatcher.openrc.init`
