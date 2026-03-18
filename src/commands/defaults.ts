import type { CommandRegistry } from './registry.js';

/**
 * Register all default commands as lazy-loaded entries.
 * Each command module is loaded on first use via dynamic import.
 *
 * @param registry - The command registry to populate
 */
export function registerDefaultCommands(registry: CommandRegistry): void {
	registry.register({
		name: 'cat',
		load: () => import('./cat.js').then((m) => m.cat),
	});
	registry.register({
		name: 'cp',
		load: () => import('./cp.js').then((m) => m.cp),
	});
	registry.register({
		name: 'mv',
		load: () => import('./mv.js').then((m) => m.mv),
	});
	registry.register({
		name: 'rm',
		load: () => import('./rm.js').then((m) => m.rm),
	});
	registry.register({
		name: 'mkdir',
		load: () => import('./mkdir.js').then((m) => m.mkdir),
	});
	registry.register({
		name: 'rmdir',
		load: () => import('./rmdir.js').then((m) => m.rmdir),
	});
	registry.register({
		name: 'touch',
		load: () => import('./touch.js').then((m) => m.touch),
	});
	registry.register({
		name: 'chmod',
		load: () => import('./chmod.js').then((m) => m.chmod),
	});
	registry.register({
		name: 'ln',
		load: () => import('./ln.js').then((m) => m.ln),
	});
	registry.register({
		name: 'stat',
		load: () => import('./stat.js').then((m) => m.stat),
	});
	registry.register({
		name: 'file',
		load: () => import('./file.js').then((m) => m.file),
	});
}
