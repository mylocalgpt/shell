import type { Command, CommandContext, CommandResult } from './types.js';

export const seq: Command = {
	name: 'seq',
	async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
		let separator = '\n';
		let equalWidth = false;
		const nums: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-s' && i + 1 < args.length) {
				i++;
				separator = args[i];
				continue;
			}
			if (arg === '-w') {
				equalWidth = true;
				continue;
			}
			nums.push(arg);
		}

		let first = 1;
		let increment = 1;
		let last = 1;

		if (nums.length === 1) {
			last = Number.parseFloat(nums[0]);
		} else if (nums.length === 2) {
			first = Number.parseFloat(nums[0]);
			last = Number.parseFloat(nums[1]);
		} else if (nums.length >= 3) {
			first = Number.parseFloat(nums[0]);
			increment = Number.parseFloat(nums[1]);
			last = Number.parseFloat(nums[2]);
		}

		if (Number.isNaN(first) || Number.isNaN(increment) || Number.isNaN(last) || increment === 0) {
			return { exitCode: 1, stdout: '', stderr: 'seq: invalid argument\n' };
		}

		const values: string[] = [];
		if (increment > 0) {
			for (let v = first; v <= last + 1e-10; v += increment) {
				values.push(formatNum(v, increment));
			}
		} else {
			for (let v = first; v >= last - 1e-10; v += increment) {
				values.push(formatNum(v, increment));
			}
		}

		if (equalWidth && values.length > 0) {
			let maxLen = 0;
			for (let i = 0; i < values.length; i++) {
				if (values[i].length > maxLen) maxLen = values[i].length;
			}
			for (let i = 0; i < values.length; i++) {
				while (values[i].length < maxLen) values[i] = `0${values[i]}`;
			}
		}

		const stdout = values.length > 0 ? `${values.join(separator)}\n` : '';
		return { exitCode: 0, stdout, stderr: '' };
	},
};

function formatNum(v: number, increment: number): string {
	if (Number.isInteger(increment) && Number.isInteger(v)) return String(Math.round(v));
	// Determine decimal places from increment
	const incStr = String(increment);
	const dotIdx = incStr.indexOf('.');
	const decimals = dotIdx >= 0 ? incStr.length - dotIdx - 1 : 0;
	return v.toFixed(decimals);
}
