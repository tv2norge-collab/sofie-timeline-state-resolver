"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VizMSEDevice = void 0;
const _ = require("underscore");
const device_1 = require("./../../devices/device");
const timeline_state_resolver_types_1 = require("timeline-state-resolver-types");
const v_connection_1 = require("@tv2media/v-connection");
const doOnTime_1 = require("../../devices/doOnTime");
const lib_1 = require("../../lib");
const msehttp_1 = require("@tv2media/v-connection/dist/msehttp");
const vizMSEManager_1 = require("./vizMSEManager");
const types_1 = require("./types");
/** The ideal time to prepare elements before going on air */
const IDEAL_PREPARE_TIME = 1000;
/** Minimum time to wait after preparing elements */
const PREPARE_TIME_WAIT = 50;
/**
 * This class is used to interface with a vizRT Media Sequence Editor, through the v-connection library.
 * It features playing both "internal" graphics element and vizPilot elements.
 */
class VizMSEDevice extends device_1.DeviceWithState {
    constructor(deviceId, deviceOptions, getCurrentTime) {
        super(deviceId, deviceOptions, getCurrentTime);
        this._vizMSEConnected = false;
        if (deviceOptions.options) {
            if (deviceOptions.commandReceiver)
                this._commandReceiver = deviceOptions.commandReceiver;
            else
                this._commandReceiver = this._defaultCommandReceiver.bind(this);
        }
        this._doOnTime = new doOnTime_1.DoOnTime(() => {
            return this.getCurrentTime();
        }, doOnTime_1.SendMode.IN_ORDER, this._deviceOptions);
        this.handleDoOnTime(this._doOnTime, 'VizMSE');
        this._doOnTimeBurst = new doOnTime_1.DoOnTime(() => {
            return this.getCurrentTime();
        }, doOnTime_1.SendMode.BURST, this._deviceOptions);
        this.handleDoOnTime(this._doOnTimeBurst, 'VizMSE.burst');
    }
    async init(initOptions, activeRundownPlaylistId) {
        this._initOptions = initOptions;
        if (!this._initOptions.host)
            throw new Error('VizMSE bad option: host');
        if (!this._initOptions.profile)
            throw new Error('VizMSE bad option: profile');
        this._vizMSE = (0, v_connection_1.createMSE)(this._initOptions.host, this._initOptions.restPort, this._initOptions.wsPort);
        this._vizmseManager = new vizMSEManager_1.VizMSEManager(this, this._vizMSE, this._initOptions.preloadAllElements ?? false, this._initOptions.onlyPreloadActivePlaylist ?? false, this._initOptions.purgeUnknownElements ?? false, this._initOptions.autoLoadInternalElements ?? false, this._initOptions.engineRestPort, this._initOptions.showDirectoryPath ?? '', initOptions.profile, initOptions.playlistID);
        this._vizmseManager.on('connectionChanged', (connected) => this.connectionChanged(connected));
        this._vizmseManager.on('updateMediaObject', (docId, doc) => this.emit('updateMediaObject', this.deviceId, docId, doc));
        this._vizmseManager.on('clearMediaObjects', () => this.emit('clearMediaObjects', this.deviceId));
        this._vizmseManager.on('info', (str) => this.emit('info', 'VizMSE: ' + str));
        this._vizmseManager.on('warning', (str) => this.emit('warning', 'VizMSE: ' + str));
        this._vizmseManager.on('error', (e) => this.emit('error', 'VizMSE', typeof e === 'string' ? new Error(e) : e));
        this._vizmseManager.on('debug', (...args) => this.emitDebug(...args));
        await this._vizmseManager.initializeRundown(activeRundownPlaylistId);
        return true;
    }
    /**
     * Terminates the device safely such that things can be garbage collected.
     */
    async terminate() {
        if (this._vizmseManager) {
            await this._vizmseManager.terminate();
            this._vizmseManager.removeAllListeners();
            delete this._vizmseManager;
        }
        this._doOnTime.dispose();
        return true;
    }
    /** Called by the Conductor a bit before a .handleState is called */
    prepareForHandleState(newStateTime) {
        // clear any queued commands later than this time:
        this._doOnTime.clearQueueNowAndAfter(newStateTime);
        this.cleanUpStates(0, newStateTime);
    }
    /**
     * Generates an array of VizMSE commands by comparing the newState against the oldState, or the current device state.
     */
    handleState(newState, newMappings) {
        super.onHandleState(newState, newMappings);
        // check if initialized:
        if (!this._vizmseManager || !this._vizmseManager.initialized) {
            this.emit('warning', 'VizMSE.v-connection not initialized yet');
            return;
        }
        const previousStateTime = Math.max(this.getCurrentTime(), newState.time);
        const oldVizMSEState = (this.getStateBefore(previousStateTime) || { state: { time: 0, layer: {} } })
            .state;
        const convertTrace = (0, lib_1.startTrace)(`device:convertState`, { deviceId: this.deviceId });
        const newVizMSEState = this.convertStateToVizMSE(newState, newMappings);
        this.emit('timeTrace', (0, lib_1.endTrace)(convertTrace));
        const diffTrace = (0, lib_1.startTrace)(`device:diffState`, { deviceId: this.deviceId });
        const commandsToAchieveState = this._diffStates(oldVizMSEState, newVizMSEState, newState.time);
        this.emit('timeTrace', (0, lib_1.endTrace)(diffTrace));
        // clear any queued commands later than this time:
        this._doOnTime.clearQueueNowAndAfter(previousStateTime);
        // add the new commands to the queue
        this._addToQueue(commandsToAchieveState);
        // store the new state, for later use:
        this.setState(newVizMSEState, newState.time);
    }
    /**
     * Clear any scheduled commands after this time
     * @param clearAfterTime
     */
    clearFuture(clearAfterTime) {
        this._doOnTime.clearQueueAfter(clearAfterTime);
    }
    get canConnect() {
        return true;
    }
    get connected() {
        return this._vizMSEConnected;
    }
    async activate(payload) {
        if (!payload || !payload.activeRundownPlaylistId) {
            return {
                result: timeline_state_resolver_types_1.ActionExecutionResultCode.Error,
                response: (0, lib_1.t)('Invalid payload'),
            };
        }
        if (!this._vizmseManager) {
            return {
                result: timeline_state_resolver_types_1.ActionExecutionResultCode.Error,
                response: (0, lib_1.t)('Unable to activate vizMSE, not initialized yet'),
            };
        }
        const activeRundownPlaylistId = payload.activeRundownPlaylist;
        const previousPlaylistId = this._vizmseManager?.activeRundownPlaylistId;
        await this._vizmseManager.activate(activeRundownPlaylistId);
        if (!payload.clearAll) {
            return {
                result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok,
            };
        }
        this.clearStates();
        if (this._initOptions && activeRundownPlaylistId !== previousPlaylistId) {
            if (this._initOptions.clearAllCommands && this._initOptions.clearAllCommands.length) {
                await this._vizmseManager.clearEngines({
                    type: types_1.VizMSECommandType.CLEAR_ALL_ENGINES,
                    time: this.getCurrentTime(),
                    timelineObjId: 'makeReady',
                    channels: 'all',
                    commands: this._initOptions.clearAllCommands,
                });
            }
        }
        return {
            result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok,
        };
    }
    async purgeRundown(clearAll) {
        await this._vizmseManager?.purgeRundown(clearAll);
    }
    async clearEngines() {
        await this._vizmseManager?.clearEngines({
            type: types_1.VizMSECommandType.CLEAR_ALL_ENGINES,
            time: this.getCurrentTime(),
            timelineObjId: 'clearAllEnginesAction',
            channels: 'all',
            commands: this._initOptions?.clearAllCommands || [],
        });
    }
    async resetViz(payload) {
        await this.purgeRundown(true); // note - this might not be 100% necessary
        await this.clearEngines();
        await this._vizmseManager?.activate(payload?.activeRundownPlaylistId);
        // lastly make sure we reset so timeline state is sent again
        this.clearStates();
        this.emit('resetResolver');
    }
    async executeAction(actionId, payload) {
        switch (actionId) {
            case timeline_state_resolver_types_1.VizMSEActions.PurgeRundown:
                await this.purgeRundown(true);
                return { result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok };
            case timeline_state_resolver_types_1.VizMSEActions.Activate:
                return this.activate(payload);
            case timeline_state_resolver_types_1.VizMSEActions.StandDown:
                return this.executeStandDown();
            case timeline_state_resolver_types_1.VizMSEActions.ClearAllEngines:
                await this.clearEngines();
                return { result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok };
            case timeline_state_resolver_types_1.VizMSEActions.VizReset:
                await this.resetViz(payload ?? {});
                return { result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok };
            default:
                return { result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok, response: (0, lib_1.t)('Action "{{id}}" not found', { actionId }) };
        }
    }
    get deviceType() {
        return timeline_state_resolver_types_1.DeviceType.VIZMSE;
    }
    get deviceName() {
        return `VizMSE ${this._vizMSE ? this._vizMSE.hostname : 'Uninitialized'}`;
    }
    get queue() {
        return this._doOnTime.getQueue();
    }
    get supportsExpectedPlayoutItems() {
        return true;
    }
    handleExpectedPlayoutItems(expectedPlayoutItems) {
        this.emitDebug('VIZDEBUG: handleExpectedPlayoutItems called');
        if (this._vizmseManager) {
            this.emitDebug('VIZDEBUG: manager exists');
            this._vizmseManager.setExpectedPlayoutItems(expectedPlayoutItems);
        }
    }
    getCurrentState() {
        return (this.getState() || { state: undefined }).state;
    }
    connectionChanged(connected) {
        if (connected === true || connected === false)
            this._vizMSEConnected = connected;
        if (connected === false) {
            this.emit('clearMediaObjects', this.deviceId);
        }
        this.emit('connectionChanged', this.getStatus());
    }
    /**
     * Takes a timeline state and returns a VizMSE State that will work with the state lib.
     * @param timelineState The timeline state to generate from.
     */
    convertStateToVizMSE(timelineState, mappings) {
        const state = {
            time: timelineState.time,
            layer: {},
        };
        _.each(timelineState.layers, (layer, layerName) => {
            const layerExt = layer;
            let foundMapping = mappings[layerName];
            let isLookahead = false;
            if (!foundMapping && layerExt.isLookahead && layerExt.lookaheadForLayer) {
                foundMapping = mappings[layerExt.lookaheadForLayer];
                isLookahead = true;
            }
            if (foundMapping && foundMapping.device === timeline_state_resolver_types_1.DeviceType.VIZMSE && foundMapping.deviceId === this.deviceId) {
                if (layer.content) {
                    const content = layer.content;
                    switch (content.type) {
                        case timeline_state_resolver_types_1.TimelineContentTypeVizMSE.LOAD_ALL_ELEMENTS:
                            state.layer[layerName] = (0, device_1.literal)({
                                timelineObjId: layer.id,
                                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.LOAD_ALL_ELEMENTS,
                            });
                            break;
                        case timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CLEAR_ALL_ELEMENTS: {
                            // Special case: clear all graphics:
                            const showId = this._vizmseManager?.resolveShowNameToId(content.showName);
                            if (!showId) {
                                this.emit('warning', `convertStateToVizMSE: Unable to find Show Id for Clear-All template and Show Name "${content.showName}"`);
                                break;
                            }
                            state.isClearAll = {
                                timelineObjId: layer.id,
                                showId,
                                channelsToSendCommands: content.channelsToSendCommands,
                            };
                            break;
                        }
                        case timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONTINUE:
                            state.layer[layerName] = (0, device_1.literal)({
                                timelineObjId: layer.id,
                                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONTINUE,
                                direction: content.direction,
                                reference: content.reference,
                            });
                            break;
                        case timeline_state_resolver_types_1.TimelineContentTypeVizMSE.INITIALIZE_SHOWS:
                            state.layer[layerName] = (0, device_1.literal)({
                                timelineObjId: layer.id,
                                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.INITIALIZE_SHOWS,
                                showIds: _.compact(content.showNames.map((showName) => this._vizmseManager?.resolveShowNameToId(showName))),
                            });
                            break;
                        case timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CLEANUP_SHOWS:
                            state.layer[layerName] = (0, device_1.literal)({
                                timelineObjId: layer.id,
                                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CLEANUP_SHOWS,
                                showIds: _.compact(content.showNames.map((showName) => this._vizmseManager?.resolveShowNameToId(showName))),
                            });
                            break;
                        case timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONCEPT:
                            state.layer[layerName] = (0, device_1.literal)({
                                timelineObjId: layer.id,
                                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONCEPT,
                                concept: content.concept,
                            });
                            break;
                        default: {
                            const stateLayer = this._contentToStateLayer(layer.id, content);
                            if (stateLayer) {
                                if (isLookahead)
                                    stateLayer.lookahead = true;
                                state.layer[layerName] = stateLayer;
                            }
                            break;
                        }
                    }
                }
            }
        });
        if (state.isClearAll) {
            // clear rest of state:
            state.layer = {};
        }
        // Fix references:
        _.each(state.layer, (layer) => {
            if (layer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONTINUE) {
                const otherLayer = state.layer[layer.reference];
                if (otherLayer) {
                    if (otherLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL ||
                        otherLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) {
                        layer.referenceContent = otherLayer;
                    }
                    else {
                        // it's not possible to reference that kind of object
                        this.emit('warning', `object "${layer.timelineObjId}" of contentType="${layer.contentType}", cannot reference object "${otherLayer.timelineObjId}" on layer "${layer.reference}" of contentType="${otherLayer.contentType}" `);
                    }
                }
            }
        });
        return state;
    }
    _contentToStateLayer(timelineObjId, content) {
        if (content.type === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL) {
            const showId = this._vizmseManager?.resolveShowNameToId(content.showName);
            if (!showId) {
                this.emit('warning', `_contentToStateLayer: Unable to find Show Id for template "${content.templateName}" and Show Name "${content.showName}"`);
                return undefined;
            }
            const o = {
                timelineObjId: timelineObjId,
                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL,
                continueStep: content.continueStep,
                cue: content.cue,
                outTransition: content.outTransition,
                templateName: content.templateName,
                templateData: content.templateData,
                channelName: content.channelName,
                delayTakeAfterOutTransition: content.delayTakeAfterOutTransition,
                showId,
            };
            return o;
        }
        else if (content.type === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) {
            const o = {
                timelineObjId: timelineObjId,
                contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT,
                continueStep: content.continueStep,
                cue: content.cue,
                outTransition: content.outTransition,
                templateVcpId: content.templateVcpId,
                channelName: content.channelName,
                delayTakeAfterOutTransition: content.delayTakeAfterOutTransition,
            };
            return o;
        }
        return undefined;
    }
    /**
     * Prepares the physical device for playout.
     * @param okToDestroyStuff Whether it is OK to do things that affects playout visibly
     */
    async makeReady(okToDestroyStuff, activeRundownPlaylistId) {
        const previousPlaylistId = this._vizmseManager?.activeRundownPlaylistId;
        if (this._vizmseManager) {
            await this._vizmseManager.cleanupAllShows();
            await this._vizmseManager.activate(activeRundownPlaylistId);
        }
        else
            throw new Error(`Unable to activate vizMSE, not initialized yet!`);
        if (okToDestroyStuff) {
            // reset our own state(s):
            this.clearStates();
            if (this._vizmseManager) {
                if (this._initOptions && activeRundownPlaylistId !== previousPlaylistId) {
                    if (this._initOptions.clearAllOnMakeReady &&
                        this._initOptions.clearAllCommands &&
                        this._initOptions.clearAllCommands.length) {
                        await this._vizmseManager.clearEngines({
                            type: types_1.VizMSECommandType.CLEAR_ALL_ENGINES,
                            time: this.getCurrentTime(),
                            timelineObjId: 'makeReady',
                            channels: 'all',
                            commands: this._initOptions.clearAllCommands,
                        });
                    }
                }
            }
            else
                throw new Error(`Unable to activate vizMSE, not initialized yet!`);
        }
    }
    async executeStandDown() {
        if (this._vizmseManager) {
            if (!this._initOptions || !this._initOptions.dontDeactivateOnStandDown) {
                await this._vizmseManager.deactivate();
            }
            else {
                this._vizmseManager.standDownActiveRundown(); // because we still want to stop monitoring expectedPlayoutItems
            }
        }
        return {
            result: timeline_state_resolver_types_1.ActionExecutionResultCode.Ok,
        };
    }
    /**
     * The standDown event could be triggered at a time after broadcast
     * @param okToDestroyStuff If true, the device may do things that might affect the visible output
     */
    async standDown(okToDestroyStuff) {
        if (okToDestroyStuff) {
            return this.executeStandDown().then(() => undefined);
        }
    }
    getStatus() {
        let statusCode = device_1.StatusCode.GOOD;
        const messages = [];
        if (!this._vizMSEConnected) {
            statusCode = device_1.StatusCode.BAD;
            messages.push('Not connected');
        }
        else if (this._vizmseManager) {
            if (this._vizmseManager.notLoadedCount > 0 || this._vizmseManager.loadingCount > 0) {
                statusCode = device_1.StatusCode.WARNING_MINOR;
                messages.push(`Got ${this._vizmseManager.notLoadedCount} elements not yet loaded to the Viz Engine (${this._vizmseManager.loadingCount} are currently loading)`);
            }
            if (this._vizmseManager.enginesDisconnected.length) {
                statusCode = device_1.StatusCode.BAD;
                this._vizmseManager.enginesDisconnected.forEach((engine) => {
                    messages.push(`Viz Engine ${engine} disconnected`);
                });
            }
        }
        return {
            statusCode: statusCode,
            messages: messages,
            active: this.isActive,
        };
    }
    /**
     * Compares the new timeline-state with the old one, and generates commands to account for the difference
     */
    _diffStates(oldState, newState, time) {
        const highPrioCommands = [];
        const lowPrioCommands = [];
        const addCommand = (command, lowPriority) => {
            ;
            (lowPriority ? lowPrioCommands : highPrioCommands).push(command);
        };
        /** The time of when to run "preparation" commands */
        let prepareTime = Math.min(time, Math.max(time - IDEAL_PREPARE_TIME, oldState.time + PREPARE_TIME_WAIT // earliset possible prepareTime
        ));
        if (prepareTime < this.getCurrentTime()) {
            // Only to not emit an unnessesary slowCommand event
            prepareTime = this.getCurrentTime();
        }
        if (time < prepareTime) {
            prepareTime = time - 10;
        }
        _.each(newState.layer, (newLayer, layerId) => {
            const oldLayer = oldState.layer[layerId];
            if (newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.LOAD_ALL_ELEMENTS) {
                if (!oldLayer || !_.isEqual(newLayer, oldLayer)) {
                    addCommand((0, device_1.literal)({
                        timelineObjId: newLayer.timelineObjId,
                        fromLookahead: newLayer.lookahead,
                        layerId: layerId,
                        type: types_1.VizMSECommandType.LOAD_ALL_ELEMENTS,
                        time: time,
                    }), newLayer.lookahead);
                }
            }
            else if (newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONTINUE) {
                if ((!oldLayer || !_.isEqual(newLayer, oldLayer)) && newLayer.referenceContent) {
                    const props = {
                        timelineObjId: newLayer.timelineObjId,
                        fromLookahead: newLayer.lookahead,
                        layerId: layerId,
                        content: vizMSEManager_1.VizMSEManager.getPlayoutItemContentFromLayer(newLayer.referenceContent),
                    };
                    if ((newLayer.direction || 1) === 1) {
                        addCommand((0, device_1.literal)({
                            ...props,
                            type: types_1.VizMSECommandType.CONTINUE_ELEMENT,
                            time: time,
                        }), newLayer.lookahead);
                    }
                    else {
                        addCommand((0, device_1.literal)({
                            ...props,
                            type: types_1.VizMSECommandType.CONTINUE_ELEMENT_REVERSE,
                            time: time,
                        }), newLayer.lookahead);
                    }
                }
            }
            else if (newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.INITIALIZE_SHOWS) {
                if (!oldLayer || !_.isEqual(newLayer, oldLayer)) {
                    addCommand((0, device_1.literal)({
                        type: types_1.VizMSECommandType.INITIALIZE_SHOWS,
                        timelineObjId: newLayer.timelineObjId,
                        showIds: newLayer.showIds,
                        time: time,
                    }), newLayer.lookahead);
                }
            }
            else if (newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CLEANUP_SHOWS) {
                if (!oldLayer || !_.isEqual(newLayer, oldLayer)) {
                    const command = (0, device_1.literal)({
                        type: types_1.VizMSECommandType.CLEANUP_SHOWS,
                        timelineObjId: newLayer.timelineObjId,
                        showIds: newLayer.showIds,
                        time: time,
                    });
                    addCommand(command, newLayer.lookahead);
                }
            }
            else if (newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.CONCEPT) {
                if (!oldLayer || !_.isEqual(newLayer, oldLayer)) {
                    addCommand((0, device_1.literal)({
                        concept: newLayer.concept,
                        type: types_1.VizMSECommandType.SET_CONCEPT,
                        time: time,
                        timelineObjId: newLayer.timelineObjId,
                    }));
                }
            }
            else {
                const props = {
                    timelineObjId: newLayer.timelineObjId,
                    fromLookahead: newLayer.lookahead,
                    layerId: layerId,
                    content: vizMSEManager_1.VizMSEManager.getPlayoutItemContentFromLayer(newLayer),
                };
                if (!oldLayer ||
                    !_.isEqual(_.omit(newLayer, ['continueStep', 'timelineObjId', 'outTransition']), _.omit(oldLayer, ['continueStep', 'timelineObjId', 'outTransition']))) {
                    if (newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL ||
                        newLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) {
                        // Maybe prepare the element first:
                        addCommand((0, device_1.literal)({
                            ...props,
                            type: types_1.VizMSECommandType.PREPARE_ELEMENT,
                            time: prepareTime,
                        }), newLayer.lookahead);
                        if (newLayer.cue) {
                            // Cue the element
                            addCommand((0, device_1.literal)({
                                ...props,
                                type: types_1.VizMSECommandType.CUE_ELEMENT,
                                time: time,
                            }), newLayer.lookahead);
                        }
                        else {
                            // Start playing element
                            addCommand((0, device_1.literal)({
                                ...props,
                                type: types_1.VizMSECommandType.TAKE_ELEMENT,
                                time: time,
                            }), newLayer.lookahead);
                        }
                    }
                }
                else if ((oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL ||
                    oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) &&
                    (newLayer.continueStep || 0) > (oldLayer.continueStep || 0)) {
                    // An increase in continueStep should result in triggering a continue:
                    addCommand((0, device_1.literal)({
                        ...props,
                        type: types_1.VizMSECommandType.CONTINUE_ELEMENT,
                        time: time,
                    }), newLayer.lookahead);
                }
                else if ((oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL ||
                    oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) &&
                    (newLayer.continueStep || 0) < (oldLayer.continueStep || 0)) {
                    // A decrease in continueStep should result in triggering a continue:
                    addCommand((0, device_1.literal)({
                        ...props,
                        type: types_1.VizMSECommandType.CONTINUE_ELEMENT_REVERSE,
                        time: time,
                    }), newLayer.lookahead);
                }
            }
        });
        _.each(oldState.layer, (oldLayer, layerId) => {
            const newLayer = newState.layer[layerId];
            if (!newLayer) {
                if (oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL ||
                    oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) {
                    // Stopped playing
                    addCommand((0, device_1.literal)({
                        type: types_1.VizMSECommandType.TAKEOUT_ELEMENT,
                        time: time,
                        timelineObjId: oldLayer.timelineObjId,
                        fromLookahead: oldLayer.lookahead,
                        layerId: layerId,
                        transition: oldLayer && oldLayer.outTransition,
                        content: vizMSEManager_1.VizMSEManager.getPlayoutItemContentFromLayer(oldLayer),
                    }), oldLayer.lookahead);
                }
                else if (oldLayer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.INITIALIZE_SHOWS) {
                    addCommand((0, device_1.literal)({
                        type: types_1.VizMSECommandType.INITIALIZE_SHOWS,
                        timelineObjId: oldLayer.timelineObjId,
                        showIds: [],
                        time: time,
                    }), oldLayer.lookahead);
                }
            }
        });
        if (newState.isClearAll && !oldState.isClearAll) {
            // Special: clear all graphics
            const clearingCommands = [];
            const templateName = this._initOptions && this._initOptions.clearAllTemplateName;
            if (!templateName) {
                this.emit('warning', `vizMSE: initOptions.clearAllTemplateName is not set!`);
            }
            else {
                // Start playing special element:
                clearingCommands.push((0, device_1.literal)({
                    timelineObjId: newState.isClearAll.timelineObjId,
                    time: time,
                    type: types_1.VizMSECommandType.CLEAR_ALL_ELEMENTS,
                    templateName: templateName,
                    showId: newState.isClearAll.showId,
                }));
            }
            if (newState.isClearAll.channelsToSendCommands &&
                this._initOptions &&
                this._initOptions.clearAllCommands &&
                this._initOptions.clearAllCommands.length) {
                // Send special commands to the engines:
                clearingCommands.push((0, device_1.literal)({
                    timelineObjId: newState.isClearAll.timelineObjId,
                    time: time,
                    type: types_1.VizMSECommandType.CLEAR_ALL_ENGINES,
                    channels: newState.isClearAll.channelsToSendCommands,
                    commands: this._initOptions.clearAllCommands,
                }));
            }
            return clearingCommands;
        }
        const sortCommands = (commands) => {
            // Sort the commands so that take out:s are run first
            return commands.sort((a, b) => {
                if (a.type === types_1.VizMSECommandType.TAKEOUT_ELEMENT && b.type !== types_1.VizMSECommandType.TAKEOUT_ELEMENT)
                    return -1;
                if (a.type !== types_1.VizMSECommandType.TAKEOUT_ELEMENT && b.type === types_1.VizMSECommandType.TAKEOUT_ELEMENT)
                    return 1;
                return 0;
            });
        };
        sortCommands(highPrioCommands);
        sortCommands(lowPrioCommands);
        const concatCommands = sortCommands(highPrioCommands.concat(lowPrioCommands));
        let highestDelay = 0;
        concatCommands.forEach((command) => {
            if (command.type === types_1.VizMSECommandType.TAKEOUT_ELEMENT) {
                if (command.transition && command.transition.delay) {
                    if (command.transition.delay > highestDelay) {
                        highestDelay = command.transition.delay;
                    }
                }
            }
        });
        if (highestDelay > 0) {
            concatCommands.forEach((command, index) => {
                if (command.type === types_1.VizMSECommandType.TAKE_ELEMENT &&
                    command.layerId &&
                    (newState.layer[command.layerId].contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL ||
                        !!newState.layer[command.layerId].delayTakeAfterOutTransition)) {
                    ;
                    concatCommands[index].transition = {
                        type: timeline_state_resolver_types_1.VIZMSETransitionType.DELAY,
                        delay: highestDelay + 20,
                    };
                }
            });
        }
        if (concatCommands.length) {
            this.emitDebug(`VIZMSE: COMMANDS: ${JSON.stringify(sortCommands(concatCommands))}`);
        }
        return sortCommands(concatCommands);
    }
    async _doCommand(command, context, timlineObjId) {
        const time = this.getCurrentTime();
        return this._commandReceiver(time, command, context, timlineObjId);
    }
    /**
     * Add commands to queue, to be executed at the right time
     */
    _addToQueue(commandsToAchieveState) {
        _.each(commandsToAchieveState, (cmd) => {
            this._doOnTime.queue(cmd.time, cmd.layerId, async (c) => {
                return this._doCommand(c.cmd, c.cmd.type + '_' + c.cmd.timelineObjId, c.cmd.timelineObjId);
            }, { cmd: cmd });
            this._doOnTimeBurst.queue(cmd.time, undefined, async (c) => {
                if (c.cmd.type === types_1.VizMSECommandType.TAKE_ELEMENT && !c.cmd.fromLookahead) {
                    if (this._vizmseManager && c.cmd.layerId) {
                        this._vizmseManager.clearAllWaitWithLayer(c.cmd.layerId);
                    }
                }
                return Promise.resolve();
            }, { cmd: cmd });
        });
    }
    /**
     * Sends commands to the VizMSE server
     * @param time deprecated
     * @param cmd Command to execute
     */
    async _defaultCommandReceiver(_time, cmd, context, timelineObjId) {
        const cwc = {
            context: context,
            timelineObjId: timelineObjId,
            command: cmd,
        };
        this.emitDebug(cwc);
        try {
            if (!this._vizmseManager) {
                throw new Error(`Not initialized yet`);
            }
            switch (cmd.type) {
                case types_1.VizMSECommandType.PREPARE_ELEMENT:
                    await this._vizmseManager.prepareElement(cmd);
                    break;
                case types_1.VizMSECommandType.CUE_ELEMENT:
                    await this._vizmseManager.cueElement(cmd);
                    break;
                case types_1.VizMSECommandType.TAKE_ELEMENT:
                    await this._vizmseManager.takeElement(cmd);
                    break;
                case types_1.VizMSECommandType.TAKEOUT_ELEMENT:
                    await this._vizmseManager.takeoutElement(cmd);
                    break;
                case types_1.VizMSECommandType.CONTINUE_ELEMENT:
                    await this._vizmseManager.continueElement(cmd);
                    break;
                case types_1.VizMSECommandType.CONTINUE_ELEMENT_REVERSE:
                    await this._vizmseManager.continueElementReverse(cmd);
                    break;
                case types_1.VizMSECommandType.LOAD_ALL_ELEMENTS:
                    await this._vizmseManager.loadAllElements(cmd);
                    break;
                case types_1.VizMSECommandType.CLEAR_ALL_ELEMENTS:
                    await this._vizmseManager.clearAll(cmd);
                    break;
                case types_1.VizMSECommandType.CLEAR_ALL_ENGINES:
                    await this._vizmseManager.clearEngines(cmd);
                    break;
                case types_1.VizMSECommandType.SET_CONCEPT:
                    await this._vizmseManager.setConcept(cmd);
                    break;
                case types_1.VizMSECommandType.INITIALIZE_SHOWS:
                    await this._vizmseManager.initializeShows(cmd);
                    break;
                case types_1.VizMSECommandType.CLEANUP_SHOWS:
                    await this._vizmseManager.cleanupShows(cmd);
                    break;
                default:
                    // @ts-ignore never
                    throw new Error(`Unsupported command type "${cmd.type}"`);
            }
        }
        catch (e) {
            const error = e;
            let errorString = error && error.message ? error.message : error.toString();
            if (error?.stack) {
                errorString += '\n' + error.stack;
            }
            if (e instanceof msehttp_1.HTTPClientError || e instanceof msehttp_1.HTTPServerError) {
                errorString +=
                    `\n\nPath: ${e.path}` +
                        '\n\n' +
                        (e.body ?? '[No request body present]') +
                        `\n\nStatus: ${e.status}` +
                        `\nResponse:\n ${e.response}`;
            }
            this.emit('commandError', new Error(errorString), cwc);
        }
    }
    ignoreWaitsInTests() {
        if (!this._vizmseManager)
            throw new Error('_vizmseManager not set');
        this._vizmseManager.ignoreAllWaits = true;
    }
}
exports.VizMSEDevice = VizMSEDevice;
//# sourceMappingURL=index.js.map