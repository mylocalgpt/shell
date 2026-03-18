import type { Command, CommandContext, CommandResult } from './types.js';

export const env: Command = {
	name: 'env',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		if (args.length === 0) {
			const keys: string[] = [];
			for (const key of ctx.env.keys()) keys.push(key);
			keys.sort();
			let stdout = '';
			for (let i = 0; i < keys.length; i++) {
				stdout += `${keys[i]}=${ctx.env.get(keys[i])}\n`;
			}
			return { exitCode: 0, stdout, stderr: '' };
		}

		// Parse KEY=value pairs, then run command
		const overrides = new Map<string, string>();
		let cmdStart = 0;
		for (let i = 0; i < args.length; i++) {
			const eqIdx = args[i].indexOf('=');
			if (eqIdx > 0 && !args[i].startsWith('-')) {
				overrides.set(args[i].slice(0, eqIdx), args[i].slice(eqIdx + 1));
				cmdStart = i + 1;
			} else {
				break;
			}
		}

		if (cmdStart >= args.length) {
			// No command, just print env with overrides
			const merged = new Map(ctx.env);
			for (const [k, v] of overrides) merged.set(k, v);
			const keys: string[] = [];
			for (const key of merged.keys()) keys.push(key);
			keys.sort();
			let stdout = '';
			for (let i = 0; i < keys.length; i++) {
				stdout += `${keys[i]}=${merged.get(keys[i])}\n`;
			}
			return { exitCode: 0, stdout, stderr: '' };
		}

		// Build command string and execute
		const cmdParts = args.slice(cmdStart);
		const cmd = cmdParts.join(' ');
		// Apply overrides to env before exec
		for (const [k, v] of overrides) ctx.env.set(k, v);
		const result = await ctx.exec(cmd);
		return result;
	},
};
