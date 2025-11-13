# Watcher Lifecycle

## Startup
- MessageService + Watchdog created  
- Each watcher initialized  
- Stateful events get default state stored  

## MQTT Connect
- Connects using mqtt://user:pass@host  
- Subscribes to topic  
- Auto-reconnects  

## Processing Messages
1. Parse JSON  
2. For each event:  
   - activeHours  
   - dependencies  
   - evaluate value/condition  
   - edge detection  
   - cooldown  
   - warning thresholds  
   - reset timers  
3. Update GlobalEventStore  

## State
Stateful:
- lastValue
- lastHandledValue
- timers: warning, reset

Dynamic:
- no state  
- no timers  

## Edge Detection
Only notify on false→true transitions (if rising).

## Cooldowns
Throttle notifications per condition key.

## Warning Threshold
Send secondary warnings if conditions persist.

## Reset
Reset state after inactivity.
