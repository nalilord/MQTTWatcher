# MQTTWatcher 🚨
**NodeJS-based Smart MQTT Event Watcher**  
Configurable, condition-driven notification system for MQTT topics.

---

## 🔧 Features

- 📡 Subscribes to MQTT topics and reacts to events
- ✅ Supports conditional logic and warning thresholds
- ⏰ Time-based activation per event (`activeHours`)
- 🔗 Dependency system (only trigger if another event is in a given state)
- 📣 Notification dispatch via:
  - Email (SMTP)
  - SMS (Twilio)
  - Log (Winston)
- ⚠️ Notification severity control (`debug` / `info` / `warning` / `critical`)
- 👨‍💻 Written in TypeScript — clean and modular

---

## 📆 Requirements

- Node.js >= 18
- A running MQTT broker (e.g. Mosquitto)
- A configured SMTP mail server (optional)
- Twilio credentials (optional for SMS)

---

## 📁 Project Structure

```
/src              → TypeScript sources
/config.json      → Main configuration file
/dist             → Compiled JavaScript output
/index.js         → Compiled entry point
/rc-script/       → Optional OpenRC service script
```

---

## ⚙️ Configuration

### `config.json` format (simplified):

```json
{
  "mqtt": {
    "host": "localhost",
    "port": 1883,
    "username": "user",
    "password": "pass"
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
    }
  ],
  "notificationList": [
    {
      "id": "door",
      "recipients": [
        { "type": "MAIL", "recipient": "you@example.com", "enabled": true },
        { "type": "SMS", "recipient": "+491234567890", "enabled": true, "minSeverity": "warning" }
      ]
    }
  ]
}
```

---

## 🚀 Build & Run

### Local Dev

```bash
npm install
npm run build
node dist/index.js
```

### System Service (OpenRC example)

```bash
# /etc/init.d/mqttwatcher
rc-service mqttwatcher start
```

---

## 🔒 Deployment Tip

Use `CONFIG_FILE=/etc/mqttwatcher/config.json` and `LOG_PATH=/var/log/mqttwatcher` as environment variables for flexibility.

---

## 📜 License

MIT – go wild, break stuff responsibly. 🧪

---

## 💬 Contact

Maintained by [@nalilord](https://github.com/nalilord)  
Star the repo if it saves your bacon 🍛.

