"use strict";

import CONFIGURATOR from "../data_storage.js";
import FC from "../fc.js";
import MSP from "../msp.js";
import MSPCodes from "../msp/MSPCodes.js";
import mavlinkSession from "../mavlink/mavlinkSession.js";
import { paddedMavlinkRtcmData, Rtcm3Parser } from "./rtcm3.js";
import RtkCorrectionForwarder from "./rtkCorrectionForwarder.js";
import { resolveRtkCorrectionRoute } from "./rtkCorrectionRoute.js";
import { buildNmeaGga } from "./nmeaGga.js";
import {
  parseNtripSourcetable,
  sortNtripMountpoints,
} from "./ntripSourcetable.js";
import {
  resolveNtripProviderSettings,
  validateNtripProviderAccount,
} from "./ntripProviders.js";
import {
  RTK_REFINEMENT_MAX_FIXED_SAMPLES,
  RTK_REFINEMENT_MIN_FIXED_SAMPLES,
  summarizeFixedSamples,
} from "./rtkBaseRefinement.js";
import {
  buildF9BaseValset,
  buildF9NtripPositioningValset,
  parseUbxAck,
  parseUbxMonVer,
  parseUbxNavPvt,
  parseUbxNavSvin,
  UBX_CLASS_CFG,
  UBX_CLASS_MON,
  UBX_CLASS_NAV,
  UBX_ID_CFG_VALSET,
  UBX_ID_MON_VER,
  UBX_ID_NAV_PVT,
  UBX_ID_NAV_SVIN,
  UBX_POLL_MON_VER,
  UBX_POLL_NAV_PVT,
  UBX_POLL_NAV_SVIN,
  UbxParser,
} from "./ubloxF9Base.js";

const ACK_TIMEOUT_MS = 4000;
// Normal radio backpressure can exceed the firmware's fragment window before
// the first byte of a frame has even left the PC. Pace whole frames upstream,
// and reserve this deadline for a genuinely stalled native transport write.
const RTCM_TRANSPORT_WRITE_TIMEOUT_MS = 2500;
const RTCM_TRANSPORT_PRIORITY = 50;

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Uint8Array.from(value.data);
  }
  return Uint8Array.from(value ?? []);
}

function cloneState(state, forwarder) {
  return Object.freeze({
    ...state,
    receiver: Object.freeze({ ...state.receiver }),
    receiverPosition: state.receiverPosition
      ? Object.freeze({ ...state.receiverPosition })
      : null,
    surveyIn: state.surveyIn ? Object.freeze({ ...state.surveyIn }) : null,
    refinement: Object.freeze({
      ...state.refinement,
      surveyPosition: state.refinement.surveyPosition
        ? Object.freeze({ ...state.refinement.surveyPosition })
        : null,
      meanPosition: state.refinement.meanPosition
        ? Object.freeze({ ...state.refinement.meanPosition })
        : null,
    }),
    ntrip: Object.freeze({ ...state.ntrip }),
    stats: Object.freeze({
      ...state.stats,
      ...forwarder.snapshot(),
    }),
  });
}

class RtkBaseStationService {
  constructor(options = {}) {
    this.bridge = options.bridge ?? globalThis.window?.electronAPI ?? null;
    this.listeners = new Set();
    this.pendingAck = null;
    this.ntripSettings = null;
    this.ntripGgaTimer = null;
    this.baseInjectionQueue = [];
    this.baseInjectionBusy = false;
    this.baseInjectionGeneration = 0;
    this.refinementSamples = [];
    this.state = {
      connected: false,
      connectionId: null,
      path: null,
      bitrate: null,
      profile: "ublox-f9",
      correctionSource: "usb-base",
      receiver: {
        model: null,
        softwareVersion: null,
        hardwareVersion: null,
        protocolVersion: null,
      },
      surveyIn: null,
      receiverPosition: null,
      refinement: {
        phase: "idle",
        requiredSamples: RTK_REFINEMENT_MIN_FIXED_SAMPLES,
        fixedSamples: 0,
        stabilityM: null,
        surveyPosition: null,
        meanPosition: null,
        lastError: null,
      },
      ntrip: {
        connected: false,
        host: null,
        port: null,
        mountpoint: null,
        tls: false,
        destination: "aircraft",
        ggaSource: "none",
        bytes: 0,
        frames: 0,
        invalidFrames: 0,
        injectedToBaseFrames: 0,
        injectionDrops: 0,
        usbRoutingArmed: false,
        lastGgaError: null,
        lastError: null,
      },
      lastConfiguration: null,
      lastError: null,
      stats: {
        serialBytes: 0,
        invalidRtcmFrames: 0,
        invalidUbxFrames: 0,
        usbRtcmFrames: 0,
        activeRtcmFrames: 0,
        standbyFrames: 0,
        lastActiveMessageType: null,
      },
    };

    this.rtcmParser = new Rtcm3Parser({
      onFrame: (frame, metadata) => {
        this.state.stats.usbRtcmFrames += 1;
        if (this.state.correctionSource === "usb-base") {
          this.handleActiveCorrectionFrame(frame, metadata);
        }
      },
      onInvalid: () => {
        this.state.stats.invalidRtcmFrames += 1;
        this.notify();
      },
    });
    this.ntripParser = new Rtcm3Parser({
      onFrame: (frame) => this.handleNtripFrame(frame),
      onInvalid: () => {
        this.state.ntrip.invalidFrames += 1;
        this.notify();
      },
    });
    this.ubxParser = new UbxParser({
      onFrame: (envelope) => this.handleUbx(envelope),
      onInvalid: () => {
        this.state.stats.invalidUbxFrames += 1;
        this.notify();
      },
    });
    this.forwarder = new RtkCorrectionForwarder({
      sendPacket: (packet) => this.sendCorrectionPacket(packet),
      onChange: () => this.notify(),
    });
    this.registerBridgeListeners();
  }

