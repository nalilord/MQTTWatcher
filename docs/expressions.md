# Expression Language

MQTTWatcher includes a safe custom expression engine.

## Operators
- &&, ||, !
- ==, !=, >=, <=, >, <
- parentheses

## Literals
Numbers, booleans, strings, placeholders.

## Templates inside expressions
```
${fields.used_percent} >= 90
${tags.path} == "/"
```

## Global Store Access
```
${store.door.contact}
```

## Examples
```
(${fields.used_percent} >= 95 && ${tags.path} == "/")
value == true && ${store.floor.occupancy} == true
```
