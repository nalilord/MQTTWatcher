import {Watcher} from "./Watcher";
import {BaseClassLog} from "./MQTTLog";

export class Watchdog extends BaseClassLog {

    private watchers: Watcher[];

    constructor() {
        super();

        this.watchers = [];
    }

    public add(watcher: Watcher) {
        this.watchers.push(watcher);
    }

    public run() {
        for (let i = 0; i < this.watchers.length; i++) {
            this.watchers[i].run();
        }
    }

    public isRunning(): boolean {
        for (let i = 0; i < this.watchers.length; i++) {
            if(this.watchers[i].isRunning())
                return true;
        }

        return false;
    }
}