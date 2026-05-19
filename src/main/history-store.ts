import Store from "electron-store";
import type { BackPingRequest } from "../shared/types.js";

interface HistorySchema {
  requests: BackPingRequest[];
}

export class HistoryStore {
  private readonly store: Store<HistorySchema>;

  constructor() {
    this.store = new Store<HistorySchema>({
      name: "backping-history",
      defaults: {
        requests: []
      }
    });
  }

  list(): BackPingRequest[] {
    return this.store.get("requests");
  }

  save(requests: BackPingRequest[], limit: number): void {
    const limited = [...requests]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
    this.store.set("requests", limited);
  }

  clear(): void {
    this.store.set("requests", []);
  }
}
