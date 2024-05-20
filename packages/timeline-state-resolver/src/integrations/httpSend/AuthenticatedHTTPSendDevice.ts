import { HTTPSendOptions } from 'timeline-state-resolver-types'
import { HTTPSendDevice, HttpSendDeviceCommand } from '.'
import { AccessToken, ClientCredentials } from 'simple-oauth2'

const TOKEN_REQUEST_RETRY_TIMEOUT_MS = 1000
const TOKEN_EXPIRATION_WINDOW_SEC = 60
const enum AuthMethod {
	BEARER_TOKEN,
	CLIENT_CREDENTIALS,
}

export class AuthenticatedHTTPSendDevice extends HTTPSendDevice {
	private tokenPromise: Promise<AccessToken> | undefined
	private tokenRequestPending = false
	private authOptions:
		| {
				method: AuthMethod.CLIENT_CREDENTIALS
				clientId: string
				clientSecret: string
				tokenHost: string
				audience?: string
		  }
		| { method: AuthMethod.BEARER_TOKEN; bearerToken: string }
		| undefined
	private tokenRefreshTimeout: NodeJS.Timeout | undefined

	async init(options: HTTPSendOptions): Promise<boolean> {
		if (options.bearerToken) {
			this.authOptions = {
				method: AuthMethod.BEARER_TOKEN,
				bearerToken: options.bearerToken,
			}
		} else if (options.oauthClientId && options.oauthClientSecret && options.oauthTokenHost) {
			this.authOptions = {
				method: AuthMethod.CLIENT_CREDENTIALS,
				clientId: options.oauthClientId,
				clientSecret: options.oauthClientSecret,
				audience: options.oauthAudience,
				tokenHost: options.oauthTokenHost,
			}
			this.requestAccessToken()
		}
		// console.log('init')
		return super.init(options)
	}

	private requestAccessToken(): void {
		// console.log('token rq')
		if (this.tokenRequestPending) return
		this.clearTokenRefreshTimeout()
		this.tokenRequestPending = true
		const promise = this.makeAccessTokenRequest()
		promise
			.then((accessToken) => {
				// console.log('token recv')
				this.emit('debug', `token received`)
				const expiresIn = accessToken.token.expires_in
				if (typeof expiresIn === 'number') {
					this.scheduleTokenRefresh(expiresIn)
				}
			})
			.catch((e) => {
				this.emit('error', 'AuthenticatedHTTPSendDevice', e)
				setTimeout(() => this.requestAccessToken(), TOKEN_REQUEST_RETRY_TIMEOUT_MS)
			})
			.finally(() => {
				this.tokenRequestPending = false
			})
		this.tokenPromise = promise
	}

	private clearTokenRefreshTimeout() {
		if (this.tokenRefreshTimeout) {
			clearTimeout(this.tokenRefreshTimeout)
		}
	}

	private scheduleTokenRefresh(expiresInSec: number) {
		const timeoutMs = (expiresInSec - TOKEN_EXPIRATION_WINDOW_SEC) * 1000
		// console.log('token refr sched')
		this.emit('debug', `token refresh scheduled in ${timeoutMs}`)
		this.tokenRefreshTimeout = setTimeout(() => this.refreshAccessToken(), timeoutMs)
	}

	private refreshAccessToken(): void {
		this.emit('debug', `token refresh`)
		// console.log('token refr')
		this.requestAccessToken()
		this.tokenRefreshTimeout = undefined
	}

	private async makeAccessTokenRequest(): Promise<AccessToken> {
		if (!this.authOptions || this.authOptions.method !== AuthMethod.CLIENT_CREDENTIALS) {
			throw Error('authOptions missing or incorrect')
		}
		this.emit('debug', 'token request')
		console.log('token request')
		const token = await new ClientCredentials({
			client: {
				id: this.authOptions.clientId,
				secret: this.authOptions.clientSecret,
			},
			auth: {
				tokenHost: this.authOptions.tokenHost,
			},
		}).getToken({
			audience: this.authOptions.audience,
		})
		return token
	}

	async sendCommand({ tlObjId, context, command }: HttpSendDeviceCommand): Promise<void> {
		// console.log('send cmd')
		if (this.authOptions) {
			const bearerToken =
				this.authOptions.method === AuthMethod.BEARER_TOKEN ? this.authOptions.bearerToken : await this.tokenPromise
			if (bearerToken) {
				const bearerHeader = `Bearer ${typeof bearerToken === 'string' ? bearerToken : bearerToken.token.access_token}`
				command = {
					...command,
					content: {
						...command.content,
						headers: { ...command.content.headers, ['Authorization']: bearerHeader },
					},
				}
			}
		}
		// console.log(JSON.stringify(command))
		return super.sendCommand({ tlObjId, context, command })
	}
}
