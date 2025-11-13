// src/core/EventUtils.ts
//
// Shared utilities for MQTTWatcher:
//  - GlobalEventStore
//  - expression evaluation
//  - template interpolation
//  - helper functions
//

// ====================== Global Store ======================

export class GlobalEventStore {
    private static data: Record<string, Record<string, any>> = {};

    static update(watchId: string, subject: string, value: any) {
        if (!this.data[watchId]) this.data[watchId] = {};
        this.data[watchId][subject] = value;
    }

    static get(watchId: string, subject: string): any {
        return this.data[watchId]?.[subject];
    }

    static debugLog(): void {
        console.log("[GlobalEventStore]", JSON.stringify(this.data, null, 2));
    }
}

// ====================== Utility Class ======================

export class EventUtils {

    // ----- Normalization -----

    public static normalizeValue(input: any): string | number | boolean {
        if (typeof input === "string") {
            const lc = input.toLowerCase();
            if (lc === "true") return true;
            if (lc === "false") return false;
            if (!isNaN(Number(input))) return Number(input);
            return input;
        }
        return input;
    }

    public static compareValues(expected: any, actual: any): boolean {
        if (expected === undefined || expected === null) return true;
        if (typeof expected === "boolean") return expected == Boolean(actual);
        if (typeof expected === "number")  return expected == Number(actual);
        if (typeof expected === "string")  return expected == String(actual);
        return false;
    }

    // ----- Interpolation & helpers -----

