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

	// Remaining text and search commands
	registry.register({
		name: 'rev',
		load: () => import('./rev.js').then((m) => m.rev),
	});
	registry.register({
		name: 'tac',
		load: () => import('./tac.js').then((m) => m.tac),
	});
	registry.register({
		name: 'paste',
		load: () => import('./paste.js').then((m) => m.paste),
	});
	registry.register({
		name: 'fold',
		load: () => import('./fold.js').then((m) => m.fold),
	});
	registry.register({
		name: 'comm',
		load: () => import('./comm.js').then((m) => m.comm),
	});
	registry.register({
		name: 'join',
		load: () => import('./join.js').then((m) => m.join),
	});
	registry.register({
		name: 'nl',
		load: () => import('./nl.js').then((m) => m.nl),
	});
	registry.register({
		name: 'expand',
		load: () => import('./expand.js').then((m) => m.expand),
	});
	registry.register({
		name: 'unexpand',
		load: () => import('./unexpand.js').then((m) => m.unexpand),
	});
	registry.register({
		name: 'strings',
		load: () => import('./strings.js').then((m) => m.strings),
	});
	registry.register({
		name: 'column',
		load: () => import('./column.js').then((m) => m.column),
	});
	registry.register({
		name: 'find',
		load: () => import('./find.js').then((m) => m.find),
	});
	registry.register({
		name: 'xargs',
		load: () => import('./xargs.js').then((m) => m.xargs),
	});

	// Data processing commands
	registry.register({
		name: 'diff',
		load: () => import('./diff-cmd.js').then((m) => m.diff),
	});
	registry.register({
		name: 'base64',
		load: () => import('./base64.js').then((m) => m.base64),
	});
	registry.register({
		name: 'md5sum',
		load: () => import('./md5sum.js').then((m) => m.md5sum),
	});
	registry.register({
		name: 'sha1sum',
		load: () => import('./sha1sum.js').then((m) => m.sha1sum),
	});
	registry.register({
		name: 'sha256sum',
		load: () => import('./sha256sum.js').then((m) => m.sha256sum),
	});
	registry.register({
		name: 'expr',
		load: () => import('./expr.js').then((m) => m.expr),
	});
	registry.register({
		name: 'od',
		load: () => import('./od.js').then((m) => m.od),
	});

	// Navigation / info commands
	registry.register({
		name: 'ls',
		load: () => import('./ls.js').then((m) => m.ls),
	});
	registry.register({
		name: 'pwd',
		load: () => import('./pwd-cmd.js').then((m) => m.pwd),
	});
	registry.register({
		name: 'tree',
		load: () => import('./tree.js').then((m) => m.tree),
	});
	registry.register({
		name: 'du',
		load: () => import('./du.js').then((m) => m.du),
	});
	registry.register({
		name: 'basename',
		load: () => import('./basename-cmd.js').then((m) => m.basename),
	});
	registry.register({
		name: 'dirname',
		load: () => import('./dirname-cmd.js').then((m) => m.dirname),
	});
	registry.register({
		name: 'readlink',
		load: () => import('./readlink.js').then((m) => m.readlink),
	});
	registry.register({
		name: 'realpath',
		load: () => import('./realpath.js').then((m) => m.realpath),
	});

	// Environment / utility commands
	registry.register({
		name: 'echo',
		load: () => import('./echo-cmd.js').then((m) => m.echo),
	});
	registry.register({
		name: 'printf',
		load: () => import('./printf-cmd.js').then((m) => m.printf),
	});
	registry.register({
		name: 'env',
		load: () => import('./env.js').then((m) => m.env),
	});
	registry.register({
		name: 'printenv',
		load: () => import('./printenv.js').then((m) => m.printenv),
	});
	registry.register({
		name: 'date',
		load: () => import('./date.js').then((m) => m.date),
	});
	registry.register({
		name: 'seq',
		load: () => import('./seq.js').then((m) => m.seq),
	});
	registry.register({
		name: 'hostname',
		load: () => import('./hostname.js').then((m) => m.hostname),
	});
	registry.register({
		name: 'whoami',
		load: () => import('./whoami.js').then((m) => m.whoami),
	});
	registry.register({
		name: 'which',
		load: () => import('./which.js').then((m) => m.which),
	});

	// Pipeline utilities
	registry.register({
		name: 'tee',
		load: () => import('./tee.js').then((m) => m.tee),
	});
	registry.register({
		name: 'sleep',
		load: () => import('./sleep.js').then((m) => m.sleep),
	});

	// JSON processing
	registry.register({
		name: 'jq',
		load: () => import('./jq.js').then((m) => m.jqCommand),
	});
}
