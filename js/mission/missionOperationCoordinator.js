"use strict";

export class MissionOperationCoordinator {
  constructor() {
    this.activeOperation = null;
  }

  current() {
    return this.activeOperation
      ? {
          label: this.activeOperation.label,
          startedAt: this.activeOperation.startedAt,
        }
      : null;
  }

  isBusy() {
    return this.activeOperation != null;
  }

  acquire(label) {
    if (this.activeOperation) return null;
    const token = Symbol(String(label || "mission operation"));
    const operation = {
      token,
      label: String(label || "mission operation"),
      startedAt: Date.now(),
    };
    this.activeOperation = operation;
    let released = false;
    return {
      label: operation.label,
      release: () => {
        if (released || this.activeOperation?.token !== token) return false;
        released = true;
        this.activeOperation = null;
        return true;
      },
    };
  }

  busyMessage(label = "mission operation") {
    const active = this.current();
    return active
      ? `Cannot start ${label} while ${active.label} is in progress.`
      : "";
  }
}

export const missionOperationCoordinator = new MissionOperationCoordinator();
