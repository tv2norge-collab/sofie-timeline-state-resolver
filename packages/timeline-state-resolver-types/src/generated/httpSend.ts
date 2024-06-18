/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run "yarn generate-schema-types" to regenerate this file.
 */
import { ActionExecutionResult } from ".."

export interface HTTPSendOptions {
	/**
	 * Minimum time in ms before a command is resent, set to <= 0 or undefined to disable
	 */
	resendTime?: number
	/**
	 * HTTP Proxy
	 */
	httpProxy?: string
	/**
	 * HTTPS Proxy
	 */
	httpsProxy?: string
	/**
	 * URLs not to use a proxy for (E.G. github.com)
	 */
	noProxy?: string[]
	oauthTokenHost?: string
	oauthTokenPath?: string
	oauthClientId?: string
	oauthClientSecret?: string
	oauthAudience?: string
	bearerToken?: string
}

export type SomeMappingHttpSend = Record<string, never>

export interface HTTPSendCommandContent {
	type: TimelineContentTypeHTTP
	url: string
	params: {
		[k: string]: unknown
	}
	paramsType?: TimelineContentTypeHTTPParamType
	headers?: {
		[k: string]: string
	}
	temporalPriority?: number
	/**
	 * Commands in the same queue will be sent in order (will wait for the previous to finish before sending next
	 */
	queueId?: string
}

export enum TimelineContentTypeHTTP {
	GET = 'get',
	POST = 'post',
	PUT = 'put',
	DELETE = 'delete'
}
export enum TimelineContentTypeHTTPParamType {
	JSON = 'json',
	FORM = 'form'
}

export enum HttpSendActions {
	Resync = 'resync',
	SendCommand = 'sendCommand'
}
export interface HttpSendActionExecutionResults {
	resync: () => void,
	sendCommand: (payload: HTTPSendCommandContent) => void
}
export type HttpSendActionExecutionPayload<A extends keyof HttpSendActionExecutionResults> = Parameters<
	HttpSendActionExecutionResults[A]
>[0]

export type HttpSendActionExecutionResult<A extends keyof HttpSendActionExecutionResults> =
	ActionExecutionResult<ReturnType<HttpSendActionExecutionResults[A]>>
