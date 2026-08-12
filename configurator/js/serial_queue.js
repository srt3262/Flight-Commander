'use strict';

import CONFIGURATOR from './data_storage';
import MSPCodes from './msp/MSPCodes';
import SimpleSmoothFilter from './simple_smooth_filter';
import eventFrequencyAnalyzer from './eventFrequencyAnalyzer';
import mspDeduplicationQueue from './msp/mspDeduplicationQueue';
import { insertMspRequestByPriority } from './msp/mspPriorityQueue';

var mspQueue = function () {

    var publicScope = {},
        privateScope = {};

    privateScope.handlerFrequency = 100;
    privateScope.balancerFrequency = 20;

    privateScope.loadFilter = new SimpleSmoothFilter(1, 0.85);
    privateScope.roundtripFilter = new SimpleSmoothFilter(20, 0.95);
    privateScope.hardwareRoundtripFilter = new SimpleSmoothFilter(10, 0.95);

    /**
     * Target load for MSP queue. When load is above target, throttling might start to appear
     * @type {number}
     */
    privateScope.targetLoad = 2;
    privateScope.statusDropFactor = 0.75;

    privateScope.currentLoad = 0;

    privateScope.removeCallback = null;
    privateScope.putCallback = null;

    privateScope.queue = [];

    privateScope.softLock = false;
    privateScope.hardLock = false;

    privateScope.lockMethod = 'soft';

    privateScope.queueLocked = false;

    publicScope.setremoveCallback = function(cb) {
        privateScope.removeCallback = cb;
    }

    publicScope.setPutCallback = function(cb) {
        privateScope.putCallback = cb;
    }

    /**
     * Method locks queue
     * All future put requests will be rejected
     */
    publicScope.lock = function () {
        privateScope.queueLocked = true;
    };

    /**
     * Method unlocks queue making it possible to put new requests in it
     */
    publicScope.unlock = function () {
        privateScope.queueLocked = false;
    };

    publicScope.setLockMethod = function (method) {
        privateScope.lockMethod = method;
    };

    publicScope.getLockMethod = function () {   
        return privateScope.lockMethod;
    };

    publicScope.setSoftLock = function () {
        privateScope.softLock = new Date().getTime();
    };

    publicScope.setHardLock = function () {
        privateScope.hardLock = new Date().getTime();
    };

    publicScope.freeSoftLock = function () {
        privateScope.softLock = false;
    };

    publicScope.freeHardLock = function () {
        privateScope.hardLock = false;
    };

    publicScope.isLocked = function () {

        if (privateScope.lockMethod === 'soft') {
            return privateScope.softLock !== false;
        } else {
            return privateScope.hardLock !== false;
        }

    };

    privateScope.getTimeout = function (code) {
        if (code == MSPCodes.MSP_SET_REBOOT || code == MSPCodes.MSP_EEPROM_WRITE) {
            return 5000;
        } else {
            return CONFIGURATOR.connection.getTimeout();
        }
    };

    privateScope.getRequestTimeout = function (request) {
        return Number.isFinite(request?.timeoutMs) && request.timeoutMs > 0
            ? request.timeoutMs
            : privateScope.getTimeout(request.code);
    };

    privateScope.failRequestAttempt = function (request, transportGeneration) {
        if (
            request.transportGeneration !== transportGeneration
            || request.transportAttemptFinished === true
        ) {
            return false;
        }
        request.transportAttemptFinished = true;
        clearTimeout(request.timer);
        mspDeduplicationQueue.remove(request.code);
        privateScope.removeCallback(request.code);
        publicScope.freeSoftLock();
        publicScope.freeHardLock();

        if (request.retryCounter > 0) {
            request.retryCounter--;
            publicScope.put(request);
        } else if (request.onFinish) {
            request.onFinish(false);
        }
        return true;
    };

    /**
     * This method is periodically executed and moves MSP request
     * from a queue to serial port. This allows to throttle requests,
     * adjust rate of new frames being sent and prohibit situation in which
     * serial port is saturated, virtually overloaded, with outgoing data
     *
     * This also implements serial port sharing problem: only 1 frame can be transmitted
     * at once
     *
     * MSP class no longer implements blocking, it is queue responsibility
     */
    publicScope.executor = function () {

        /*
         * Debug
         */
        eventFrequencyAnalyzer.put("execute");

        privateScope.loadFilter.apply(privateScope.queue.length);

        /*
         * if port is blocked or there is no connection, do not process the queue
         */
        if (publicScope.isLocked() || CONFIGURATOR.connection === false) {
            eventFrequencyAnalyzer.put("port in use");
            return false;
        }

        var request = privateScope.get();

        if (request !== undefined) {

            request.transportGeneration = (request.transportGeneration ?? 0) + 1;
            request.transportAttemptFinished = false;
            const transportGeneration = request.transportGeneration;

            /*
             * Lock serial port as being in use right now
             */
            publicScope.setSoftLock();
            publicScope.setHardLock();

            request.timer = setTimeout(function () {
                console.log('MSP data request timed-out: ' + request.code);
                const transportHandle = request.transportHandle;
                if (privateScope.failRequestAttempt(request, transportGeneration)) {
                    transportHandle?.cancel?.();
                }
            }, privateScope.getRequestTimeout(request));

            if (request.sentOn === null) {
                request.sentOn = new Date().getTime();
            }

            /*
             * Set receive callback here
             */
            privateScope.putCallback(request);

            eventFrequencyAnalyzer.put('message sent');

            /*
             * Send data to serial port
             */
            request.transportHandle = CONFIGURATOR.connection.send(request.messageBody, function (sendInfo) {
                if (sendInfo.bytesSent == request.messageBody.byteLength) {
                    /*
                     * message has been sent, check callbacks and free resource
                     */
                    if (request.onSend) {
                        request.onSend();
                    }
                    publicScope.freeSoftLock();
                } else {
                    privateScope.failRequestAttempt(request, transportGeneration);
                }
            }, {
                priority: request.transportPriority,
                replaceKey: request.replaceKey,
            });
        }
    };

    privateScope.get = function () {
        return privateScope.queue.shift();
    };

    publicScope.flush = function () {
        privateScope.queue = [];
    };

    /**
     * Method puts new request into queue
     * @param {MspMessageClass} mspRequest
     * @returns {boolean} true on success, false when queue is locked
     */
    publicScope.put = function (mspRequest) {

        const isMessageInQueue = mspDeduplicationQueue.check(mspRequest.code);

        if (isMessageInQueue) {
            eventFrequencyAnalyzer.put('MSP Duplicate ' + mspRequest.code);
            return false;
        }

        if (privateScope.queueLocked === true) {
            return false;
        }

        mspDeduplicationQueue.put(mspRequest.code);
        // Preserve FIFO order within the priority lane while placing
        // time-sensitive RTCM fragments ahead of ordinary telemetry polls.
        insertMspRequestByPriority(privateScope.queue, mspRequest);
        return true;
    };

    publicScope.getLength = function () {
        return privateScope.queue.length;
    };

    /**
     * 1s MSP load computed as number of messages in a queue in given period
     * @returns {number}
     */
    publicScope.getLoad = function () {
        return privateScope.loadFilter.get();
    };

    publicScope.getRoundtrip = function () {
        return privateScope.roundtripFilter.get();
    };

    /**
     *
     * @param {number} number
     */
    publicScope.putRoundtrip = function (number) {
        privateScope.roundtripFilter.apply(number);
    };

    publicScope.getHardwareRoundtrip = function () {
        return privateScope.hardwareRoundtripFilter.get();
    };

    /**
     *
     * @param {number} number
     */
    publicScope.putHardwareRoundtrip = function (number) {
        privateScope.hardwareRoundtripFilter.apply(number);
    };

    publicScope.balancer = function () {
        privateScope.currentLoad = privateScope.loadFilter.get();

        /*
         * Also, check if port lock if hanging. Free is so
         */
        var currentTimestamp = new Date().getTime(),
            threshold = publicScope.getHardwareRoundtrip() * 3;

        if (threshold > 5000) {
            threshold = 5000;
        }
        if (threshold < 1000) {
            threshold = 1000;
        }

        if (privateScope.softLock !== false && currentTimestamp - privateScope.softLock > threshold) {
            publicScope.freeSoftLock();
            eventFrequencyAnalyzer.put('force free soft lock');
        }
        if (privateScope.hardLock !== false && currentTimestamp - privateScope.hardLock > threshold) {
            console.log('Force free hard lock');
            publicScope.freeHardLock();
            eventFrequencyAnalyzer.put('force free hard lock');
        }

    };

    /**
     * This method return periodic for polling interval that should populate queue in 80% or less
     * @param {number} requestedInterval
     * @param {number} messagesInInterval
     * @returns {number}
     */
    publicScope.getIntervalPrediction = function (requestedInterval, messagesInInterval) {
        var requestedRate = (1000 / requestedInterval) * messagesInInterval,
            availableRate = (1000 / publicScope.getRoundtrip()) * 0.8;

        if (requestedRate < availableRate) {
            return requestedInterval;
        } else {
            return (1000 / availableRate) * messagesInInterval;
        }
    };

    publicScope.getQueue = function () {
        return privateScope.queue;
    };

    setInterval(publicScope.executor, Math.round(1000 / privateScope.handlerFrequency));
    setInterval(publicScope.balancer, Math.round(1000 / privateScope.balancerFrequency));

    return publicScope;
}();

export default mspQueue;
