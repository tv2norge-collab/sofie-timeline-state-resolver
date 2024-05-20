"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HyperdeckDevice = void 0;
const _ = require("underscore");
const device_1 = require("../../devices/device");
const timeline_state_resolver_types_1 = require("timeline-state-resolver-types");
const hyperdeck_connection_1 = require("hyperdeck-connection");
const doOnTime_1 = require("../../devices/doOnTime");
const lib_1 = require("../../lib");
const timeline_state_resolver_types_2 = require("timeline-state-resolver-types");
const DEFAULT_SPEED = 100; // 1x speed
const DEFAULT_LOOP = false;
const DEFAULT_SINGLE_CLIP = true;
const DEFAULT_CLIP_ID = null;
/**
 * This is a wrapper for the Hyperdeck Device. Commands to any and all hyperdeck devices will be sent through here.
 */
class HyperdeckDevice extends device_1.DeviceWithState {
    constructor(deviceId, deviceOptions, getCurrentTime) {
        super(deviceId, deviceOptions, getCurrentTime);
        this._initialized = false;
        this._connected = false;
        this._slots = 0;
        this._slotStatus = {};
        if (deviceOptions.options) {
            if (deviceOptions.commandReceiver)
                this._commandReceiver = deviceOptions.commandReceiver;
            else
                this._commandReceiver = this._defaultCommandReceiver.bind(this);
        }
        this._doOnTime = new doOnTime_1.DoOnTime(() => {
            return this.getCurrentTime();
        }, doOnTime_1.SendMode.BURST, this._deviceOptions);
        this.handleDoOnTime(this._doOnTime, 'Hyperdeck');
    }
    /**
     * Initiates the connection with the Hyperdeck through the hyperdeck-connection lib.
     */
    async init(initOptions) {
        return new Promise((resolve /*, reject*/) => {
            let firstConnect = true;
            this._hyperdeck = new hyperdeck_connection_1.Hyperdeck({ pingPeriod: 1000 });
            this._hyperdeck.connect(initOptions.host, initOptions.port);
            this._hyperdeck.on('connected', () => {
                (0, lib_1.deferAsync)(async () => {
                    await this._hyperdeck.sendCommand(new hyperdeck_connection_1.Commands.RemoteCommand(true));
                    this._queryCurrentState()
                        .then(async (state) => {
                        this.setState(state, this.getCurrentTime());
                        if (firstConnect) {
                            firstConnect = false;
                            this._initialized = true;
                            this._slots = await this._querySlotNumber();
                            resolve(true);
                        }
                        this._connected = true;
                        this._connectionChanged();
                        this.emit('resetResolver');
                    })
                        .catch((e) => this.emit('error', 'Hyperdeck.on("connected")', e));
                    if (initOptions.minRecordingTime) {
                        this._minRecordingTime = initOptions.minRecordingTime;
                        if (this._recTimePollTimer)
                            clearTimeout(this._recTimePollTimer);
                    }
                    this._queryRecordingTime().catch((e) => this.emit('error', 'HyperDeck.queryRecordingTime', e));
                    this._suppressEmptySlotWarnings = !!initOptions.suppressEmptySlotWarnings;
                    const notifyCmd = new hyperdeck_connection_1.Commands.NotifySetCommand();
                    notifyCmd.slot = true;
                    notifyCmd.transport = true;
                    this._hyperdeck.sendCommand(notifyCmd).catch((e) => this.emit('error', 'HyperDeck.on("connected")', e));
                    const tsCmd = new hyperdeck_connection_1.Commands.TransportInfoCommand();
                    this._hyperdeck
                        .sendCommand(tsCmd)
                        .then((r) => (this._transportStatus = r.status))
                        .catch((e) => this.emit('error', 'HyperDeck.on("connected")', e));
                }, (e) => {
                    this.emit('error', 'Failed to send command', e);
                });
            });
            this._hyperdeck.on('disconnected', () => {
                this._connected = false;
                this._connectionChanged();
            });
            this._hyperdeck.on('error', (e) => this.emit('error', 'Hyperdeck', e));
            this._hyperdeck.on('notify.slot', (res) => {
                (0, lib_1.deferAsync)(async () => {
                    await this._queryRecordingTime().catch((e) => this.emit('error', 'HyperDeck.queryRecordingTime', e));
                    if (res.status)
                        this._connectionChanged();
                }, (e) => {
                    this.emit('error', 'Failed to send command', e);
                });
            });
            this._hyperdeck.on('notify.transport', (res) => {
                if (res.status) {
                    this._transportStatus = res.status;
                    const state = this.getState();
                    if (state && state.state.transport.status !== res.status) {
                        this._connectionChanged();
                    }
                }
            });
        });
    }
    /**
     * Makes this device ready for garbage collection.
     */
    async terminate() {
        this._doOnTime.dispose();
        if (this._recTimePollTimer)
            clearTimeout(this._recTimePollTimer);
        await this._hyperdeck.disconnect();
        this._hyperdeck.removeAllListeners();
        return true;
    }
    async resync() {
        const time = this.getCurrentTime();
        this._doOnTime.clearQueueNowAndAfter(time);
        // TODO - could this being slow/offline be a problem?
        const state = await this._queryCurrentState();
        this.setState(state, time);
        this.emit('resetResolver');
        return {
            result: timeline_state_resolver_types_2.ActionExecutionResultCode.Ok,
        };
    }
    /**
     * Prepares device for playout
     */
    async makeReady(okToDestroyStuff) {
        if (okToDestroyStuff) {
            await this.resync();
        }
    }
    /**
     * Sends commands to the HyperDeck to format disks. Afterwards,
     * calls this._queryRecordingTime
     */
    async formatDisks() {
        const wait = async (t) => new Promise((resolve) => setTimeout(() => resolve(), t));
        for (let i = 1; i <= this._slots; i++) {
            // select slot
            const slotSel = new hyperdeck_connection_1.Commands.SlotSelectCommand();
            slotSel.slotId = i + '';
            try {
                await this._hyperdeck.sendCommand(slotSel);
            }
            catch (e) {
                continue;
            }
            // get code:
            const prepare = new hyperdeck_connection_1.Commands.FormatCommand();
            prepare.filesystem = hyperdeck_connection_1.FilesystemFormat.exFAT;
            const res = await this._hyperdeck.sendCommand(prepare);
            const format = new hyperdeck_connection_1.Commands.FormatConfirmCommand();
            format.code = res.code;
            await this._hyperdeck.sendCommand(format);
            // now actualy await until finished:
            const slotInfo = new hyperdeck_connection_1.Commands.SlotInfoCommand(i);
            while ((await this._hyperdeck.sendCommand(slotInfo)).status === hyperdeck_connection_1.SlotStatus.EMPTY) {
                await wait(500);
            }
        }
        await this._queryRecordingTime();
    }
    async executeAction(actionId, _payload) {
        switch (actionId) {
            case timeline_state_resolver_types_1.HyperdeckActions.FormatDisks:
                try {
                    await this.formatDisks();
                    return { result: timeline_state_resolver_types_2.ActionExecutionResultCode.Ok };
                }
                catch {
                    return { result: timeline_state_resolver_types_2.ActionExecutionResultCode.Error };
                }
            case timeline_state_resolver_types_1.HyperdeckActions.Resync:
                return this.resync();
            default:
                return { result: timeline_state_resolver_types_2.ActionExecutionResultCode.Ok, response: (0, lib_1.t)('Action "{{id}}" not found', { actionId }) };
        }
    }
    /** Called by the Conductor a bit before a .handleState is called */
    prepareForHandleState(newStateTime) {
        // clear any queued commands later than this time:
        this._doOnTime.clearQueueNowAndAfter(newStateTime);
        this.cleanUpStates(0, newStateTime);
    }
    /**
     * Saves and handles state at specified point in time such that the device will be in
     * that state at that time.
     * @param newState
     */
    handleState(newState, newMappings) {
        super.onHandleState(newState, newMappings);
        if (!this._initialized) {
            // before it's initialized don't do anything
            this.emit('info', 'Hyperdeck not initialized yet');
            return;
        }
        // Create device states
        const previousStateTime = Math.max(this.getCurrentTime(), newState.time);
        const oldState = (this.getStateBefore(previousStateTime) || { state: this._getDefaultState() }).state;
        const convertTrace = (0, lib_1.startTrace)(`device:convertState`, { deviceId: this.deviceId });
        const oldHyperdeckState = oldState;
        const newHyperdeckState = this.convertStateToHyperdeck(newState, newMappings);
        this.emit('timeTrace', (0, lib_1.endTrace)(convertTrace));
        // Generate commands to transition to new state
        const diffTrace = (0, lib_1.startTrace)(`device:diffState`, { deviceId: this.deviceId });
        const commandsToAchieveState = this._diffStates(oldHyperdeckState, newHyperdeckState);
        this.emit('timeTrace', (0, lib_1.endTrace)(diffTrace));
        // clear any queued commands later than this time:
        this._doOnTime.clearQueueNowAndAfter(previousStateTime);
        // add the new commands to the queue:
        this._addToQueue(commandsToAchieveState, newState.time);
        // store the new state, for later use:
        this.setState(newHyperdeckState, newState.time);
    }
    /**
     * Clears any scheduled commands after this time
     * @param clearAfterTime
     */
    clearFuture(clearAfterTime) {
        this._doOnTime.clearQueueAfter(clearAfterTime);
    }
    get canConnect() {
        return true;
    }
    get connected() {
        return this._connected;
    }
    /**
     * Converts a timeline state to a device state.
     * @param state
     */
    convertStateToHyperdeck(state, mappings) {
        if (!this._initialized)
            throw Error('convertStateToHyperdeck cannot be used before inititialized');
        // Convert the timeline state into something we can use easier:
        const deviceState = this._getDefaultState();
        const sortedLayers = _.map(state.layers, (tlObject, layerName) => ({ layerName, tlObject })).sort((a, b) => a.layerName.localeCompare(b.layerName));
        _.each(sortedLayers, ({ tlObject, layerName }) => {
            const content = tlObject.content;
            const mapping = mappings[layerName];
            if (mapping && mapping.deviceId === this.deviceId && content.deviceType === timeline_state_resolver_types_1.DeviceType.HYPERDECK) {
                switch (mapping.options.mappingType) {
                    case timeline_state_resolver_types_1.MappingHyperdeckType.Transport:
                        if (content.type === timeline_state_resolver_types_1.TimelineContentTypeHyperdeck.TRANSPORT) {
                            if (!deviceState.transport) {
                                switch (content.status) {
                                    case hyperdeck_connection_1.TransportStatus.PREVIEW:
                                    case hyperdeck_connection_1.TransportStatus.STOPPED:
                                    case hyperdeck_connection_1.TransportStatus.FORWARD:
                                    case hyperdeck_connection_1.TransportStatus.REWIND:
                                    case hyperdeck_connection_1.TransportStatus.JOG:
                                    case hyperdeck_connection_1.TransportStatus.SHUTTLE:
                                        deviceState.transport = {
                                            status: content.status,
                                            speed: DEFAULT_SPEED,
                                            loop: DEFAULT_LOOP,
                                            singleClip: DEFAULT_SINGLE_CLIP,
                                            clipId: DEFAULT_CLIP_ID,
                                        };
                                        break;
                                    case hyperdeck_connection_1.TransportStatus.PLAY:
                                        deviceState.transport = {
                                            status: content.status,
                                            speed: content.speed ?? DEFAULT_SPEED,
                                            loop: content.loop ?? DEFAULT_LOOP,
                                            singleClip: content.singleClip ?? DEFAULT_SINGLE_CLIP,
                                            clipId: content.clipId,
                                        };
                                        break;
                                    case hyperdeck_connection_1.TransportStatus.RECORD:
                                        deviceState.transport = {
                                            status: content.status,
                                            speed: DEFAULT_SPEED,
                                            loop: DEFAULT_LOOP,
                                            singleClip: DEFAULT_SINGLE_CLIP,
                                            clipId: DEFAULT_CLIP_ID,
                                            recordFilename: content.recordFilename,
                                        };
                                        break;
                                    default:
                                        // @ts-ignore never
                                        throw new Error(`Unsupported status "${content.status}"`);
                                }
                            }
                            deviceState.transport.status = content.status;
                            if (content.status === hyperdeck_connection_1.TransportStatus.RECORD) {
                                deviceState.transport.recordFilename = content.recordFilename;
                            }
                            else if (content.status === hyperdeck_connection_1.TransportStatus.PLAY) {
                                deviceState.transport.speed = content.speed ?? DEFAULT_SPEED;
                                deviceState.transport.loop = content.loop ?? DEFAULT_LOOP;
                                deviceState.transport.singleClip = content.singleClip ?? DEFAULT_SINGLE_CLIP;
                                deviceState.transport.clipId = content.clipId;
                            }
                        }
                        break;
                }
            }
        });
        return deviceState;
    }
    get deviceType() {
        return timeline_state_resolver_types_1.DeviceType.HYPERDECK;
    }
    get deviceName() {
        return 'Hyperdeck ' + this.deviceId;
    }
    get queue() {
        return this._doOnTime.getQueue();
    }
    getStatus() {
        let statusCode = device_1.StatusCode.GOOD;
        const messages = [];
        if (!this._connected) {
            statusCode = device_1.StatusCode.BAD;
            messages.push('Not connected');
        }
        if (this._connected) {
            // check recording time left
            if (this._minRecordingTime && this._recordingTime < this._minRecordingTime) {
                if (this._recordingTime === 0) {
                    statusCode = device_1.StatusCode.BAD;
                }
                else {
                    statusCode = device_1.StatusCode.WARNING_MAJOR;
                }
                messages.push(`Recording time left is less than ${Math.floor(this._recordingTime / 60)} minutes and ${this._recordingTime % 60} seconds`);
            }
            // check for available slots
            let noAvailableSlots = true;
            for (let slot = 1; slot <= this._slots; slot++) {
                if (this._slotStatus[slot] &&
                    this._slotStatus[slot].status !== hyperdeck_connection_1.SlotStatus.MOUNTED &&
                    !this._suppressEmptySlotWarnings) {
                    messages.push(`Slot ${slot} is not mounted`);
                    if (statusCode < device_1.StatusCode.WARNING_MINOR)
                        statusCode = device_1.StatusCode.WARNING_MINOR;
                }
                else {
                    noAvailableSlots = false;
                }
            }
            if (noAvailableSlots) {
                statusCode = device_1.StatusCode.BAD;
            }
            // check if transport status is correct
            const state = this.getState();
            if (state) {
                const supposedState = state.state.transport.status;
                if (supposedState === hyperdeck_connection_1.TransportStatus.RECORD && this._transportStatus !== supposedState) {
                    if (statusCode < device_1.StatusCode.WARNING_MAJOR)
                        statusCode = device_1.StatusCode.WARNING_MAJOR;
                    messages.push('Hyperdeck not recording');
                }
                if (supposedState === hyperdeck_connection_1.TransportStatus.PLAY && this._transportStatus !== supposedState) {
                    if (statusCode < device_1.StatusCode.WARNING_MAJOR)
                        statusCode = device_1.StatusCode.WARNING_MAJOR;
                    messages.push('Hyperdeck not playing');
                }
            }
        }
        if (!this._initialized) {
            statusCode = device_1.StatusCode.BAD;
            messages.push(`Hyperdeck device connection not initialized (restart required)`);
        }
        return {
            statusCode,
            messages,
            active: this.isActive,
        };
    }
    /**
     * Add commands to queue, to be executed at the right time
     */
    _addToQueue(commandsToAchieveState, time) {
        _.each(commandsToAchieveState, (cmd) => {
            // add the new commands to the queue:
            this._doOnTime.queue(time, undefined, async (cmd) => {
                return this._commandReceiver(time, cmd.command, cmd.context, cmd.timelineObjId);
            }, cmd);
        });
    }
    /**
     * Compares the new timeline-state with the old one, and generates commands to account for the difference
     * @param oldHyperdeckState The assumed current state
     * @param newHyperdeckState The desired state of the device
     */
    _diffStates(oldHyperdeckState, newHyperdeckState) {
        const commandsToAchieveState = [];
        if (oldHyperdeckState.notify && newHyperdeckState.notify) {
            const notifyCmd = new hyperdeck_connection_1.Commands.NotifySetCommand();
            let hasChange = null;
            const keys = _.unique(_.keys(oldHyperdeckState.notify).concat(_.keys(newHyperdeckState.notify)));
            for (const k of keys) {
                if (oldHyperdeckState.notify[k] !== newHyperdeckState.notify[k]) {
                    notifyCmd[k] = newHyperdeckState.notify[k];
                    hasChange = {
                        timelineObjId: newHyperdeckState.timelineObjId,
                    };
                }
            }
            if (hasChange) {
                commandsToAchieveState.push({
                    command: notifyCmd,
                    context: {
                        oldState: oldHyperdeckState.notify,
                        newState: newHyperdeckState.notify,
                    },
                    timelineObjId: hasChange.timelineObjId,
                });
            }
        }
        else {
            this.emit('error', 'Hyperdeck', new Error(`diffStates missing notify object: ${JSON.stringify(oldHyperdeckState.notify)}, ${JSON.stringify(newHyperdeckState.notify)}`));
        }
        if (oldHyperdeckState.transport && newHyperdeckState.transport) {
            switch (newHyperdeckState.transport.status) {
                case hyperdeck_connection_1.TransportStatus.RECORD: {
                    // TODO - sometimes we can loose track of the filename (eg on reconnect).
                    // should we split the record when recovering from that? (it might loose some frames)
                    const filenameChanged = oldHyperdeckState.transport.recordFilename !== undefined &&
                        oldHyperdeckState.transport.recordFilename !== newHyperdeckState.transport.recordFilename;
                    if (oldHyperdeckState.transport.status !== newHyperdeckState.transport.status) {
                        // Start recording
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.RecordCommand(newHyperdeckState.transport.recordFilename),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                    }
                    else if (filenameChanged) {
                        // Split recording
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.StopCommand(),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.RecordCommand(newHyperdeckState.transport.recordFilename),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                    } // else continue recording
                    break;
                }
                case hyperdeck_connection_1.TransportStatus.PLAY: {
                    if (oldHyperdeckState.transport.status !== newHyperdeckState.transport.status ||
                        oldHyperdeckState.transport.speed !== newHyperdeckState.transport.speed ||
                        oldHyperdeckState.transport.loop !== newHyperdeckState.transport.loop ||
                        oldHyperdeckState.transport.singleClip !== newHyperdeckState.transport.singleClip) {
                        // Start or modify playback
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.PlayCommand(newHyperdeckState.transport.speed + '', newHyperdeckState.transport.loop, newHyperdeckState.transport.singleClip),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                    } // else continue playing
                    if (oldHyperdeckState.transport.clipId !== newHyperdeckState.transport.clipId &&
                        newHyperdeckState.transport.clipId !== null) {
                        // Go to the new clip
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.GoToCommand(undefined, newHyperdeckState.transport.clipId),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                        /**
                         * If the last played clip naturally reached its end and singleClip was
                         * true or it was the last clip on the disk, the Hyperdeck will stop,
                         * but our state will still think that it is playing.
                         * This means that in order to reliably play the clip we just GoTo'd,
                         * we have to always send a Play command.
                         */
                        if (newHyperdeckState.transport.status === hyperdeck_connection_1.TransportStatus.PLAY) {
                            // Start or modify playback
                            commandsToAchieveState.push({
                                command: new hyperdeck_connection_1.Commands.PlayCommand(newHyperdeckState.transport.speed + '', newHyperdeckState.transport.loop, newHyperdeckState.transport.singleClip),
                                context: {
                                    oldState: oldHyperdeckState.transport,
                                    newState: newHyperdeckState.transport,
                                },
                                timelineObjId: newHyperdeckState.timelineObjId,
                            });
                        } // else continue playing
                    } // else continue playing
                    break;
                }
                case hyperdeck_connection_1.TransportStatus.PREVIEW: {
                    if (oldHyperdeckState.transport.status !== newHyperdeckState.transport.status) {
                        // Switch to preview mode
                        // A subsequent play or record command will automatically override this
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.PreviewCommand(true),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                    }
                    break;
                }
                case hyperdeck_connection_1.TransportStatus.STOPPED: {
                    if (oldHyperdeckState.transport.status !== newHyperdeckState.transport.status) {
                        // Stop playback/recording
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.StopCommand(),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                    }
                    break;
                }
                default:
                    // TODO - warn
                    // for now we are assuming they want a stop. that could be conditional later on
                    if (oldHyperdeckState.transport.status === hyperdeck_connection_1.TransportStatus.RECORD ||
                        oldHyperdeckState.transport.status === hyperdeck_connection_1.TransportStatus.PLAY) {
                        commandsToAchieveState.push({
                            command: new hyperdeck_connection_1.Commands.StopCommand(),
                            context: {
                                oldState: oldHyperdeckState.transport,
                                newState: newHyperdeckState.transport,
                            },
                            timelineObjId: newHyperdeckState.timelineObjId,
                        });
                    }
                    break;
            }
        }
        else {
            this.emit('error', 'Hyperdeck', new Error(`diffStates missing transport object: ${JSON.stringify(oldHyperdeckState.transport)}, ${JSON.stringify(newHyperdeckState.transport)}`));
        }
        return commandsToAchieveState;
    }
    /**
     * Gets the current state of the device
     */
    async _queryCurrentState() {
        if (!this._connected)
            return this._getDefaultState();
        const notify = this._hyperdeck.sendCommand(new hyperdeck_connection_1.Commands.NotifyGetCommand());
        const transport = this._hyperdeck.sendCommand(new hyperdeck_connection_1.Commands.TransportInfoCommand());
        const notifyRes = await notify;
        const transportRes = await transport;
        const res = {
            notify: notifyRes,
            transport: transportRes,
            timelineObjId: 'currentState',
        };
        return res;
    }
    /**
     * Queries the recording time left in seconds of the device and mutates
     * this._recordingTime
     */
    async _queryRecordingTime() {
        if (this._recTimePollTimer) {
            clearTimeout(this._recTimePollTimer);
        }
        let time = 0;
        for (let slot = 1; slot <= this._slots; slot++) {
            try {
                const res = await this._hyperdeck.sendCommand(new hyperdeck_connection_1.Commands.SlotInfoCommand(slot));
                this._slotStatus[slot] = res;
                if (res.status === 'mounted') {
                    time += res.recordingTime;
                }
            }
            catch (e) {
                // null
            }
        }
        if (time !== this._recordingTime) {
            this._recordingTime = time;
            this._connectionChanged();
        }
        let timeTillNextUpdate = 10;
        if (time > 10) {
            if (time - this._minRecordingTime > 10) {
                timeTillNextUpdate = (time - this._minRecordingTime) / 2;
            }
            else if (time - this._minRecordingTime < 0) {
                timeTillNextUpdate = time / 2;
            }
        }
        this._recTimePollTimer = setTimeout(() => {
            this._queryRecordingTime().catch((e) => this.emit('error', 'HyperDeck.queryRecordingTime', e));
        }, timeTillNextUpdate * 1000);
    }
    async _querySlotNumber() {
        const { slots } = await this._hyperdeck.sendCommand(new hyperdeck_connection_1.Commands.DeviceInfoCommand());
        // before protocol version 1.9 we do not get slot info, so we assume 2 slots.
        if (!slots)
            return 2;
        return slots;
    }
    /**
     * Gets the default state of the device
     */
    _getDefaultState() {
        const res = {
            notify: {
                // TODO - this notify block will want configuring per device or will the state lib always want it the same?
                remote: false,
                transport: false,
                slot: false,
                configuration: false,
                droppedFrames: false,
            },
            transport: {
                status: hyperdeck_connection_1.TransportStatus.STOPPED,
                speed: DEFAULT_SPEED,
                loop: DEFAULT_LOOP,
                singleClip: DEFAULT_SINGLE_CLIP,
                clipId: DEFAULT_CLIP_ID,
            },
            timelineObjId: '',
        };
        return res;
    }
    async _defaultCommandReceiver(_time, command, context, timelineObjId) {
        const cwc = {
            context: context,
            timelineObjId: timelineObjId,
            command: command,
        };
        this.emitDebug(cwc);
        return this._hyperdeck.sendCommand(command).catch((error) => {
            this.emit('commandError', error, cwc);
        });
    }
    _connectionChanged() {
        this.emit('connectionChanged', this.getStatus());
    }
}
exports.HyperdeckDevice = HyperdeckDevice;
//# sourceMappingURL=index.js.map