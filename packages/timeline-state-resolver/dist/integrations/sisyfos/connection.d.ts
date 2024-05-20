/// <reference types="node" />
import { EventEmitter } from 'events';
export declare class SisyfosApi extends EventEmitter {
    host: string;
    port: number;
    private _oscClient;
    private _state?;
    private _labelToChannel;
    private _connectivityCheckInterval;
    private _pingCounter;
    private _connectivityTimeout;
    private _connected;
    private _mixerOnline;
    /**
     * Connnects to the OSC server.
     * @param host ip to connect to
     * @param port port the osc server is hosted on
     */
    connect(host: string, port: number): Promise<void>;
    dispose(): void;
    send(command: SisyfosCommand): void;
    disconnect(): void;
    isInitialized(): boolean;
    reInitialize(): void;
    getChannelByLabel(label: string): number | undefined;
    get connected(): boolean;
    get state(): SisyfosAPIState | undefined;
    get mixerOnline(): boolean;
    setMixerOnline(state: boolean): void;
    private _monitorConnectivity;
    private _clearPingTimer;
    private receiver;
    private updateIsConnected;
    private parseChannelCommand;
    private parseSisyfosState;
}
export declare enum SisyfosCommandType {
    TOGGLE_PGM = "togglePgm",
    TOGGLE_PST = "togglePst",
    SET_FADER = "setFader",
    CLEAR_PST_ROW = "clearPstRow",
    LABEL = "label",
    TAKE = "take",
    VISIBLE = "visible",
    RESYNC = "resync",
    SET_CHANNEL = "setChannel"
}
export interface BaseCommand {
    type: SisyfosCommandType;
}
export interface SetChannelCommand {
    type: SisyfosCommandType.SET_CHANNEL;
    channel: number;
    values: Partial<SisyfosAPIChannel>;
}
export interface ChannelCommand {
    type: SisyfosCommandType.SET_FADER | SisyfosCommandType.TOGGLE_PGM | SisyfosCommandType.TOGGLE_PST | SisyfosCommandType.LABEL | SisyfosCommandType.VISIBLE;
    channel: number;
    value: boolean | number | string;
}
export interface BoolCommand extends ChannelCommand {
    type: SisyfosCommandType.VISIBLE;
    value: boolean;
}
export interface ValueCommand extends ChannelCommand {
    type: SisyfosCommandType.TOGGLE_PGM | SisyfosCommandType.TOGGLE_PST | SisyfosCommandType.SET_FADER;
    value: number;
}
export interface ValuesCommand extends Omit<ChannelCommand, 'value'> {
    type: SisyfosCommandType.TOGGLE_PGM;
    values: number[];
}
export interface StringCommand extends ChannelCommand {
    type: SisyfosCommandType.LABEL;
    value: string;
}
export interface ResyncCommand extends BaseCommand {
    type: SisyfosCommandType.RESYNC;
}
export type SisyfosCommand = BaseCommand | ValueCommand | ValuesCommand | BoolCommand | StringCommand | ResyncCommand | SetChannelCommand;
export interface SisyfosChannel extends SisyfosAPIChannel {
    tlObjIds: string[];
}
export interface SisyfosState {
    channels: {
        [index: string]: SisyfosChannel;
    };
    resync: boolean;
    triggerValue?: string;
}
export interface SisyfosAPIChannel {
    faderLevel: number;
    pgmOn: number;
    pstOn: number;
    label: string;
    visible: boolean;
    fadeTime?: number;
}
export interface SisyfosAPIState {
    channels: {
        [index: string]: SisyfosAPIChannel;
    };
}
//# sourceMappingURL=connection.d.ts.map