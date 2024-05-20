"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VizMSEManager = exports.getHash = void 0;
const _ = require("underscore");
const events_1 = require("events");
const device_1 = require("../../devices/device");
const timeline_state_resolver_types_1 = require("timeline-state-resolver-types");
const got_1 = require("got");
const lib_1 = require("../../lib");
const types_1 = require("./types");
const vizEngineTcpSender_1 = require("./vizEngineTcpSender");
const crypto = require("crypto");
const path = require("path");
/** Minimum time to wait before removing an element after an expectedPlayoutItem has been removed */
const DELETE_TIME_WAIT = 20 * 1000;
// How often to check / preload elements
const MONITOR_INTERVAL = 5 * 1000;
// How long to wait after any action (takes, cues, etc) before trying to cue for preloading
const SAFE_PRELOAD_TIME = 2000;
// How long to wait before retrying to ping the MSE when initializing the rundown, after a failed attempt
const INIT_RETRY_INTERVAL = 3000;
// Appears at the end of show names in the directory
const SHOW_EXTENSION = '.show';
function getHash(str) {
    const hash = crypto.createHash('sha1');
    return hash.update(str).digest('base64').replace(/[+/=]/g, '_'); // remove +/= from strings, because they cause troubles
}
exports.getHash = getHash;
class VizMSEManager extends events_1.EventEmitter {
    get activeRundownPlaylistId() {
        return this._activeRundownPlaylistId;
    }
    constructor(_parentVizMSEDevice, _vizMSE, preloadAllElements, onlyPreloadActivePlaylist, purgeUnknownElements, autoLoadInternalElements, engineRestPort, _showDirectoryPath, _profile, _playlistID) {
        super();
        this._parentVizMSEDevice = _parentVizMSEDevice;
        this._vizMSE = _vizMSE;
        this.preloadAllElements = preloadAllElements;
        this.onlyPreloadActivePlaylist = onlyPreloadActivePlaylist;
        this.purgeUnknownElements = purgeUnknownElements;
        this.autoLoadInternalElements = autoLoadInternalElements;
        this.engineRestPort = engineRestPort;
        this._showDirectoryPath = _showDirectoryPath;
        this._profile = _profile;
        this._playlistID = _playlistID;
        this.initialized = false;
        this.notLoadedCount = 0;
        this.loadingCount = 0;
        this.enginesDisconnected = [];
        this._elementCache = {};
        this._expectedPlayoutItems = [];
        this._lastTimeCommandSent = 0;
        this._hasActiveRundown = false;
        this._mseConnected = undefined; // undefined: first connection not established yet
        this._msePingConnected = false;
        this._loadingAllElements = false;
        this._waitWithLayers = {};
        this.ignoreAllWaits = false; // Only to be used in tests
        this._terminated = false;
        this._updateAfterReconnect = false;
        this._initializedShows = new Set();
    }
    /**
     * Initialize the Rundown in MSE.
     * Our approach is to create a single rundown on initialization, and then use only that for later control.
     */
    async initializeRundown(activeRundownPlaylistId) {
        this._vizMSE.on('connected', () => this.mseConnectionChanged(true));
        this._vizMSE.on('disconnected', () => this.mseConnectionChanged(false));
        this._vizMSE.on('warning', (message) => this.emit('warning', 'v-connection: ' + message));
        this._activeRundownPlaylistId = activeRundownPlaylistId;
        this._preloadedRundownPlaylistId = this.onlyPreloadActivePlaylist ? activeRundownPlaylistId : undefined;
        if (activeRundownPlaylistId) {
            this.emit('debug', `VizMSE: already active playlist: ${this._preloadedRundownPlaylistId}`);
        }
        const initializeRundownInner = async () => {
            try {
                // Perform a ping, to ensure we are connected properly
                await this._vizMSE.ping();
                this._msePingConnected = true;
                this.mseConnectionChanged(true);
                // Setup the rundown used by this device:
                const rundown = await this._getRundown();
                if (!rundown)
                    throw new Error(`VizMSEManager: Unable to create rundown!`);
                this._showToIdMap = await this._vizMSE.listShowsFromDirectory();
            }
            catch (e) {
                this.emit('debug', `VizMSE: initializeRundownInner ${e}`);
                setTimeout(() => {
                    (0, lib_1.deferAsync)(async () => initializeRundownInner(), (_e) => {
                        // ignore error
                    });
                }, INIT_RETRY_INTERVAL);
                return;
            }
            // const profile = await this._vizMSE.getProfile('sofie') // TODO: Figure out if this is needed
            this._setMonitorLoadedElementsTimeout();
            this._setMonitorConnectionTimeout();
            this.initialized = true;
        };
        await initializeRundownInner();
    }
    /**
     * Close connections and die
     */
    async terminate() {
        this._terminated = true;
        if (this._monitorAndLoadElementsTimeout) {
            clearTimeout(this._monitorAndLoadElementsTimeout);
        }
        if (this._monitorMSEConnectionTimeout) {
            clearTimeout(this._monitorMSEConnectionTimeout);
        }
        if (this._vizMSE) {
            await this._vizMSE.close();
        }
    }
    /**
     * Set the collection of expectedPlayoutItems.
     * These will be monitored and can be triggered to pre-load.
     */
    setExpectedPlayoutItems(expectedPlayoutItems) {
        this.emit('debug', 'VIZDEBUG: setExpectedPlayoutItems called');
        if (this.preloadAllElements) {
            this.emit('debug', 'VIZDEBUG: preload elements allowed');
            this._expectedPlayoutItems = expectedPlayoutItems;
            this._prepareAndGetExpectedPlayoutItems() // Calling this in order to trigger creation of all elements
                .then(async (hashesAndItems) => {
                if (this._rundown && this._hasActiveRundown) {
                    this.emit('debug', 'VIZDEBUG: auto load internal elements...');
                    await this.updateElementsLoadedStatus();
                    const elementHashesToDelete = [];
                    // When a new element is added, we'll trigger a show init:
                    const showIdsToInitialize = new Set();
                    _.each(this._elementCache, (element) => {
                        if ((0, types_1.isVizMSEPlayoutItemContentInternalInstance)(element.content)) {
                            if (!element.isLoaded && !element.requestedLoading) {
                                this.emit('debug', `Element "${this._getElementReference(element.element)}" is not loaded`);
                                if (this.autoLoadInternalElements || this._initializedShows.has(element.content.showId)) {
                                    showIdsToInitialize.add(element.content.showId);
                                    element.requestedLoading = true;
                                }
                            }
                        }
                        if (!hashesAndItems[element.hash] && !element.toDelete) {
                            elementHashesToDelete.push(element.hash);
                            this._elementCache[element.hash].toDelete = true;
                        }
                    });
                    const uniqueShowIds = Array.from(showIdsToInitialize);
                    await this._initializeShows(uniqueShowIds);
                    setTimeout(() => {
                        Promise.all(elementHashesToDelete.map(async (elementHash) => {
                            const element = this._elementCache[elementHash];
                            if (element?.toDelete) {
                                await this._deleteElement(element.content);
                                delete this._elementCache[elementHash];
                            }
                        })).catch((error) => this.emit('error', error));
                    }, DELETE_TIME_WAIT);
                }
            })
                .catch((error) => this.emit('error', error));
        }
    }
    async purgeRundown(clearAll) {
        this.emit('debug', `VizMSE: purging rundown (manually)`);
        const rundown = await this._getRundown();
        const elementsToKeep = clearAll ? undefined : this.getElementsToKeep();
        await rundown.purgeExternalElements(elementsToKeep || []);
    }
    /**
     * Activate the rundown.
     * This causes the MSE rundown to activate, which must be done before using it.
     * Doing this will make MSE start loading things onto the vizEngine etc.
     */
    async activate(rundownPlaylistId) {
        this._preloadedRundownPlaylistId = this.onlyPreloadActivePlaylist ? rundownPlaylistId : undefined;
        let loadTwice = false;
        if (!rundownPlaylistId || this._activeRundownPlaylistId !== rundownPlaylistId) {
            this._triggerCommandSent();
            const rundown = await this._getRundown();
            // clear any existing elements from the existing rundown
            try {
                this.emit('debug', `VizMSE: purging rundown`);
                const elementsToKeep = this.getElementsToKeep();
                await rundown.purgeExternalElements(elementsToKeep);
            }
            catch (error) {
                this.emit('error', error);
            }
            this._clearCache();
            this._clearMediaObjects();
            loadTwice = true;
        }
        this._triggerCommandSent();
        this._triggerLoadAllElements(loadTwice)
            .then(async () => {
            this._triggerCommandSent();
            this._activeRundownPlaylistId = rundownPlaylistId;
            this._hasActiveRundown = true;
            if (this.purgeUnknownElements) {
                const rundown = await this._getRundown();
                const elementsInRundown = await rundown.listExternalElements();
                const hashesAndItems = await this._prepareAndGetExpectedPlayoutItems();
                for (const element of elementsInRundown) {
                    // Check if that element is in our expectedPlayoutItems list
                    if (!hashesAndItems[VizMSEManager._getElementHash(element)]) {
                        // The element in the Viz-rundown seems to be unknown to us
                        await rundown.deleteElement(element);
                    }
                }
            }
        })
            .catch((e) => {
            this.emit('error', e);
        });
    }
    /**
     * Deactivate the MSE rundown.
     * This causes the MSE to stand down and clear the vizEngines of any loaded graphics.
     */
    async deactivate() {
        const rundown = await this._getRundown();
        this._triggerCommandSent();
        await rundown.deactivate();
        this._triggerCommandSent();
        this.standDownActiveRundown();
        this._clearMediaObjects();
    }
    standDownActiveRundown() {
        this._hasActiveRundown = false;
        this._activeRundownPlaylistId = undefined;
    }
    _clearMediaObjects() {
        this.emit('clearMediaObjects');
    }
    /**
     * Prepare an element
     * This creates the element and is intended to be called a little time ahead of Takeing the element.
     */
    async prepareElement(cmd) {
        this.logCommand(cmd, 'prepare');
        this._triggerCommandSent();
        await this._checkPrepareElement(cmd.content, true);
        this._triggerCommandSent();
    }
    /**
     * Cue:ing an element: Load and play the first frame of a graphic
     */
    async cueElement(cmd) {
        const rundown = await this._getRundown();
        await this._checkPrepareElement(cmd.content);
        await this._checkElementExists(cmd);
        await this._handleRetry(async () => {
            this.logCommand(cmd, 'cue');
            return rundown.cue(cmd.content);
        });
    }
    logCommand(cmd, commandName) {
        const content = cmd.content;
        if ((0, types_1.isVizMSEPlayoutItemContentInternalInstance)(content)) {
            this.emit('debug', `VizMSE: ${commandName} "${content.instanceName}" in show "${content.showId}"`);
        }
        else {
            this.emit('debug', `VizMSE: ${commandName} "${content.vcpid}" on channel "${content.channel}"`);
        }
    }
    /**
     * Take an element: Load and Play a graphic element, run in-animatinos etc
     */
    async takeElement(cmd) {
        const rundown = await this._getRundown();
        await this._checkPrepareElement(cmd.content);
        if (cmd.transition) {
            if (cmd.transition.type === timeline_state_resolver_types_1.VIZMSETransitionType.DELAY) {
                if (await this.waitWithLayer(cmd.layerId || '__default', cmd.transition.delay)) {
                    // at this point, the wait aws aborted by someone else. Do nothing then.
                    return;
                }
            }
        }
        await this._checkElementExists(cmd);
        await this._handleRetry(async () => {
            this.logCommand(cmd, 'take');
            return rundown.take(cmd.content);
        });
    }
    /**
     * Take out: Animate out a graphic element
     */
    async takeoutElement(cmd) {
        const rundown = await this._getRundown();
        if (cmd.transition) {
            if (cmd.transition.type === timeline_state_resolver_types_1.VIZMSETransitionType.DELAY) {
                if (await this.waitWithLayer(cmd.layerId || '__default', cmd.transition.delay)) {
                    // at this point, the wait aws aborted by someone else. Do nothing then.
                    return;
                }
            }
        }
        await this._checkPrepareElement(cmd.content);
        await this._checkElementExists(cmd);
        await this._handleRetry(async () => {
            this.logCommand(cmd, 'out');
            return rundown.out(cmd.content);
        });
    }
    /**
     * Continue: Cause the graphic element to step forward, if it has multiple states
     */
    async continueElement(cmd) {
        const rundown = await this._getRundown();
        await this._checkPrepareElement(cmd.content);
        await this._checkElementExists(cmd);
        await this._handleRetry(async () => {
            this.logCommand(cmd, 'continue');
            return rundown.continue(cmd.content);
        });
    }
    /**
     * Continue-reverse: Cause the graphic element to step backwards, if it has multiple states
     */
    async continueElementReverse(cmd) {
        const rundown = await this._getRundown();
        await this._checkPrepareElement(cmd.content);
        await this._checkElementExists(cmd);
        await this._handleRetry(async () => {
            this.logCommand(cmd, 'continue reverse');
            return rundown.continueReverse(cmd.content);
        });
    }
    /**
     * Special: trigger a template which clears all templates on the output
     */
    async clearAll(cmd) {
        const rundown = await this._getRundown();
        const template = {
            timelineObjId: cmd.timelineObjId,
            contentType: timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL,
            templateName: cmd.templateName,
            templateData: [],
            showId: cmd.showId,
        };
        // Start playing special element:
        const cmdTake = {
            time: cmd.time,
            type: types_1.VizMSECommandType.TAKE_ELEMENT,
            timelineObjId: template.timelineObjId,
            content: VizMSEManager.getPlayoutItemContentFromLayer(template),
        };
        await this._checkPrepareElement(cmdTake.content);
        await this._checkElementExists(cmdTake);
        await this._handleRetry(async () => {
            this.logCommand(cmdTake, 'clearAll take');
            return rundown.take(cmdTake.content);
        });
    }
    /**
     * Special: send commands to Viz Engines in order to clear them
     */
    async clearEngines(cmd) {
        try {
            const engines = await this._getEngines();
            const enginesToClear = this._filterEnginesToClear(engines, cmd.channels);
            enginesToClear.forEach((engine) => {
                const sender = new vizEngineTcpSender_1.VizEngineTcpSender(engine.port, engine.host);
                sender.on('warning', (w) => this.emit('warning', `clearEngines: ${w}`));
                sender.on('error', (e) => this.emit('error', `clearEngines: ${e}`));
                sender.send(cmd.commands);
            });
        }
        catch (e) {
            this.emit('warning', `Sending Clear-all command failed ${e}`);
        }
    }
    async _getEngines() {
        const profile = await this._vizMSE.getProfile(this._profile);
        const engines = await this._vizMSE.getEngines();
        const result = [];
        const outputs = new Map(); // engine name : channel name
        _.each(profile.execution_groups, (group, groupName) => {
            _.each(group, (entry) => {
                if (typeof entry === 'object' && entry.viz) {
                    if (typeof entry.viz === 'object' && entry.viz.value) {
                        outputs.set(entry.viz.value, groupName);
                    }
                }
            });
        });
        const outputEngines = engines.filter((engine) => {
            return outputs.has(engine.name);
        });
        outputEngines.forEach((engine) => {
            _.each(_.keys(engine.renderer), (fullHost) => {
                const channelName = outputs.get(engine.name);
                const match = fullHost.match(/([^:]+):?(\d*)?/);
                const port = match && match[2] ? parseInt(match[2], 10) : 6100;
                const host = match && match[1] ? match[1] : fullHost;
                result.push({ name: engine.name, channel: channelName, host, port });
            });
        });
        return result;
    }
    _filterEnginesToClear(engines, channels) {
        return engines.filter((engine) => channels === 'all' || (engine.channel && channels.includes(engine.channel)));
    }
    async setConcept(cmd) {
        const rundown = await this._getRundown();
        await rundown.setAlternativeConcept(cmd.concept);
    }
    /**
     * Load all elements: Trigger a loading of all pilot elements onto the vizEngine.
     * This might cause the vizEngine to freeze during load, so do not to it while on air!
     */
    async loadAllElements(_cmd) {
        this._triggerCommandSent();
        await this._triggerLoadAllElements();
        this._triggerCommandSent();
    }
    async _initializeShows(showIds) {
        const rundown = await this._getRundown();
        this.emit('debug', `Triggering show ${showIds} init `);
        for (const showId of showIds) {
            try {
                await rundown.initializeShow(showId);
            }
            catch (e) {
                this.emit('error', `Error in _initializeShows : ${e instanceof Error ? e.toString() : e}`);
            }
        }
    }
    async initializeShows(cmd) {
        const rundown = await this._getRundown();
        this._initializedShows = new Set(cmd.showIds);
        const expectedPlayoutItems = await this._prepareAndGetExpectedPlayoutItems();
        if (this.purgeUnknownElements) {
            this.emit('debug', `Purging shows ${cmd.showIds} `);
            const elementsToKeep = Object.values(expectedPlayoutItems).filter(types_1.isVizMSEPlayoutItemContentInternalInstance);
            await rundown.purgeInternalElements(cmd.showIds, true, elementsToKeep);
        }
        this._triggerCommandSent();
        await this._initializeShows(cmd.showIds);
        this._triggerCommandSent();
    }
    async cleanupShows(cmd) {
        this._triggerCommandSent();
        await this._cleanupShows(cmd.showIds);
        this._triggerCommandSent();
    }
    async _cleanupShows(showIds) {
        const rundown = await this._getRundown();
        this.emit('debug', `Triggering show ${showIds} cleanup `);
        await rundown.purgeInternalElements(showIds, true);
        for (const showId of showIds) {
            try {
                await rundown.cleanupShow(showId);
            }
            catch (e) {
                this.emit('error', `Error in _cleanupShows : ${e instanceof Error ? e.toString() : e}`);
            }
        }
    }
    async cleanupAllShows() {
        this._triggerCommandSent();
        const rundown = await this._getRundown();
        try {
            await rundown.cleanupAllSofieShows();
        }
        catch (error) {
            this.emit('error', `Error in cleanupAllShows : ${error instanceof Error ? error.toString() : error}`);
        }
        this._triggerCommandSent();
    }
    resolveShowNameToId(showName) {
        const showNameWithExtension = path.extname(showName) === SHOW_EXTENSION ? showName : `${showName}${SHOW_EXTENSION}`;
        return this._showToIdMap?.get(path.posix.join(this._showDirectoryPath, showNameWithExtension));
    }
    /** Convenience function to get the data for an element */
    static getTemplateData(layer) {
        if (layer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL)
            return layer.templateData;
        return [];
    }
    /** Convenience function to get the "instance-id" of an element. This is intended to be unique for each usage/instance of the elemenet */
    static getInternalElementInstanceName(layer) {
        return `sofieInt_${layer.templateName}_${getHash((layer.templateData ?? []).join(','))}`;
    }
    getPlayoutItemContent(playoutItem) {
        if ((0, types_1.isVIZMSEPlayoutItemContentExternal)(playoutItem)) {
            return playoutItem;
        }
        const showId = this.resolveShowNameToId(playoutItem.showName);
        if (!showId) {
            this.emit('warning', `getPlayoutItemContent: Unable to find Show Id for template "${playoutItem.templateName}" and Show Name "${playoutItem.showName}"`);
            return undefined;
        }
        return {
            ...playoutItem,
            instanceName: VizMSEManager.getInternalElementInstanceName(playoutItem),
            showId,
        };
    }
    static getPlayoutItemContentFromLayer(layer) {
        if (layer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_INTERNAL) {
            return {
                templateName: layer.templateName,
                templateData: this.getTemplateData(layer).map((data) => _.escape(data)),
                instanceName: this.getInternalElementInstanceName(layer),
                showId: layer.showId,
            };
        }
        if (layer.contentType === timeline_state_resolver_types_1.TimelineContentTypeVizMSE.ELEMENT_PILOT) {
            return (0, device_1.literal)({
                vcpid: layer.templateVcpId,
                channel: layer.channelName,
            });
        }
        throw new Error(`Unknown layer.contentType "${layer['contentType']}"`);
    }
    static _getElementHash(content) {
        if ((0, types_1.isVizMSEPlayoutItemContentInternalInstance)(content)) {
            return `${content.showId}_${content.instanceName}`;
        }
        else {
            return `pilot_${content.vcpid}_${content.channel}`;
        }
    }
    _getCachedElement(hashOrContent) {
        if (typeof hashOrContent !== 'string') {
            hashOrContent = VizMSEManager._getElementHash(hashOrContent);
            return this._elementCache[hashOrContent];
        }
        else {
            return this._elementCache[hashOrContent];
        }
    }
    _cacheElement(content, element) {
        const hash = VizMSEManager._getElementHash(content);
        if (!element)
            throw new Error('_cacheElement: element not set (with hash ' + hash + ')');
        if (this._elementCache[hash]) {
            this.emit('warning', `There is already an element with hash "${hash}" in cache`);
        }
        this._elementCache[hash] = {
            hash,
            element,
            content,
            isLoaded: this._isElementLoaded(element),
            isLoading: this._isElementLoading(element),
        };
    }
    _clearCache() {
        _.each(_.keys(this._elementCache), (hash) => {
            delete this._elementCache[hash];
        });
    }
    _getElementReference(el) {
        if (this._isInternalElement(el))
            return el.name;
        if (this._isExternalElement(el))
            return Number(el.vcpid); // TMP!!
        throw Error('Unknown element type, neither internal nor external');
    }
    _isInternalElement(element) {
        const el = element;
        return el && el.name && !el.vcpid;
    }
    _isExternalElement(element) {
        const el = element;
        return el && el.vcpid;
    }
    /**
     * Check if element is already created, otherwise create it and return it.
     */
    async _checkPrepareElement(content, fromPrepare) {
        const cachedElement = this._getCachedElement(content);
        let vElement = cachedElement ? cachedElement.element : undefined;
        if (cachedElement) {
            cachedElement.toDelete = false;
        }
        if (!vElement) {
            const elementHash = VizMSEManager._getElementHash(content);
            if (!fromPrepare) {
                this.emit('warning', `Late preparation of element "${elementHash}"`);
            }
            else {
                this.emit('debug', `VizMSE: preparing new "${elementHash}"`);
            }
            vElement = await this._prepareNewElement(content);
            if (!fromPrepare)
                await this._wait(100); // wait a bit, because taking isn't possible right away anyway at this point
        }
    }
    /** Check that the element exists and if not, throw error */
    async _checkElementExists(cmd) {
        const rundown = await this._getRundown();
        const cachedElement = this._getCachedElement(cmd.content);
        if (!cachedElement)
            throw new Error(`_checkElementExists: cachedElement falsy`);
        const elementRef = this._getElementReference(cachedElement.element);
        const elementIsExternal = cachedElement && this._isExternalElement(cachedElement.element);
        if (elementIsExternal) {
            const element = await rundown.getElement(cmd.content);
            if (this._isExternalElement(element) && element.exists === 'no') {
                throw new Error(`Can't take the element "${elementRef}" while it has the property exists="no"`);
            }
        }
    }
    /**
     * Create a new element in MSE
     */
    async _prepareNewElement(content) {
        const rundown = await this._getRundown();
        try {
            if ((0, types_1.isVizMSEPlayoutItemContentExternalInstance)(content)) {
                // Prepare a pilot element
                const pilotEl = await rundown.createElement(content);
                this._cacheElement(content, pilotEl);
                return pilotEl;
            }
            else {
                // Prepare an internal element
                const internalEl = await rundown.createElement(content, content.templateName, content.templateData || [], content.channel);
                this._cacheElement(content, internalEl);
                return internalEl;
            }
        }
        catch (e) {
            if (e.toString().match(/already exist/i)) {
                // "An internal/external graphics element with name 'xxxxxxxxxxxxxxx' already exists."
                // If the object already exists, it's not an error, fetch and use the element instead
                const element = await rundown.getElement(content);
                this._cacheElement(content, element);
                return element;
            }
            else {
                throw e;
            }
        }
    }
    async _deleteElement(content) {
        const rundown = await this._getRundown();
        this._triggerCommandSent();
        await rundown.deleteElement(content);
        this._triggerCommandSent();
    }
    async _prepareAndGetExpectedPlayoutItems() {
        this.emit('debug', `VISMSE: _prepareAndGetExpectedPlayoutItems (${this._expectedPlayoutItems.length})`);
        const hashesAndItems = {};
        const expectedPlayoutItems = _.uniq(_.filter(this._expectedPlayoutItems, (expectedPlayoutItem) => {
            return ((!this._preloadedRundownPlaylistId ||
                !expectedPlayoutItem.playlistId ||
                this._preloadedRundownPlaylistId === expectedPlayoutItem.playlistId) &&
                ((0, types_1.isVIZMSEPlayoutItemContentInternal)(expectedPlayoutItem) ||
                    (0, types_1.isVIZMSEPlayoutItemContentExternal)(expectedPlayoutItem)));
        }), false, (a) => JSON.stringify(_.pick(a, 'templateName', 'templateData', 'vcpid', 'showId')));
        await Promise.all(_.map(expectedPlayoutItems, async (expectedPlayoutItem) => {
            const content = this.getPlayoutItemContent(expectedPlayoutItem);
            if (!content) {
                return;
            }
            const hash = VizMSEManager._getElementHash(content);
            try {
                await this._checkPrepareElement(content, true);
                hashesAndItems[hash] = content;
            }
            catch (e) {
                this.emit('error', `Error in _prepareAndGetExpectedPlayoutItems for "${hash}": ${e.toString()}`);
            }
        }));
        return hashesAndItems;
    }
    /**
     * Update the load-statuses of the expectedPlayoutItems -elements from MSE, where needed
     */
    async updateElementsLoadedStatus(forceReloadAll) {
        const hashesAndItems = await this._prepareAndGetExpectedPlayoutItems();
        let someUnloaded = false;
        const elementsToLoad = _.compact(_.map(hashesAndItems, (item, hash) => {
            const el = this._getCachedElement(hash);
            if (!item.noAutoPreloading && el) {
                if (el.wasLoaded && !el.isLoaded && !el.isLoading) {
                    someUnloaded = true;
                }
                return el;
            }
            return undefined;
        }));
        if (this._rundown) {
            this.emit('debug', `Updating status of elements starting, activePlaylistId="${this._preloadedRundownPlaylistId}", elementsToLoad.length=${elementsToLoad.length} (${_.keys(hashesAndItems).length})`);
            const rundown = await this._getRundown();
            if (forceReloadAll) {
                elementsToLoad.forEach((element) => {
                    element.isLoaded = false;
                    element.isLoading = false;
                    element.requestedLoading = false;
                    element.wasLoaded = false;
                });
            }
            if (someUnloaded) {
                await this._triggerRundownActivate(rundown);
            }
            await Promise.all(_.map(elementsToLoad, async (cachedEl) => {
                try {
                    await this._checkPrepareElement(cachedEl.content);
                    this.emit('debug', `Updating status of element ${cachedEl.hash}`);
                    // Update cached status of the element:
                    const newEl = await rundown.getElement(cachedEl.content);
                    const newLoadedEl = {
                        ...cachedEl,
                        isExpected: true,
                        isLoaded: this._isElementLoaded(newEl),
                        isLoading: this._isElementLoading(newEl),
                    };
                    this._elementCache[cachedEl.hash] = newLoadedEl;
                    this.emit('debug', `Element ${cachedEl.hash}: ${JSON.stringify(newEl)}`);
                    if ((0, types_1.isVizMSEPlayoutItemContentExternalInstance)(cachedEl.content)) {
                        if (this._updateAfterReconnect || cachedEl?.isLoaded !== newLoadedEl.isLoaded) {
                            if (cachedEl?.isLoaded && !newLoadedEl.isLoaded) {
                                newLoadedEl.wasLoaded = true;
                            }
                            else if (!cachedEl?.isLoaded && newLoadedEl.isLoaded) {
                                newLoadedEl.wasLoaded = false;
                            }
                            const vcpid = cachedEl.content.vcpid;
                            if (newLoadedEl.isLoaded) {
                                const mediaObject = {
                                    _id: cachedEl.hash,
                                    mediaId: 'PILOT_' + vcpid,
                                    mediaPath: vcpid.toString(),
                                    mediaSize: 0,
                                    mediaTime: 0,
                                    thumbSize: 0,
                                    thumbTime: 0,
                                    cinf: '',
                                    tinf: '',
                                    _rev: '',
                                };
                                this.emit('updateMediaObject', cachedEl.hash, mediaObject);
                            }
                            else {
                                this.emit('updateMediaObject', cachedEl.hash, null);
                            }
                        }
                        if (newLoadedEl.wasLoaded && !newLoadedEl.isLoaded && !newLoadedEl.isLoading) {
                            this.emit('debug', `Element "${this._getElementReference(newEl)}" went from loaded to not loaded, initializing`);
                            await rundown.initialize(cachedEl.content);
                        }
                    }
                }
                catch (e) {
                    this.emit('error', `Error in updateElementsLoadedStatus: ${e.toString()}`);
                }
            }));
            this._updateAfterReconnect = false;
            this.emit('debug', `Updating status of elements done`);
        }
        else {
            throw Error('VizMSE.v-connection not initialized yet');
        }
    }
    async _triggerRundownActivate(rundown) {
        try {
            this.emit('debug', 'rundown.activate triggered');
            await rundown.activate();
        }
        catch (error) {
            this.emit('warning', `Ignored error for rundown.activate(): ${error}`);
        }
        this._triggerCommandSent();
        await this._wait(1000);
        this._triggerCommandSent();
    }
    /**
     * Trigger a load of all elements that are not yet loaded onto the vizEngine.
     */
    async _triggerLoadAllElements(loadTwice = false) {
        if (this._loadingAllElements) {
            this.emit('warning', '_triggerLoadAllElements already running');
            return;
        }
        this._loadingAllElements = true;
        try {
            const rundown = await this._getRundown();
            this.emit('debug', '_triggerLoadAllElements starting');
            // First, update the loading-status of all elements:
            await this.updateElementsLoadedStatus(true);
            // if (this._initializeRundownOnLoadAll) {
            // Then, load all elements that needs loading:
            const loadAllElementsThatNeedsLoading = async () => {
                const showIdsToInitialize = new Set();
                this._triggerCommandSent();
                await this._triggerRundownActivate(rundown);
                await Promise.all(_.map(this._elementCache, async (e) => {
                    if ((0, types_1.isVizMSEPlayoutItemContentInternalInstance)(e.content)) {
                        showIdsToInitialize.add(e.content.showId);
                        e.requestedLoading = true;
                    }
                    else if ((0, types_1.isVizMSEPlayoutItemContentExternalInstance)(e.content)) {
                        if (e.isLoaded) {
                            // The element is loaded fine, no need to do anything
                            this.emit('debug', `Element "${VizMSEManager._getElementHash(e.content)}" is loaded`);
                        }
                        else if (e.isLoading) {
                            // The element is currently loading, do nothing
                            this.emit('debug', `Element "${VizMSEManager._getElementHash(e.content)}" is loading`);
                        }
                        else if (e.isExpected) {
                            // The element has not started loading, load it:
                            this.emit('debug', `Element "${VizMSEManager._getElementHash(e.content)}" is not loaded, initializing`);
                            await rundown.initialize(e.content);
                        }
                    }
                    else {
                        this.emit('error', `Element "${VizMSEManager._getElementHash(e.content)}" type `);
                    }
                }));
                await this._initializeShows(Array.from(showIdsToInitialize));
            };
            // He's making a list:
            await loadAllElementsThatNeedsLoading();
            await this._wait(2000);
            if (loadTwice) {
                // He's checking it twice:
                await this.updateElementsLoadedStatus();
                // Gonna find out what's loaded and nice:
                await loadAllElementsThatNeedsLoading();
            }
            this.emit('debug', '_triggerLoadAllElements done');
        }
        finally {
            this._loadingAllElements = false;
        }
    }
    _setMonitorLoadedElementsTimeout() {
        if (this._monitorAndLoadElementsTimeout) {
            clearTimeout(this._monitorAndLoadElementsTimeout);
        }
        if (!this._terminated) {
            this._monitorAndLoadElementsTimeout = setTimeout(() => {
                this._monitorLoadedElements()
                    .catch((...args) => {
                    this.emit('error', ...args);
                })
                    .finally(() => {
                    this._setMonitorLoadedElementsTimeout();
                });
            }, MONITOR_INTERVAL);
        }
    }
    _setMonitorConnectionTimeout() {
        if (this._monitorMSEConnectionTimeout) {
            clearTimeout(this._monitorMSEConnectionTimeout);
        }
        if (!this._terminated) {
            this._monitorMSEConnectionTimeout = setTimeout(() => {
                this._monitorConnection()
                    .catch((...args) => {
                    this.emit('error', ...args);
                })
                    .finally(() => {
                    this._setMonitorConnectionTimeout();
                });
            }, MONITOR_INTERVAL);
        }
    }
    async _monitorConnection() {
        if (this.initialized) {
            // (the ping will throw on a timeout if ping doesn't return in time)
            return this._vizMSE
                .ping()
                .then(() => {
                // ok!
                if (!this._msePingConnected) {
                    this._msePingConnected = true;
                    this.onConnectionChanged();
                }
            })
                .catch(() => {
                // not ok!
                if (this._msePingConnected) {
                    this._msePingConnected = false;
                    this.onConnectionChanged();
                }
            })
                .then(async () => {
                return this._msePingConnected ? this._monitorEngines() : Promise.resolve();
            });
        }
        return Promise.reject();
    }
    async _monitorEngines() {
        if (!this.engineRestPort) {
            return;
        }
        const engines = await this._getEngines();
        const ps = [];
        engines.forEach((engine) => {
            return ps.push(this._pingEngine(engine));
        });
        const statuses = await Promise.all(ps);
        const enginesDisconnected = [];
        statuses.forEach((status) => {
            if (!status.alive) {
                enginesDisconnected.push(`${status.channel || status.name} (${status.host})`);
            }
        });
        if (!_.isEqual(enginesDisconnected, this.enginesDisconnected)) {
            this.enginesDisconnected = enginesDisconnected;
            this.onConnectionChanged();
        }
    }
    async _pingEngine(engine) {
        return new Promise((resolve) => {
            const url = `http://${engine.host}:${this.engineRestPort}/#/status`;
            got_1.default
                .get(url, { timeout: 2000 })
                .then((response) => {
                const alive = response !== undefined && response?.statusCode < 400;
                if (!alive) {
                    this.emit('debug', `VizMSE: _pingEngine at "${url}", code ${response?.statusCode}`);
                }
                resolve({ ...engine, alive });
            })
                .catch((error) => {
                this.emit('debug', `VizMSE: _pingEngine at "${url}", error ${error}`);
                resolve({ ...engine, alive: false });
            });
        });
    }
    /** Monitor loading status of expected elements */
    async _monitorLoadedElements() {
        try {
            if (this._rundown &&
                this._hasActiveRundown &&
                this.preloadAllElements &&
                this._timeSinceLastCommandSent() > SAFE_PRELOAD_TIME) {
                await this.updateElementsLoadedStatus(false);
                let notLoaded = 0;
                let loading = 0;
                let loaded = 0;
                _.each(this._elementCache, (e) => {
                    if (e.isLoaded)
                        loaded++;
                    else if (e.isLoading)
                        loading++;
                    else
                        notLoaded++;
                });
                if (notLoaded > 0 || loading > 0) {
                    // emit debug data
                    this.emit('debug', `Items on queue: notLoaded: ${notLoaded} loading: ${loading}, loaded: ${loaded}`);
                    this.emit('debug', `_elementsLoaded: ${_.map(_.filter(this._elementCache, (e) => !e.isLoaded).slice(0, 10), (e) => {
                        return JSON.stringify(e.element);
                    })}`);
                }
                this._setLoadedStatus(notLoaded, loading);
            }
            else
                this._setLoadedStatus(0, 0);
        }
        catch (e) {
            this.emit('error', e);
        }
    }
    async _wait(time) {
        if (this.ignoreAllWaits)
            return Promise.resolve();
        return new Promise((resolve) => setTimeout(resolve, time));
    }
    /** Execute fcn an retry a couple of times until it succeeds */
    async _handleRetry(fcn) {
        let i = 0;
        const maxNumberOfTries = 5;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                this._triggerCommandSent();
                const result = fcn();
                this._triggerCommandSent();
                return result;
            }
            catch (e) {
                if (i++ < maxNumberOfTries) {
                    if (e?.toString && e?.toString().match(/inexistent/i)) {
                        // "PepTalk inexistent error"
                        this.emit('debug', `VizMSE: _handleRetry got "inexistent" error, trying again...`);
                        // Wait and try again:
                        await this._wait(300);
                    }
                    else {
                        // Unhandled error, give up:
                        throw e;
                    }
                }
                else {
                    // Give up, we've tried enough times already
                    throw e;
                }
            }
        }
    }
    _triggerCommandSent() {
        this._lastTimeCommandSent = Date.now();
    }
    _timeSinceLastCommandSent() {
        return Date.now() - this._lastTimeCommandSent;
    }
    _setLoadedStatus(notLoaded, loading) {
        if (notLoaded !== this.notLoadedCount || loading !== this.loadingCount) {
            this.notLoadedCount = notLoaded;
            this.loadingCount = loading;
            this._parentVizMSEDevice.connectionChanged();
        }
    }
    /**
     * Returns true if the element is successfully loaded (as opposed to "not-loaded" or "loading")
     */
    _isElementLoaded(el) {
        if (this._isInternalElement(el)) {
            return ((el.available === '1.00' || el.available === '1' || el.available === undefined) &&
                (el.loaded === '1.00' || el.loaded === '1') &&
                el.is_loading !== 'yes');
        }
        else if (this._isExternalElement(el)) {
            return ((el.available === '1.00' || el.available === '1') &&
                (el.loaded === '1.00' || el.loaded === '1') &&
                el.is_loading !== 'yes');
        }
        else {
            throw new Error(`vizMSE: _isLoaded: unknown element type: ${el && JSON.stringify(el)}`);
        }
    }
    /**
     * Returns true if the element has NOT started loading (is currently not loading, or finished loaded)
     */
    _isElementLoading(el) {
        if (this._isInternalElement(el)) {
            return el.loaded !== '1.00' && el.loaded !== '1' && el.is_loading === 'yes';
        }
        else if (this._isExternalElement(el)) {
            return el.loaded !== '1.00' && el.loaded !== '1' && el.is_loading === 'yes';
        }
        else {
            throw new Error(`vizMSE: _isLoaded: unknown element type: ${el && JSON.stringify(el)}`);
        }
    }
    /**
     * Return the current MSE rundown, create it if it doesn't exists
     */
    async _getRundown() {
        if (!this._rundown) {
            // Only allow for one rundown fetch at the same time:
            if (this._getRundownPromise) {
                return this._getRundownPromise;
            }
            const getRundownPromise = (async () => {
                // Check if the rundown already exists:
                // let rundown: VRundown | undefined = _.find(await this._vizMSE.getRundowns(), (rundown) => {
                // 	return (
                // 		rundown.show === this._showID &&
                // 		rundown.profile === this._profile &&
                // 		rundown.playlist === this._playlistID
                // 	)
                // })
                this.emit('debug', `Creating new rundown ${[this._profile, this._playlistID]}`);
                const rundown = await this._vizMSE.createRundown(this._profile, this._playlistID);
                this._rundown = rundown;
                if (!this._rundown)
                    throw new Error(`_getRundown: this._rundown is not set!`);
                return this._rundown;
            })();
            this._getRundownPromise = getRundownPromise;
            try {
                const rundown = await this._getRundownPromise;
                this._rundown = rundown;
                return rundown;
            }
            catch (e) {
                this._getRundownPromise = undefined;
                throw e;
            }
        }
        else {
            return this._rundown;
        }
    }
    mseConnectionChanged(connected) {
        if (connected !== this._mseConnected) {
            if (connected) {
                // not the first connection
                if (this._mseConnected === false) {
                    this._updateAfterReconnect = true;
                }
            }
            this._mseConnected = connected;
            this.onConnectionChanged();
        }
    }
    onConnectionChanged() {
        this.emit('connectionChanged', this._mseConnected && this._msePingConnected);
    }
    clearAllWaitWithLayer(portId) {
        if (!this._waitWithLayers[portId]) {
            _.each(this._waitWithLayers[portId], (fcn) => {
                fcn(true);
            });
        }
    }
    /**
     * Returns true if the wait was cleared from someone else
     */
    async waitWithLayer(layerId, delay) {
        return new Promise((resolve) => {
            if (!this._waitWithLayers[layerId])
                this._waitWithLayers[layerId] = [];
            this._waitWithLayers[layerId].push(resolve);
            setTimeout(() => {
                resolve(false);
            }, delay || 0);
        });
    }
    getElementsToKeep() {
        return this._expectedPlayoutItems
            .filter((item) => !!item.baseline)
            .map((playoutItem) => this.getPlayoutItemContent(playoutItem))
            .filter(types_1.isVizMSEPlayoutItemContentExternalInstance);
    }
}
exports.VizMSEManager = VizMSEManager;
//# sourceMappingURL=vizMSEManager.js.map