  registerBridgeListeners() {
    if (!this.bridge) return;
    this.dataHandler = this.bridge.onRtkBaseData?.((envelope) => {
      if (envelope?.connectionId !== this.state.connectionId) return;
      const data = byteView(envelope.data);
      this.state.stats.serialBytes += data.length;
      this.ubxParser.push(data);
      this.rtcmParser.push(data);
      this.notify();
    });
    this.errorHandler = this.bridge.onRtkBaseError?.((envelope) => {
      if (envelope?.connectionId !== this.state.connectionId) return;
      this.state.lastError = envelope.error || "USB RTK base serial error.";
      this.state.connected = false;
      this.rejectPendingAck(new Error(this.state.lastError));
      if (this.state.ntrip.destination === "usb-base") {
        this.disconnectNtrip().catch(() => {});
      }
      this.notify();
    });
    this.closeHandler = this.bridge.onRtkBaseClose?.((envelope) => {
      if (envelope?.connectionId !== this.state.connectionId) return;
      this.state.connected = false;
      this.state.connectionId = null;
      this.rejectPendingAck(new Error("USB RTK base serial connection closed."));
      if (this.state.ntrip.destination === "usb-base") {
        this.disconnectNtrip().catch(() => {});
      }
      this.notify();
    });
    this.ntripDataHandler = this.bridge.onNtripData?.((value) => {
      const data = byteView(value);
      this.state.ntrip.bytes += data.length;
      this.ntripParser.push(data);
      this.notify();
    });
    this.ntripStatusHandler = this.bridge.onNtripStatus?.((status) => {
      this.state.ntrip.connected = status?.connected === true;
      this.state.ntrip.lastError = null;
      this.notify();
    });
    this.ntripErrorHandler = this.bridge.onNtripError?.((error) => {
      this.state.ntrip.lastError = error?.error || "NTRIP stream error.";
      this.notify();
    });
    this.ntripCloseHandler = this.bridge.onNtripClose?.(() => {
      this.state.ntrip.connected = false;
      this.state.ntrip.usbRoutingArmed = false;
      this.state.ntrip.lastError = "The NTRIP caster closed the correction stream.";
      this.ntripSettings = null;
      this.baseInjectionGeneration += 1;
      this.baseInjectionQueue.length = 0;
      this.stopNtripGga();
      if (this.state.lastConfiguration?.mode === "ntrip-positioning") {
        this.state.refinement = {
          ...this.state.refinement,
          phase: "failed",
          lastError:
            "The caster stream closed during refinement. Restore the surveyed base before continuing.",
        };
      }
      this.notify();
    });
  }

