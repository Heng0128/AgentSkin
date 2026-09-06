// SPDX-License-Identifier: MPL-2.0

/**
 * Type declarations for pulse-injector test query-string imports.
 * Vitest uses query strings to force re-imports after vi.resetModules(),
 * but TypeScript doesn't understand this pattern. This declaration file
 * suppresses those errors.
 */

declare module './pulse-injector.mjs?success1' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?success2' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?success3' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?err1' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?err2' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?err3' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?err4' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?err5' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?persist1' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?persist2' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?persist3' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?persist4' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?persist5' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?css1' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?css2' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}

declare module './pulse-injector.mjs?singleton1' {
	export { InspectorPulseInjector, getPulseInjector, enablePersistentPulse, disablePersistentPulse } from './pulse-injector.mjs';
}
