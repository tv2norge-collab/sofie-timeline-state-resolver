/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run "yarn generate-schema-types" to regenerate this file.
 */
import { ActionExecutionResult } from ".."

export interface SofieChefOptions {
	/**
	 * Address to the Sofie Chef websocket server. Example: 'ws://127.0.0.1:5271'
	 */
	address: string
	/**
	 * Access key to the Sofie Chef API
	 */
	apiKey?: string
}

export interface MappingSofieChefWindow {
	windowId: string
	mappingType: MappingSofieChefType.Window
}

export enum MappingSofieChefType {
	Window = 'window',
}

export type SomeMappingSofieChef = MappingSofieChefWindow

export interface RestartWindowPayload {
	windowId: string
}

export enum SofieChefActions {
	RestartAllWindows = 'restartAllWindows',
	RestartWindow = 'restartWindow'
}
export interface SofieChefActionExecutionResults {
	restartAllWindows: () => void,
	restartWindow: (payload: RestartWindowPayload) => void
}
export type SofieChefActionExecutionPayload<A extends keyof SofieChefActionExecutionResults> = Parameters<
	SofieChefActionExecutionResults[A]
>[0]

export type SofieChefActionExecutionResult<A extends keyof SofieChefActionExecutionResults> =
	ActionExecutionResult<ReturnType<SofieChefActionExecutionResults[A]>>
