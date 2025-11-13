# Templating System

Templating uses `${...}` and helper functions.

## Basic Placeholders
```
${fields.used_percent}
${tags.host}
${value}
```

## Global Store Access
```
${store.door.contact}
```

## Helpers
- upper  
- lower  
- trim  
- sub(start,len)  
- slice(start,end)  
- cat(str)  
- padStart(n,str)  
- padEnd(n,str)  
- round(dec)  
- toFixed(dec)  
- bytes()  
- pct(dec)

## Example
```
Disk ${tags.path:upper} on ${tags.host} at ${fields.used_percent:toFixed(1):pct()}
```