    /**
     * Interpolate ${...} placeholders in a string.
     *   - ${path.to.value[:helper(...):helper2()]}
     *   - ${store.watchId.subject} (reads GlobalEventStore)
     */
    public static interpolate(template: string, payload: any): string {
        if (!template || typeof template !== "string") return template;

        return template.replace(/\$\{([^}]+)\}/g, (_, inside) => {
            const result = this.resolvePlaceholder(inside.trim(), payload);
            if (typeof result === "object") return JSON.stringify(result);
            return result == null ? "" : String(result);
        });
    }

    /** Dotted path lookup into payload */
    public static getValueByPath(obj: any, path: string): any {
        if (!path || !obj) return undefined;
        const parts = path.split(".");
        let cur: any = obj;
        for (const p of parts) {
            if (cur == null || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
            cur = cur[p];
        }
        return cur;
    }

    /** ${store.wid.subject} or ${path[:fn[:fn(args)]]} or ${value[:fn...]} */
    private static resolvePlaceholder(spec: string, payload: any): any {
        // store.<watchId>.<subject>
        if (spec.startsWith("store.")) {
            const m = spec.match(/^store\.([^\.]+)\.(.+)$/);
            if (!m) return "";
            const [, w, s] = m;
            return GlobalEventStore.get(w, s);
        }

        // Split first token (path or 'value') and then a chain of :fn(...)
        const tokens = this.splitByColonOutsideParens(spec);
        if (tokens.length === 0) return "";
        const head = tokens[0].trim();

        let v: any;
        if (head === "value") {
            v = payload && payload.__watcher_value !== undefined ? payload.__watcher_value : undefined;
        } else {
            v = this.getValueByPath(payload, head);
        }

        // Apply function chain
        for (let i = 1; i < tokens.length; i++) {
            v = this.applyHelper(tokens[i].trim(), v);
        }
        return v;
    }

    /** Split by ":" but ignore ":" inside parentheses */
    private static splitByColonOutsideParens(input: string): string[] {
        const out: string[] = [];
        let buf = "";
        let depth = 0;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === "(") { depth++; buf += ch; }
            else if (ch === ")") { depth = Math.max(0, depth - 1); buf += ch; }
            else if (ch === ":" && depth === 0) { out.push(buf); buf = ""; }
            else buf += ch;
        }
        if (buf) out.push(buf);
        return out;
    }

    /** Helper functions, chainable like :upper :sub(1,3):cat('...') */
    private static applyHelper(fnSpec: string, value: any): any {
        const m = fnSpec.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\((.*)\))?$/);
        if (!m) return value;
        const name = m[1];
        const args = this.parseArgs(m[2]);

        const S = (x: any) => (x == null ? "" : String(x));
        const N = (x: any) => Number(x);

        switch (name) {
            case "upper": return S(value).toUpperCase();
            case "lower": return S(value).toLowerCase();
            case "trim":  return S(value).trim();
            case "len":   return S(value).length;

            case "sub": { // sub(start,len)
                const start = N(args[0] ?? 0);
                const len = N(args[1] ?? 0);
                const s = S(value);
                return s.substring(start, start + len);
            }

            case "slice": { // slice(start,end)
                const start = N(args[0] ?? 0);
                const end = args[1] !== undefined ? N(args[1]) : undefined;
                return S(value).slice(start, end as any);
            }

            case "cat": { // cat(str)
                return S(value) + S(args[0] ?? "");
            }

            case "padStart": {
                const len = N(args[0] ?? 0);
                const fill = args[1] !== undefined ? S(args[1]) : " ";
                return S(value).padStart(len, fill);
            }

            case "padEnd": {
                const len = N(args[0] ?? 0);
                const fill = args[1] !== undefined ? S(args[1]) : " ";
                return S(value).padEnd(len, fill);
            }

            case "round": {
                const dec = N(args[0] ?? 0);
                const factor = Math.pow(10, dec);
                const num = Number(value);
                if (Number.isNaN(num)) return value;
                return Math.round(num * factor) / factor;
            }

            case "toFixed": {
                const dec = N(args[0] ?? 0);
                const num = Number(value);
                if (Number.isNaN(num)) return value;
                return num.toFixed(dec);
            }

            case "bytes": {
                const num = Number(value);
                if (!isFinite(num)) return value;
                const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
                let n = num, u = 0;
                while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
                return `${n.toFixed(n >= 10 || n % 1 === 0 ? 0 : 1)} ${units[u]}`;
            }

            case "pct": {
                const dec = N(args[0] ?? 0);
                const num = Number(value);
                if (Number.isNaN(num)) return value;
                return `${num.toFixed(dec)}%`;
            }

            default:
                // Unknown helper -> no-op
                return value;
        }
    }

    private static parseArgs(argStr?: string): any[] {
        if (argStr == null || argStr.trim() === "") return [];
        const args: any[] = [];
        let cur = "";
        let inStr: "'" | '"' | null = null;
        for (let i = 0; i < argStr.length; i++) {
            const ch = argStr[i];
            if (!inStr && (ch === "'" || ch === '"')) { inStr = ch as "'" | '"'; continue; }
            if (inStr && ch === inStr) {
                inStr = null;
                args.push(cur);
                cur = "";
                while (i + 1 < argStr.length && /\s|,/.test(argStr[i + 1])) i++;
                continue;
            }
            if (!inStr && ch === ",") {
                const v = this.parseBare(cur.trim());
                if (v !== undefined) args.push(v);
                cur = "";
                continue;
            }
            cur += ch;
        }
        if (cur.trim() !== "") {
            const v = this.parseBare(cur.trim());
            args.push(v !== undefined ? v : cur.trim());
        }
        return args;
    }

    private static parseBare(token: string): any {
        if (/^true$/i.test(token)) return true;
        if (/^false$/i.test(token)) return false;
        if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
        return token; // unquoted string
    }

    // ----- Expression engine -----

    /**
     * Evaluate an expression against actual value and payload.
     * Supports:
     *   - parentheses (...)
     *   - unary !
     *   - operators: == != >= <= > <
     *   - &&, ||
     *   - operands: value, numbers, booleans, "str", 'str', ${...}
     */
    public static evaluateExpression(expr: string, actual: any, payload: any): boolean {
        const payloadWithValue = { ...payload, __watcher_value: actual };
        const tokens = this.tokenize(expr);
        const rpn = this.toRPN(tokens);
        return this.evalRPN(rpn, payloadWithValue);
    }

    private static tokenize(expr: string): string[] {
        const out: string[] = [];
        let i = 0;
        const push = (t: string) => { if (t.length) out.push(t); };

        while (i < expr.length) {
            const ch = expr[i];

            if (/\s/.test(ch)) { i++; continue; }

            const two = expr.slice(i, i + 2);
            if (["==","!=",">=","<=","&&","||"].includes(two)) { push(two); i += 2; continue; }
            if (["(",")",">","<","!"].includes(ch)) { push(ch); i++; continue; }

            if (ch === "$" && expr[i + 1] === "{") {
                let j = i + 2, depth = 1;
                while (j < expr.length && depth > 0) {
                    if (expr[j] === "{") depth++;
                    else if (expr[j] === "}") depth--;
                    j++;
                }
                const raw = expr.slice(i, j);
                push(raw);
                i = j;
                continue;
            }

            if (ch === "'" || ch === '"') {
                const quote = ch;
                let j = i + 1;
                while (j < expr.length && expr[j] !== quote) j++;
                push(expr.slice(i, j + 1));
                i = j + 1;
                continue;
            }

            let j = i;
            while (j < expr.length && /[^\s\)\(\!\&\|\=\<\>]/.test(expr[j])) j++;
            push(expr.slice(i, j));
            i = j;
        }

        return out;
    }

    /** Shunting-yard to RPN */
    private static toRPN(tokens: string[]): string[] {
        const out: string[] = [];
        const opStack: string[] = [];

        const prec: Record<string, number> = {
            "!": 5,
            "==": 4, "!=": 4, ">=": 4, "<=": 4, ">": 4, "<": 4,
            "&&": 3,
            "||": 2
        };
        const rightAssoc = new Set(["!"]);
        const isOp = (t: string) => Object.prototype.hasOwnProperty.call(prec, t);

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];

            if (t === "(") { opStack.push(t); continue; }
            if (t === ")") {
                while (opStack.length && opStack[opStack.length - 1] !== "(") {
                    out.push(opStack.pop()!);
                }
                if (opStack.length && opStack[opStack.length - 1] === "(") opStack.pop();
                continue;
            }

            if (isOp(t)) {
                while (opStack.length) {
                    const top = opStack[opStack.length - 1];
                    if (!isOp(top)) break;
                    const cond = rightAssoc.has(t) ? (prec[t] < prec[top]) : (prec[t] <= prec[top]);
                    if (cond) out.push(opStack.pop()!);
                    else break;
                }
                opStack.push(t);
                continue;
            }

            out.push(t);
        }

        while (opStack.length) out.push(opStack.pop()!);
        return out;
    }

    private static evalRPN(rpn: string[], payload: any): boolean {
        const st: any[] = [];
        const pop = () => st.pop();
        const push = (v: any) => st.push(v);

        for (const t of rpn) {
            switch (t) {
                case "!": {
                    const a = pop();
                    push(this.truthy(a) ? false : true);
                    break;
                }
                case "&&": {
                    const b = pop(); const a = pop();
                    push(this.truthy(a) && this.truthy(b));
                    break;
                }
                case "||": {
                    const b = pop(); const a = pop();
                    push(this.truthy(a) || this.truthy(b));
                    break;
                }
                case "==": case "!=": case ">=": case "<=": case ">": case "<": {
                    const b = pop(); const a = pop();
                    push(this.compareOp(a, t, b));
                    break;
                }
                default: {
                    push(this.resolveOperand(t, payload));
                }
            }
        }

        return this.truthy(st.pop());
    }

    private static truthy(v: any): boolean {
        if (typeof v === "string") return v.length > 0;
        return !!v;
    }

    private static resolveOperand(token: string, payload: any): any {
        const t = token.trim();

        if (t === "value") return payload.__watcher_value;

        if (t.startsWith("${") && t.endsWith("}")) {
            const inner = t.slice(2, -1);
            return this.resolvePlaceholder(inner, payload);
        }

        if (/^true$/i.test(t)) return true;
        if (/^false$/i.test(t)) return false;

        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            return t.slice(1, -1);
        }

        if (!isNaN(Number(t))) return Number(t);

        return t; // bare word -> string literal
    }

    private static compareOp(a: any, op: string, b: any): boolean {
        const na = Number(a), nb = Number(b);
        const aIsNum = !Number.isNaN(na) && a !== "" && a !== null && a !== true && a !== false;
        const bIsNum = !Number.isNaN(nb) && b !== "" && b !== null && b !== true && b !== false;

        if (op === "==" || op === "!=") {
            const eq = String(this.normalizeValue(a)) == String(this.normalizeValue(b));
            return op === "==" ? eq : !eq;
        }

        if (aIsNum && bIsNum) {
            switch (op) {
                case ">": return na > nb;
                case "<": return na < nb;
                case ">=": return na >= nb;
                case "<=": return na <= nb;
            }
        } else {
            const sa = String(a), sb = String(b);
            switch (op) {
                case ">": return sa > sb;
                case "<": return sa < sb;
                case ">=": return sa >= sb;
                case "<=": return sa <= sb;
            }
        }
        return false;
    }
}