  snapshot() {
    return cloneState(this.state, this.forwarder);
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("RTK base listener must be a function.");
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("RTK base status listener failed:", error);
      }
    }
  }

  routeStatus() {
    return resolveRtkCorrectionRoute({
      mavlinkState: mavlinkSession.state,
      firmwareIdentity: FC.CONFIG?.firmwareIdentity,
      connectionValid: CONFIGURATOR.connectionValid,
      connectionProtocol: CONFIGURATOR.connectionProtocol,
    });
  }

  async listDevices() {
    if (typeof this.bridge?.listSerialDeviceInfo !== "function") return [];
    return this.bridge.listSerialDeviceInfo();
  }

  async listNtripMountpoints(settings = {}) {
    if (typeof this.bridge?.ntripListMountpoints !== "function") {
      throw new Error("NTRIP mountpoint discovery is unavailable in this build.");
    }
    const result = await this.bridge.ntripListMountpoints(
      resolveNtripProviderSettings(settings),
    );
    if (!result || result.error) {
      throw new Error(result?.msg || "Unable to load the NTRIP caster sourcetable.");
    }
    const records = parseNtripSourcetable(result.sourcetable);
    if (!records.length) {
      throw new Error("The caster sourcetable does not contain any selectable data streams.");
    }
    return sortNtripMountpoints(records, this.mountpointReferencePosition());
  }

  async connect(settings = {}) {
    if (typeof this.bridge?.rtkBaseConnect !== "function") {
      throw new Error("USB RTK base serial support is unavailable in this build.");
    }
    if (this.state.connected) await this.disconnect();
    this.state.profile = settings.profile === "raw-rtcm" ? "raw-rtcm" : "ublox-f9";
    this.state.lastError = null;
    this.state.receiver = {
      model: null,
      softwareVersion: null,
      hardwareVersion: null,
      protocolVersion: null,
    };
    this.state.surveyIn = null;
    this.state.receiverPosition = null;
    this.state.lastConfiguration = null;
    this.resetRefinement("idle");
    this.baseInjectionGeneration += 1;
    this.baseInjectionQueue.length = 0;
    this.rtcmParser.reset();
    this.ubxParser.reset();
    const result = await this.bridge.rtkBaseConnect(settings.path, {
      bitrate: Number(settings.bitrate ?? 115200),
    });
    if (!result || result.error) {
      throw new Error(result?.msg || "Unable to open the USB RTK base serial port.");
    }
    this.state.connected = true;
    this.state.connectionId = result.connectionId;
    this.state.path = result.path;
    this.state.bitrate = result.bitrate;
    this.notify();
    if (this.state.profile === "ublox-f9") {
      await this.pollStatus().catch((error) => {
        this.state.lastError = error.message;
        this.notify();
      });
    }
    return this.snapshot();
  }

  async disconnect() {
    if (this.state.ntrip.connected && this.state.ntrip.destination === "usb-base") {
      await this.disconnectNtrip();
    }
    this.baseInjectionGeneration += 1;
    this.baseInjectionQueue.length = 0;
    if (this.state.connectionId != null && this.bridge?.rtkBaseClose) {
      const result = await this.bridge.rtkBaseClose(this.state.connectionId);
      if (result?.error) throw new Error(result.msg || "Unable to close USB RTK base serial port.");
    }
    this.rejectPendingAck(new Error("USB RTK base disconnected."));
    this.state.connected = false;
    this.state.connectionId = null;
    this.state.lastConfiguration = null;
    this.resetRefinement("idle");
    this.notify();
  }

  async sendToBase(data) {
    if (!this.state.connected || this.state.connectionId == null) {
      throw new Error("Connect the USB RTK base before sending configuration.");
    }
    const result = await this.bridge.rtkBaseSend(data, this.state.connectionId);
    if (!result || result.error) {
      throw new Error(result?.msg || "USB RTK base serial write failed.");
    }
    return result.bytesWritten;
  }

  async pollStatus() {
    if (!this.state.connected || this.state.profile !== "ublox-f9") return false;
    await this.sendToBase(UBX_POLL_MON_VER);
    await this.sendToBase(UBX_POLL_NAV_SVIN);
    await this.sendToBase(UBX_POLL_NAV_PVT);
    return true;
  }

  waitForAck(messageClass, messageId) {
    this.rejectPendingAck(new Error("A newer u-blox configuration replaced the pending request."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pendingAck) return;
        this.pendingAck = null;
        reject(new Error("u-blox did not acknowledge CFG-VALSET within 4 seconds."));
      }, ACK_TIMEOUT_MS);
      this.pendingAck = { messageClass, messageId, resolve, reject, timer };
    });
  }

  rejectPendingAck(error) {
    if (!this.pendingAck) return;
    clearTimeout(this.pendingAck.timer);
    const { reject } = this.pendingAck;
    this.pendingAck = null;
    reject(error);
  }

  async configureF9Base(settings) {
    if (this.state.profile !== "ublox-f9") {
      throw new Error("Select the u-blox F9 base profile before applying receiver configuration.");
    }
    if (this.state.ntrip.connected && this.state.ntrip.destination === "usb-base") {
      throw new Error("Disconnect NTRIP before changing the USB F9 from positioning mode into base mode.");
    }
    const frame = buildF9BaseValset(settings);
    await this.applyF9Valset(frame);
    this.state.lastConfiguration = {
      mode: settings.mode === "fixed" ? "fixed" : "survey-in",
      appliedAt: Date.now(),
    };
    this.resetRefinement(settings.mode === "fixed" ? "base-ready" : "surveying");
    this.state.lastError = null;
    this.notify();
    setTimeout(() => this.pollStatus().catch(() => {}), 250);
    return this.snapshot();
  }

  async configureF9NtripPositioning() {
    if (this.state.profile !== "ublox-f9") {
      throw new Error("Select the u-blox F9 profile before enabling NTRIP positioning mode.");
    }
    await this.applyF9Valset(buildF9NtripPositioningValset({ persist: false }));
    this.state.lastConfiguration = {
      mode: "ntrip-positioning",
      appliedAt: Date.now(),
    };
    this.refinementSamples.length = 0;
    this.state.refinement = {
      ...this.state.refinement,
      phase: "collecting",
      fixedSamples: 0,
      stabilityM: null,
      meanPosition: null,
      lastError: null,
    };
    this.state.lastError = null;
    this.notify();
    setTimeout(() => this.pollStatus().catch(() => {}), 250);
    return this.snapshot();
  }

  resetRefinement(phase = "idle", options = {}) {
    this.refinementSamples.length = 0;
    this.state.refinement = {
      phase,
      requiredSamples: RTK_REFINEMENT_MIN_FIXED_SAMPLES,
      fixedSamples: 0,
      stabilityM: null,
      surveyPosition: options.surveyPosition
        ? { ...options.surveyPosition }
        : null,
      meanPosition: null,
      lastError: options.lastError ?? null,
    };
  }

  handleRefinementPosition(position) {
    if (this.state.lastConfiguration?.mode !== "ntrip-positioning") return;
    if (!this.state.ntrip.connected || !this.state.ntrip.usbRoutingArmed) return;
    if (!position?.fixOk || position.carrierSolution !== 2) {
      this.refinementSamples.length = 0;
      this.state.refinement = {
        ...this.state.refinement,
        phase: "collecting",
        fixedSamples: 0,
        stabilityM: null,
        meanPosition: null,
        lastError: "RTK Fixed was lost; the stability sample window restarted.",
      };
      return;
    }
    this.refinementSamples.push({ ...position });
    if (this.refinementSamples.length > RTK_REFINEMENT_MAX_FIXED_SAMPLES) {
      this.refinementSamples.shift();
    }
    const summary = summarizeFixedSamples(
      this.refinementSamples,
      RTK_REFINEMENT_MIN_FIXED_SAMPLES,
    );
    this.state.refinement = {
      ...this.state.refinement,
      phase: summary.ready ? "refined-ready" : "collecting",
      fixedSamples: summary.samples,
      stabilityM: summary.stabilityM,
      meanPosition: summary,
      lastError: null,
    };
  }

  async applyF9Valset(frame) {
    const acknowledgment = this.waitForAck(UBX_CLASS_CFG, UBX_ID_CFG_VALSET);
    try {
      await this.sendToBase(frame);
      await acknowledgment;
    } catch (error) {
      if (this.pendingAck) this.rejectPendingAck(error);
      await acknowledgment.catch(() => {});
      this.state.lastError = error.message;
      this.notify();
      throw error;
    }
  }

  handleUbx(envelope) {
    const acknowledgment = parseUbxAck(envelope);
    if (acknowledgment && this.pendingAck) {
      if (
        acknowledgment.messageClass === this.pendingAck.messageClass &&
        acknowledgment.messageId === this.pendingAck.messageId
      ) {
        clearTimeout(this.pendingAck.timer);
        const { resolve, reject } = this.pendingAck;
        this.pendingAck = null;
        if (acknowledgment.acknowledged) resolve(acknowledgment);
        else reject(new Error("u-blox rejected the base-station CFG-VALSET command."));
      }
    }
    if (envelope.messageClass === UBX_CLASS_MON && envelope.messageId === UBX_ID_MON_VER) {
      const version = parseUbxMonVer(envelope.payload);
      if (version) {
        this.state.receiver = {
          model: version.model,
          softwareVersion: version.softwareVersion,
          hardwareVersion: version.hardwareVersion,
          protocolVersion: version.protocolVersion,
        };
      }
    }
    if (envelope.messageClass === UBX_CLASS_NAV && envelope.messageId === UBX_ID_NAV_SVIN) {
      this.state.surveyIn = parseUbxNavSvin(envelope.payload);
      if (
        this.state.surveyIn?.valid &&
        this.state.lastConfiguration?.mode === "survey-in"
      ) {
        this.state.refinement = {
          ...this.state.refinement,
          phase: "survey-ready",
          lastError: null,
        };
      }
    }
    if (envelope.messageClass === UBX_CLASS_NAV && envelope.messageId === UBX_ID_NAV_PVT) {
      this.state.receiverPosition = parseUbxNavPvt(envelope.payload);
      this.handleRefinementPosition(this.state.receiverPosition);
    }
    this.notify();
  }

  async sendCorrectionPacket(packet) {
    const route = this.routeStatus();
    if (!route.available) throw new Error(route.reason);
    if (route.transport === "MAVLink") {
      await mavlinkSession.send("GpsRtcmData", {
        flags: packet.flags,
        len: packet.len,
        data: paddedMavlinkRtcmData(packet.data),
      }, {
        transportPriority: RTCM_TRANSPORT_PRIORITY,
        replaceKey: "mavlink-rtcm",
        writeTimeoutMs: RTCM_TRANSPORT_WRITE_TIMEOUT_MS,
      });
      return { transport: "MAVLink" };
    }
    await MSP.promise(MSPCodes.MSP2_FLIGHT_COMMANDER_RTCM_DATA, [
      packet.flags,
      packet.len,
      ...packet.data,
    ], undefined, {
      priority: true,
      transportPriority: RTCM_TRANSPORT_PRIORITY,
      replaceKey: "msp-rtcm",
      timeoutMs: RTCM_TRANSPORT_WRITE_TIMEOUT_MS,
      // A delayed retry can outlive the firmware's 500 ms fragment assembly
      // window. Fail this frame promptly so the next fresh sequence can start.
      retryCounter: 0,
    });
    return { transport: "MSP" };
  }

  setForwarding(enabled) {
    this.forwarder.setEnabled(enabled);
  }

  handleActiveCorrectionFrame(frame, metadata = {}) {
    this.state.stats.activeRtcmFrames += 1;
    this.state.stats.lastActiveMessageType = metadata.messageType ?? null;
    if (!this.forwarder.snapshot().enabled) {
      this.notify();
      return false;
    }
    const route = this.routeStatus();
    if (!route.available) {
      // Keep monitoring the live base or caster while the aircraft is off.
      // Do not queue corrections which would already be stale at connection.
      this.state.stats.standbyFrames += 1;
      this.notify();
      return false;
    }
    return this.forwarder.enqueue(frame);
  }

  setCorrectionSource(source) {
    if (!["usb-base", "ntrip"].includes(source)) {
      throw new RangeError("Correction source must be usb-base or ntrip.");
    }
    this.state.correctionSource = source;
    this.notify();
  }

  setNtripDestination(destination) {
    if (!["aircraft", "usb-base"].includes(destination)) {
      throw new RangeError("NTRIP destination must be aircraft or usb-base.");
    }
    if (this.state.ntrip.connected) {
      throw new Error("Disconnect NTRIP before changing its RTCM destination.");
    }
    this.state.ntrip.destination = destination;
    this.notify();
  }

  async connectNtrip(settings = {}) {
    if (typeof this.bridge?.ntripConnect !== "function") {
      throw new Error("NTRIP client support is unavailable in this build.");
    }
    const resolvedSettings = validateNtripProviderAccount(settings);
    this.ntripSettings = { ...resolvedSettings };
    this.ntripParser.reset();
    this.state.ntrip = {
      ...this.state.ntrip,
      connected: false,
      host: String(resolvedSettings.host ?? "").trim(),
      port: Number(resolvedSettings.port ?? (resolvedSettings.tls ? 443 : 2101)),
      mountpoint: String(resolvedSettings.mountpoint ?? "").trim(),
      tls: resolvedSettings.tls === true,
      destination: resolvedSettings.destination === "usb-base" ? "usb-base" : "aircraft",
      ggaSource: ["aircraft", "usb-base", "manual"].includes(resolvedSettings.ggaSource)
        ? resolvedSettings.ggaSource
        : "none",
      bytes: 0,
      frames: 0,
      invalidFrames: 0,
      injectedToBaseFrames: 0,
      injectionDrops: 0,
      usbRoutingArmed: false,
      lastGgaError: null,
      lastError: null,
    };
    if (
      this.state.ntrip.destination === "usb-base" &&
      resolvedSettings.deferUsbRouting !== true
    ) {
      this.assertNtripUsbDestinationReady();
    }
    let initialGga = null;
    try {
      if (this.state.ntrip.ggaSource !== "none") {
        initialGga = buildNmeaGga(this.ntripGgaPosition());
      }
    } catch (error) {
      this.ntripSettings = null;
      this.state.ntrip.lastError = error?.message || String(error);
      this.notify();
      throw error;
    }
    this.state.correctionSource = "ntrip";
    this.notify();
    let result;
    try {
      result = await this.bridge.ntripConnect(resolvedSettings);
    } catch (error) {
      result = { error: true, msg: error?.message || String(error) };
    }
    if (!result || result.error) {
      this.state.ntrip.lastError = result?.msg || "Unable to connect to the NTRIP caster.";
      this.ntripSettings = null;
      await this.bridge.ntripClose?.().catch?.(() => {});
      this.notify();
      throw new Error(this.state.ntrip.lastError);
    }
    this.state.ntrip.connected = true;
    this.startNtripGga();
    if (initialGga) {
      const ggaResult = await this.bridge.ntripSendGga(initialGga);
      if (ggaResult?.error) {
        await this.disconnectNtrip();
        throw new Error(ggaResult.msg || "NTRIP GGA write failed.");
      }
    }
    this.notify();
    return this.snapshot();
  }

  async disconnectNtrip() {
    this.stopNtripGga();
    try {
      if (this.bridge?.ntripClose) {
        const result = await this.bridge.ntripClose();
        if (result?.error) {
          this.state.ntrip.lastError = result.msg || "Unable to close the NTRIP stream cleanly.";
        }
      }
    } catch (error) {
      this.state.ntrip.lastError = error?.message || String(error);
    } finally {
      this.state.ntrip.connected = false;
      this.state.ntrip.usbRoutingArmed = false;
      this.baseInjectionGeneration += 1;
      this.baseInjectionQueue.length = 0;
      this.ntripSettings = null;
      this.notify();
    }
    return this.snapshot();
  }

  async beginNtripSurveyRefinement(settings = {}) {
    if (!this.state.connected || this.state.profile !== "ublox-f9") {
      throw new Error("Connect the USB u-blox F9 before refining its surveyed position.");
    }
    if (!this.state.surveyIn?.valid || this.state.lastConfiguration?.mode !== "survey-in") {
      throw new Error("Complete a valid base survey-in before starting NTRIP refinement.");
    }
    if (!this.state.receiverPosition?.fixOk) {
      throw new Error("Wait for a valid surveyed receiver position before starting NTRIP refinement.");
    }
    const surveyPosition = { ...this.state.receiverPosition };
    this.resetRefinement("ntrip-connecting", { surveyPosition });
    const refinementSettings = {
      ...settings,
      destination: "usb-base",
      ggaSource: "usb-base",
      deferUsbRouting: true,
    };
    let positioningAttempted = false;
    try {
      // Establish and validate the caster before changing the still-valid base.
      await this.connectNtrip(refinementSettings);
      positioningAttempted = true;
      await this.configureF9NtripPositioning();
      if (!this.state.ntrip.connected) {
        throw new Error("The NTRIP caster closed before USB positioning mode was ready.");
      }
      this.state.refinement.surveyPosition = surveyPosition;
      this.state.ntrip.usbRoutingArmed = true;
      this.state.refinement.phase = "collecting";
      this.state.correctionSource = "ntrip";
      this.notify();
      return this.snapshot();
    } catch (error) {
      if (this.state.ntrip.connected) await this.disconnectNtrip().catch(() => {});
      if (positioningAttempted) {
        try {
          await this.restoreSurveyedFixedBase(
            settings,
            surveyPosition,
            `NTRIP refinement did not start; the surveyed position was restored. ${error?.message || String(error)}`,
          );
        } catch (restoreError) {
          this.state.refinement = {
            ...this.state.refinement,
            phase: "failed",
            surveyPosition,
            lastError:
              `NTRIP refinement failed and the surveyed base could not be restored: ${restoreError?.message || String(restoreError)}`,
          };
          this.notify();
          throw new Error(this.state.refinement.lastError, { cause: restoreError });
        }
        throw error;
      }
      this.state.refinement = {
        ...this.state.refinement,
        phase: "survey-ready",
        surveyPosition,
        lastError: error?.message || String(error),
      };
      this.notify();
      throw error;
    }
  }

  async finalizeNtripRefinedBase(settings = {}) {
    const fixed = this.captureFixedPosition();
    this.state.refinement.phase = "finalizing";
    this.state.ntrip.usbRoutingArmed = false;
    this.notify();
    await this.disconnectNtrip();
    try {
      await this.configureF9Base({
        ...settings,
        mode: "fixed",
        latitude: fixed.latitude,
        longitude: fixed.longitude,
        ellipsoidHeightM: fixed.ellipsoidHeightM,
        fixedPositionAccuracyM: fixed.fixedPositionAccuracyM,
      });
      this.state.correctionSource = "usb-base";
      this.state.refinement = {
        ...this.state.refinement,
        phase: "base-ready",
        fixedSamples: fixed.samples,
        stabilityM: fixed.stabilityM,
        meanPosition: fixed,
        lastError: null,
      };
      this.notify();
      return { fixed, state: this.snapshot() };
    } catch (error) {
      this.state.refinement = {
        ...this.state.refinement,
        phase: "failed",
        lastError: error?.message || String(error),
      };
      this.notify();
      throw error;
    }
  }

  async cancelNtripSurveyRefinement(settings = {}) {
    const surveyed = this.state.refinement.surveyPosition;
    await this.disconnectNtrip();
    if (this.state.lastConfiguration?.mode !== "ntrip-positioning") {
      return this.snapshot();
    }
    await this.restoreSurveyedFixedBase(
      settings,
      surveyed,
      "NTRIP refinement was cancelled; the completed survey-in position was restored as the fixed base.",
    );
    return this.snapshot();
  }

  async restoreSurveyedFixedBase(settings, surveyed, message) {
    if (!surveyed?.fixOk) {
      throw new Error(
        "NTRIP refinement stopped, but no surveyed position is available to restore.",
      );
    }
    await this.configureF9Base({
      ...settings,
      mode: "fixed",
      latitude: surveyed.latitude,
      longitude: surveyed.longitude,
      ellipsoidHeightM: surveyed.ellipsoidHeightM,
      fixedPositionAccuracyM: Math.max(
        this.state.surveyIn?.meanAccuracyM ?? 0,
        surveyed.horizontalAccuracyM ?? 0,
        surveyed.verticalAccuracyM ?? 0,
        0.02,
      ),
    });
    this.state.correctionSource = "usb-base";
    this.state.refinement = {
      ...this.state.refinement,
      phase: "base-ready",
      surveyPosition: surveyed,
      lastError: message,
    };
    this.notify();
    return this.snapshot();
  }

  startNtripGga() {
    this.stopNtripGga();
    this.ntripGgaTimer = setInterval(() => this.sendNtripGga().catch(() => {}), 10000);
    this.ntripGgaTimer.unref?.();
  }

  stopNtripGga() {
    if (this.ntripGgaTimer) clearInterval(this.ntripGgaTimer);
    this.ntripGgaTimer = null;
  }

  aircraftPosition() {
    if (mavlinkSession.state.connected && Number.isFinite(mavlinkSession.state.latitude)) {
      return {
        latitude: mavlinkSession.state.latitude,
        longitude: mavlinkSession.state.longitude,
        altitudeMsl: mavlinkSession.state.altitudeMsl ?? 0,
        fixQuality: Number(mavlinkSession.state.gpsFix) >= 6 ? 4 : Number(mavlinkSession.state.gpsFix) === 5 ? 5 : 1,
        satellites: mavlinkSession.state.satellites ?? 0,
      };
    }
    if (Number(FC.GPS_DATA?.fix) >= 2) {
      return {
        latitude: FC.GPS_DATA.lat / 1e7,
        longitude: FC.GPS_DATA.lon / 1e7,
        altitudeMsl: Number(FC.GPS_DATA.alt ?? 0),
        fixQuality: Number(FC.GPS_DATA.fix) >= 4 ? 4 : Number(FC.GPS_DATA.fix) === 3 ? 5 : 1,
        satellites: FC.GPS_DATA.numSat ?? 0,
      };
    }
    return null;
  }

  mountpointReferencePosition() {
    if (this.state.connected && this.state.receiverPosition?.fixOk) {
      return this.state.receiverPosition;
    }
    return this.aircraftPosition();
  }

  ntripGgaPosition() {
    const source = this.state.ntrip.ggaSource;
    if (source === "none") return null;
    if (source === "manual") {
      return {
        latitude: Number(this.ntripSettings?.ggaLatitude),
        longitude: Number(this.ntripSettings?.ggaLongitude),
        altitudeMsl: Number(this.ntripSettings?.ggaAltitudeMsl ?? 0),
        fixQuality: 1,
        satellites: 12,
      };
    }
    if (source === "usb-base") {
      const position = this.state.receiverPosition;
      if (!position?.fixOk) throw new Error("The USB receiver does not have a valid position for NTRIP GGA.");
      return {
        ...position,
        geoidSeparation: position.ellipsoidHeightM - position.altitudeMsl,
        fixQuality: position.carrierSolution === 2 ? 4 : position.carrierSolution === 1 ? 5 : 1,
      };
    }
    const aircraftPosition = this.aircraftPosition();
    if (aircraftPosition) return aircraftPosition;
    throw new Error("The aircraft does not have a valid position for NTRIP GGA.");
  }

  async sendNtripGga() {
    if (!this.state.ntrip.connected || this.state.ntrip.ggaSource === "none") return false;
    try {
      const position = this.ntripGgaPosition();
      const result = await this.bridge.ntripSendGga(buildNmeaGga(position));
      if (result?.error) throw new Error(result.msg || "NTRIP GGA write failed.");
      this.state.ntrip.lastGgaError = null;
      this.notify();
      return true;
    } catch (error) {
      this.state.ntrip.lastGgaError = error?.message || String(error);
      this.notify();
      throw error;
    }
  }

  handleNtripFrame(frame) {
    this.state.ntrip.frames += 1;
    if (this.state.correctionSource !== "ntrip") {
      this.notify();
      return;
    }
    if (this.state.ntrip.destination === "usb-base") {
      if (this.state.ntrip.usbRoutingArmed) this.queueNtripToBase(frame);
    } else {
      this.handleActiveCorrectionFrame(frame, {
        messageType: (frame[3] << 4) | (frame[4] >> 4),
      });
    }
    this.notify();
  }

  queueNtripToBase(frame) {
    try {
      this.assertNtripUsbDestinationReady();
    } catch (error) {
      this.state.ntrip.injectionDrops += 1;
      this.state.ntrip.lastError = error.message;
      return false;
    }
    if (this.baseInjectionQueue.length >= 8) {
      this.state.ntrip.injectionDrops += 1;
      this.state.ntrip.lastError = "USB receiver correction queue is full.";
      return false;
    }
    this.baseInjectionQueue.push(frame.slice());
    this.pumpBaseInjection();
    return true;
  }

  assertNtripUsbDestinationReady() {
    if (!this.state.connected || this.state.profile !== "ublox-f9") {
      throw new Error("Connect a u-blox F9 USB receiver before routing NTRIP into it.");
    }
    if (this.state.lastConfiguration?.mode !== "ntrip-positioning") {
      throw new Error(
        "Prepare the USB F9 for NTRIP positioning before sending caster corrections to it.",
      );
    }
    if (!this.state.ntrip.usbRoutingArmed) {
      throw new Error("NTRIP-to-USB routing is not armed for this refinement session.");
    }
    return true;
  }

  async pumpBaseInjection() {
    if (this.baseInjectionBusy) return;
    this.baseInjectionBusy = true;
    const generation = this.baseInjectionGeneration;
    while (this.baseInjectionQueue.length && generation === this.baseInjectionGeneration) {
      const frame = this.baseInjectionQueue.shift();
      try {
        await this.sendToBase(frame);
        this.state.ntrip.injectedToBaseFrames += 1;
        this.state.ntrip.lastError = null;
      } catch (error) {
        this.state.ntrip.injectionDrops += 1;
        this.state.ntrip.lastError = error.message;
      }
      this.notify();
    }
    if (generation !== this.baseInjectionGeneration) this.baseInjectionQueue.length = 0;
    this.baseInjectionBusy = false;
  }

  captureFixedPosition() {
    const position = this.state.refinement.meanPosition;
    if (!position?.ready) {
      throw new Error(
        `Wait for ${RTK_REFINEMENT_MIN_FIXED_SAMPLES} consecutive RTK Fixed samples before finalizing the base position.`,
      );
    }
    return Object.freeze({
      latitude: position.latitude,
      longitude: position.longitude,
      ellipsoidHeightM: position.ellipsoidHeightM,
      fixedPositionAccuracyM: position.fixedPositionAccuracyM,
      samples: position.samples,
      stabilityM: position.stabilityM,
    });
  }
}

export const rtkBaseStation = new RtkBaseStationService();
export { RtkBaseStationService };
export default rtkBaseStation;
