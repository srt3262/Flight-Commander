"use strict";

import { mavlinkParameterManager } from "../mavlink/services.js";
import mavlinkSession from "../mavlink/mavlinkSession.js";
import {
  ArduPilotParameterMetadataProvider,
} from "../parameters/ardupilotParameterMetadata.js";
import {
  parameterView,
  validateParameterValue,
} from "../parameters/ardupilotParameterModel.js";

export const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246;
export const ARDUPILOT_REBOOT_AUTOPILOT = 1;

function connectionIdentity(state) {
  return [
    state?.systemId ?? "none",
    state?.componentId ?? "none",
    state?.vehicleType ?? "none",
    state?.autopilotVersion?.flight?.raw ?? "unknown",
    state?.bootGeneration ?? 0,
  ].join(":");
}

export class ArduPilotSetupService {
  constructor(options = {}) {
    this.session = options.session ?? mavlinkSession;
    this.parameterManager = options.parameterManager ?? mavlinkParameterManager;
    this.metadataProvider = options.metadataProvider
      ?? new ArduPilotParameterMetadataProvider();
    this.metadata = new Map();
    this.metadataResult = null;
    this.loadedIdentity = null;
    this.loadingIdentity = null;
    this.loadingPromise = null;
  }

  assertConnected() {
    const state = this.session.snapshot();
    if (
      !state.connected
      || state.linkLost
      || state.firmwareFamily !== "ardupilot"
    ) {
      throw new Error(
        "Connect an ArduPilot vehicle over MAVLink before opening setup.",
      );
    }
    return state;
  }

  isLoadedForCurrentVehicle() {
    const state = this.session.snapshot();
    return Boolean(
      state.connected
      && state.firmwareFamily === "ardupilot"
      && this.loadedIdentity === connectionIdentity(state)
      && this.parameterManager.parameters.size > 0
      && this.metadataResult != null,
    );
  }

  snapshot() {
    return Object.freeze({
      identity: this.loadedIdentity,
      parameters: this.parameterManager.values(),
      metadata: this.metadata,
      metadataResult: this.metadataResult,
    });
  }

  async ensureLoaded(options = {}) {
    const state = this.assertConnected();
    const identity = connectionIdentity(state);
    if (!options.force && this.isLoadedForCurrentVehicle()) {
      return this.snapshot();
    }
    if (this.loadingPromise && this.loadingIdentity === identity) {
      return this.loadingPromise;
    }

    this.loadingIdentity = identity;
    this.loadingPromise = Promise.all([
      this.parameterManager.loadAll({
        onProgress: options.onProgress,
      }),
      this.metadataProvider.load(state.vehicleType, {
        firmwareVersion: state.autopilotVersion?.flight,
      }),
    ])
      .then(([parameters, metadataResult]) => {
        const current = this.assertConnected();
        if (connectionIdentity(current) !== identity) {
          throw new Error(
            "The connected ArduPilot vehicle changed while setup was loading.",
          );
        }
        this.loadedIdentity = identity;
        this.metadataResult = metadataResult;
        this.metadata = metadataResult.metadata;
        return Object.freeze({
          identity,
          parameters,
          metadata: this.metadata,
          metadataResult,
        });
      })
      .finally(() => {
        if (this.loadingIdentity === identity) {
          this.loadingIdentity = null;
          this.loadingPromise = null;
        }
      });
    return this.loadingPromise;
  }

  parameter(id) {
    return this.parameterManager.parameters.get(String(id).toUpperCase()) ?? null;
  }

  view(id) {
    const parameter = this.parameter(id);
    return parameter ? parameterView(parameter, this.metadata) : null;
  }

  async writeChanges(changes, options = {}) {
    const state = this.assertConnected();
    if (state.armed) {
      throw new Error("Disarm the vehicle before writing setup parameters.");
    }
    const entries = changes instanceof Map
      ? [...changes.entries()]
      : Array.from(changes ?? [], (entry) => [entry.id, entry.value]);
    if (!entries.length) return Object.freeze([]);

    const validated = entries.map(([rawId, rawValue]) => {
      const id = String(rawId).trim().toUpperCase();
      const view = this.view(id);
      if (!view) throw new Error(`${id} is not available on this controller.`);
      if (view.metadata.readOnly) throw new Error(`${id} is read-only.`);
      const validation = validateParameterValue(view, rawValue);
      if (!validation.valid) throw new Error(validation.message);
      return Object.freeze({ id, value: validation.value, view });
    });

    const confirmations = [];
    for (let index = 0; index < validated.length; index += 1) {
      const change = validated[index];
      options.onProgress?.({
        index,
        total: validated.length,
        id: change.id,
        value: change.value,
      });
      try {
        confirmations.push(
          await this.parameterManager.set(change.id, change.value, {
            type: change.view.type,
          }),
        );
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        failure.confirmedParameterIds = Object.freeze(
          validated.slice(0, confirmations.length).map((entry) => entry.id),
        );
        throw failure;
      }
    }
    return Object.freeze(confirmations);
  }

  async rebootAutopilot() {
    const state = this.assertConnected();
    if (state.armed) {
      throw new Error("Disarm the vehicle before rebooting the flight controller.");
    }
    const target = this.session.target();
    await this.session.send("CommandLong", {
      ...target,
      command: MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
      confirmation: 0,
      param1: ARDUPILOT_REBOOT_AUTOPILOT,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
    return Object.freeze({ ...target, reboot: "autopilot" });
  }
}

export const ardupilotSetupService = new ArduPilotSetupService();
