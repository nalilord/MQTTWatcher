# MQTTWatcher – Overview

MQTTWatcher is a modular, rule-based event engine for MQTT payloads.  
It listens to one or more MQTT topics, parses incoming JSON, evaluates
custom conditions, and sends notifications (log, mail, SMS) based on flexible rules.

## Core Concepts
### Watcher
A Watcher listens to one MQTT topic and evaluates EventItem rules.

### EventItem
Describes which part of the JSON payload is relevant.

### EventCondition
Defines when notifications should be fired.

### GlobalEventStore
In-memory store for cross-watcher dependencies.

### EventUtils
Handles expression evaluation, templating, helpers, and value resolution.

## Execution Flow (Short Version)
1. Parse incoming MQTT JSON  
2. For each EventItem:  
   - Active hours check  
   - Dependencies check  
   - Extract value  
   - Evaluate conditions  
   - Edge & cooldown logic  
   - Notifications  
3. Update GlobalEventStore  
