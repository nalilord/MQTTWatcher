# Event Definitions

## EventItem
An EventItem describes what MQTTWatcher should observe.

### subject
Dotted-path lookup into the incoming payload.

### default
Initial value for stateful events.

### activeHours
Restrict time windows in which events are active.

### dependencies
Cross-watcher conditions such as:
```
{ "path": "floor.occupancy", "state": true }
```

### dynamic
If true: no state stored, ideal for telemetry.

### stateKey
Partition state by host/path etc.

### conditions
A list of EventCondition entries.

## EventCondition
Defines when an event triggers.

- value?: simple equality  
- condition?: expression engine  
- log: log text  
- message: notification text  
- severity  
- warningThreshold, warningMessage  
- reset  
- edge: "level" or "rising"  
- cooldownSec  
- key: composite key template  
