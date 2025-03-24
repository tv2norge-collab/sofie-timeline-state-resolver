import { mockDeep, MockProxy } from 'jest-mock-extended'
import { DeviceContextAPI } from '../../service/device'

/** A default context for devices used in unit tests */

export function getDeviceContext(): MockProxy<DeviceContextAPI<any>> {
	// only properties (functions) needing a specific default (return) value, incl. async ones need to be explicitly set in the first arg
	return mockDeep<DeviceContextAPI<any>>({
		getCurrentTime: () => Date.now(),
		resetState: async () => Promise.resolve(),
		resetToState: async () => Promise.resolve(),
	})
}
