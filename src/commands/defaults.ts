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

	// Text processing commands
	registry.register({
		name: 'grep',
		load: () => import('./grep.js').then((m) => m.grep),
	});
	registry.register({
		name: 'sed',
		load: () => import('./sed.js').then((m) => m.sed),
	});
	registry.register({
		name: 'awk',
		load: () => import('./awk.js').then((m) => m.awk),
	});
	registry.register({
		name: 'head',
		load: () => import('./head.js').then((m) => m.head),
	});
	registry.register({
		name: 'tail',
		load: () => import('./tail.js').then((m) => m.tail),
	});
	registry.register({
		name: 'sort',
		load: () => import('./sort.js').then((m) => m.sort),
	});
	registry.register({
		name: 'uniq',
		load: () => import('./uniq.js').then((m) => m.uniq),
	});
	registry.register({
		name: 'wc',
		load: () => import('./wc.js').then((m) => m.wc),
	});
	registry.register({
		name: 'cut',
		load: () => import('./cut.js').then((m) => m.cut),
	});
	registry.register({
		name: 'tr',
		load: () => import('./tr.js').then((m) => m.tr),
	});
}
