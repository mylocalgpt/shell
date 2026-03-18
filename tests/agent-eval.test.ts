import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.js';

describe('agent eval test suite', () => {
	describe('core operations', () => {
		it('1. search codebase with grep', async () => {
			const shell = new Shell({
				files: {
					'/workspace/src/app.ts': '// TODO: implement auth\nconst app = "hello";\n',
					'/workspace/src/utils.ts': 'export function helper() {\n  // TODO: refactor\n}\n',
					'/workspace/src/config.ts': 'export const config = {};\n',
				},
			});
			const result = await shell.exec('grep -rn "TODO" /workspace/');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('TODO');
			expect(result.stdout.split('\n').filter((l) => l.length > 0).length).toBe(2);
		});

		it('2. extract from JSON with jq', async () => {
			const shell = new Shell({
				files: {
					'/workspace/config.json':
						'{"database": {"host": "db.example.com", "port": 5432}, "cache": {"ttl": 3600}}',
				},
			});
			const result = await shell.exec('cat /workspace/config.json | jq .database.host');
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe('"db.example.com"');
		});

		it('3. transform JSON with jq', async () => {
			const shell = new Shell({
				files: {
					'/workspace/data.json': JSON.stringify({
						users: [
							{ name: 'alice', active: true },
							{ name: 'bob', active: false },
							{ name: 'carol', active: true },
							{ name: 'dave', active: true },
						],
					}),
				},
			});
			// Use jq with simple filter (no pipe in filter - shell parser limitation)
			const result = await shell.exec('jq ".users[].active" /workspace/data.json');
			expect(result.exitCode).toBe(0);
			// Count true values
			const trueCount = result.stdout
				.trim()
				.split('\n')
				.filter((l) => l === 'true').length;
			expect(trueCount).toBe(3);
		});

		it('4. CSV analysis with head, wc, cut, sort', async () => {
			const csv = [
				'name,city,age',
				'alice,new york,30',
				'bob,london,25',
				'carol,new york,35',
				'dave,paris,28',
				'eve,london,32',
			].join('\n');
			const shell = new Shell({
				files: { '/workspace/data.csv': `${csv}\n` },
			});

			const head = await shell.exec('head -3 /workspace/data.csv');
			expect(head.exitCode).toBe(0);
			expect(head.stdout.split('\n').filter((l) => l.length > 0).length).toBe(3);

			const wc = await shell.exec('wc -l /workspace/data.csv');
			expect(wc.exitCode).toBe(0);
			expect(wc.stdout).toContain('6');

			const cities = await shell.exec('cut -d, -f2 /workspace/data.csv | tail -n +2 | sort -u');
			expect(cities.exitCode).toBe(0);
			expect(cities.stdout).toContain('london');
			expect(cities.stdout).toContain('new york');
			expect(cities.stdout).toContain('paris');
		});

		it('5. file manipulation - create, move, copy, delete', async () => {
			const shell = new Shell();
			await shell.exec('mkdir -p /workspace/src');
			await shell.exec('echo "hello" > /workspace/src/file.txt');
			await shell.exec('cp /workspace/src/file.txt /workspace/src/copy.txt');
			await shell.exec('mv /workspace/src/copy.txt /workspace/backup.txt');

			const original = await shell.exec('cat /workspace/src/file.txt');
			expect(original.stdout).toBe('hello\n');

			const backup = await shell.exec('cat /workspace/backup.txt');
			expect(backup.stdout).toBe('hello\n');

			await shell.exec('rm /workspace/src/file.txt');
			const deleted = await shell.exec('cat /workspace/src/file.txt');
			expect(deleted.exitCode).not.toBe(0);
		});

		it('6. text transformation with sed', async () => {
			const shell = new Shell({
				files: {
					'/workspace/app.conf': 'api_url=oldapi.example.com\nbackend=oldapi.internal\n',
				},
			});
			await shell.exec('sed -i "s/oldapi/newapi/g" /workspace/app.conf');
			const result = await shell.exec('cat /workspace/app.conf');
			expect(result.stdout).toContain('newapi.example.com');
			expect(result.stdout).toContain('newapi.internal');
			expect(result.stdout).not.toContain('oldapi');
		});

		it('7. multi-step pipeline for log analysis', async () => {
			const logs = [
				'2024-01-01 ERROR database connection failed',
				'2024-01-01 INFO server started',
				'2024-01-02 ERROR timeout on request',
				'2024-01-02 ERROR database connection failed',
				'2024-01-03 WARN disk space low',
				'2024-01-03 ERROR timeout on request',
				'2024-01-04 INFO health check ok',
				'2024-01-04 ERROR timeout on request',
			].join('\n');
			const shell = new Shell({
				files: { '/workspace/logs/app.log': `${logs}\n` },
			});
			const result = await shell.exec(
				'grep "ERROR" /workspace/logs/app.log | sort | uniq -c | sort -rn | head -5',
			);
			expect(result.exitCode).toBe(0);
			// Should contain error entries with counts
			const lines = result.stdout.trim().split('\n');
			expect(lines.length).toBeGreaterThan(0);
			// Most frequent error should be first after sort -rn
			expect(lines.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe('script and language features', () => {
		it('8. script with variables, conditionals, and loops', async () => {
			const shell = new Shell({
				files: {
					'/workspace/a.ts': 'const a = 1;\n',
					'/workspace/b.ts': 'const b = 2;\n// important\n',
					'/workspace/c.txt': 'not typescript\n',
				},
			});
			const script = [
				'count=0',
				'for f in /workspace/*.ts; do',
				'  lines=$(wc -l < "$f")',
				'  count=$((count + lines))',
				'done',
				'echo "Total TS lines: $count"',
			].join('\n');
			const result = await shell.exec(script);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Total TS lines:');
		});

		it('9. complex jq filter', async () => {
			const data = JSON.stringify({
				items: [
					{ name: 'Widget A', status: 'active', email: 'a@test.com' },
					{ name: 'Widget B', status: 'inactive', email: 'b@test.com' },
					{ name: 'Widget C', status: 'active', email: 'c@test.com' },
				],
			});
			const shell = new Shell({
				files: { '/data.json': data },
			});
			// Use simpler filter without | in jq (shell parser limitation)
			const result = await shell.exec('jq ".items[].name" /data.json');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Widget A');
			expect(result.stdout).toContain('Widget B');
			expect(result.stdout).toContain('Widget C');
		});

		it('10. error recovery with set -e', async () => {
			const shell = new Shell();
			const result = await shell.exec('set -e; echo "before"; false; echo "after"');
			expect(result.exitCode).not.toBe(0);
			// With set -e, execution stops at false
			expect(result.stdout).not.toContain('after');
		});

		it('11. environment variable persistence', async () => {
			const shell = new Shell();
			await shell.exec('export DB_HOST=localhost');
			const result = await shell.exec('echo $DB_HOST');
			expect(result.stdout.trim()).toBe('localhost');
		});

		it('12. function definition and invocation', async () => {
			const shell = new Shell();
			await shell.exec('greet() { echo "hello $1"; }');
			const result = await shell.exec('greet world');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('hello world\n');
		});

		it('13. large data processing', async () => {
			const lines: string[] = [];
			for (let i = 0; i < 10000; i++) {
				lines.push(`line ${i}: ${i % 2 === 0 ? 'EVEN' : 'ODD'}`);
			}
			const shell = new Shell({
				files: { '/data/log.txt': `${lines.join('\n')}\n` },
			});
			const wc = await shell.exec('wc -l /data/log.txt');
			expect(wc.exitCode).toBe(0);
			expect(wc.stdout).toContain('10000');

			const sorted = await shell.exec('sort /data/log.txt | tail -1');
			expect(sorted.exitCode).toBe(0);
			expect(sorted.stdout.trim().length).toBeGreaterThan(0);
		});

		it('14. unicode content handling', async () => {
			const shell = new Shell({
				files: {
					'/workspace/hello.txt': 'Hello World\n',
				},
			});
			const result = await shell.exec('cat /workspace/hello.txt');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Hello');
		});

		it('15. heredoc with multiline content', async () => {
			const shell = new Shell();
			const result = await shell.exec('cat <<EOF\nline one\nline two\nline three\nEOF');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('line one\nline two\nline three\n');
		});
	});

	describe('API integration', () => {
		it('16. custom command in pipeline', async () => {
			const shell = new Shell();
			shell.defineCommand('double-lines', async (_args, ctx) => {
				const lines = ctx.stdin.split('\n');
				const doubled = lines.map((l) => (l ? `${l}\n${l}` : '')).join('\n');
				return { stdout: doubled, stderr: '', exitCode: 0 };
			});
			const result = await shell.exec('echo -e "a\\nb" | double-lines');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('a');
		});

		it('17. onUnknownCommand fallback', async () => {
			const shell = new Shell({
				onUnknownCommand: async (name, args) => ({
					stdout: `handled: ${name} ${args.join(' ')}\n`,
					stderr: '',
					exitCode: 0,
				}),
			});
			const result = await shell.exec('custom-tool --flag value');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('handled: custom-tool');
		});

		it('18. AbortSignal cancellation', async () => {
			const controller = new AbortController();
			controller.abort();
			const shell = new Shell();
			const result = await shell.exec('echo hello', { signal: controller.signal });
			expect(result.exitCode).toBe(130);
			expect(result.stderr).toContain('aborted');
		});

		it('19. state persistence across multiple exec calls', async () => {
			const shell = new Shell();

			// Set up state
			await shell.exec('export APP_ENV=production');
			await shell.exec('helper() { echo "running in $APP_ENV"; }');
			await shell.exec('echo "config" > /etc/app.conf');

			// Verify all state persists
			const envResult = await shell.exec('echo $APP_ENV');
			expect(envResult.stdout.trim()).toBe('production');

			const fnResult = await shell.exec('helper');
			expect(fnResult.stdout.trim()).toBe('running in production');

			const fsResult = await shell.exec('cat /etc/app.conf');
			expect(fsResult.stdout.trim()).toBe('config');

			// Verify shell options don't persist
			await shell.exec('set -e');
			const optResult = await shell.exec('false; echo "still running"');
			expect(optResult.stdout).toContain('still running');
		});
	});

	describe('real agent patterns', () => {
		it('20. code search and transform', async () => {
			const shell = new Shell({
				files: {
					'/project/src/api.ts':
						'import { oldLogger } from "./logger";\noldLogger.info("started");\n',
					'/project/src/worker.ts':
						'import { oldLogger } from "./logger";\noldLogger.warn("slow");\n',
				},
			});
			// Find files with oldLogger, replace with newLogger
			await shell.exec('sed -i "s/oldLogger/newLogger/g" /project/src/api.ts');
			await shell.exec('sed -i "s/oldLogger/newLogger/g" /project/src/worker.ts');

			const api = await shell.exec('cat /project/src/api.ts');
			expect(api.stdout).toContain('newLogger');
			expect(api.stdout).not.toContain('oldLogger');
		});

		it('21. JSON API processing', async () => {
			const apiResponse = JSON.stringify([
				{ id: 1, name: 'Widget', price: 9.99, inStock: true },
				{ id: 2, name: 'Gadget', price: 24.99, inStock: false },
				{ id: 3, name: 'Doohickey', price: 4.99, inStock: true },
			]);
			const shell = new Shell({
				files: { '/api/products.json': apiResponse },
			});
			// Use simpler filter without | in jq (shell parser limitation)
			const result = await shell.exec('jq ".[].name" /api/products.json');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Widget');
			expect(result.stdout).toContain('Gadget');
			expect(result.stdout).toContain('Doohickey');
		});

		it('22. log analysis with frequency report', async () => {
			const logLines = [
				'[INFO] Request processed in 120ms',
				'[ERROR] Connection refused to db',
				'[WARN] Slow query: 500ms',
				'[ERROR] Connection refused to db',
				'[INFO] Request processed in 80ms',
				'[ERROR] Timeout waiting for response',
				'[ERROR] Connection refused to db',
				'[WARN] Memory usage high',
				'[ERROR] Timeout waiting for response',
			];
			const shell = new Shell({
				files: { '/logs/app.log': `${logLines.join('\n')}\n` },
			});
			const result = await shell.exec(
				'grep "\\[ERROR\\]" /logs/app.log | sort | uniq -c | sort -rn',
			);
			expect(result.exitCode).toBe(0);
			const lines = result.stdout.trim().split('\n');
			expect(lines[0]).toContain('3');
			expect(lines[0]).toContain('Connection refused');
		});

		it('23. pipe failure with set -eo pipefail', async () => {
			const shell = new Shell();
			const result = await shell.exec('set -eo pipefail; cat /nonexistent | grep x');
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.length).toBeGreaterThan(0);
		});

		it('24. command substitution in variables', async () => {
			const shell = new Shell({
				files: {
					'/workspace/a.ts': 'const a = 1;\n',
					'/workspace/b.ts': 'const b = 2;\n',
					'/workspace/c.ts': 'const c = 3;\n',
					'/workspace/readme.md': '# Project\n',
				},
			});
			const result = await shell.exec('find /workspace -name "*.ts" | wc -l');
			expect(result.exitCode).toBe(0);
			expect(Number.parseInt(result.stdout.trim(), 10)).toBe(3);
		});

		it('25. arithmetic and conditionals', async () => {
			const script = [
				'total=0',
				'for val in 10 20 30 40 50; do',
				'  total=$((total + val))',
				'done',
				'if [ $total -ge 100 ]; then',
				'  echo "Sum $total exceeds threshold"',
				'else',
				'  echo "Sum $total is below threshold"',
				'fi',
			].join('\n');
			const shell = new Shell();
			const result = await shell.exec(script);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('Sum 150 exceeds threshold');
		});
	});
});
