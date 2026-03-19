import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Shell } from '../../src/index.js';
import { OverlayFs } from '../../src/overlay/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
  // Create known files on host
  fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello from host');
  fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"key":"value"}');
  fs.mkdirSync(path.join(tmpDir, 'subdir'));
  fs.writeFileSync(path.join(tmpDir, 'subdir', 'nested.txt'), 'nested content');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('OverlayFs', () => {
  describe('readFile', () => {
    it('reads real file from host', () => {
      const overlay = new OverlayFs(tmpDir);
      expect(overlay.readFile('/hello.txt')).toBe('hello from host');
    });

    it('reads nested files', () => {
      const overlay = new OverlayFs(tmpDir);
      expect(overlay.readFile('/subdir/nested.txt')).toBe('nested content');
    });
  });

  describe('writeFile', () => {
    it('writes to memory, does not modify host', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/hello.txt', 'modified');
      expect(overlay.readFile('/hello.txt')).toBe('modified');
      // Host unchanged
      expect(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8')).toBe('hello from host');
    });

    it('returns memory content after write', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/new-file.txt', 'new content');
      expect(overlay.readFile('/new-file.txt')).toBe('new content');
    });
  });

  describe('unlink', () => {
    it('makes host file inaccessible', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.unlink('/hello.txt');
      expect(() => overlay.readFile('/hello.txt')).toThrow();
      // Host unchanged
      expect(fs.existsSync(path.join(tmpDir, 'hello.txt'))).toBe(true);
    });
  });

  describe('readdir', () => {
    it('merges host and memory entries', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/memory-only.txt', 'in memory');
      const entries = overlay.readdir('/');
      expect(entries).toContain('hello.txt');
      expect(entries).toContain('memory-only.txt');
      expect(entries).toContain('subdir');
    });

    it('excludes deleted files', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.unlink('/hello.txt');
      const entries = overlay.readdir('/');
      expect(entries).not.toContain('hello.txt');
      expect(entries).toContain('config.json');
    });

    it('has no duplicates', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/hello.txt', 'overwritten');
      const entries = overlay.readdir('/');
      const helloCount = entries.filter((e: string) => e === 'hello.txt').length;
      expect(helloCount).toBe(1);
    });
  });

  describe('mkdir', () => {
    it('creates directory recursively with mixed parents', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.mkdir('/subdir/deep/nested', { recursive: true });
      expect(overlay.exists('/subdir/deep/nested')).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns true for host files', () => {
      const overlay = new OverlayFs(tmpDir);
      expect(overlay.exists('/hello.txt')).toBe(true);
    });

    it('returns true for memory files', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/mem.txt', 'data');
      expect(overlay.exists('/mem.txt')).toBe(true);
    });

    it('returns false for deleted files', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.unlink('/hello.txt');
      expect(overlay.exists('/hello.txt')).toBe(false);
    });
  });

  describe('stat', () => {
    it('reports correct type for host file', () => {
      const overlay = new OverlayFs(tmpDir);
      const s = overlay.stat('/hello.txt');
      expect(s.isFile()).toBe(true);
      expect(s.isDirectory()).toBe(false);
    });

    it('reports correct type and size for memory file', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/test.txt', 'abcde');
      const s = overlay.stat('/test.txt');
      expect(s.isFile()).toBe(true);
      expect(s.size).toBe(5);
    });
  });

  describe('getChanges', () => {
    it('tracks created, modified, and deleted files', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.writeFile('/new.txt', 'brand new');
      overlay.writeFile('/hello.txt', 'modified content');
      overlay.unlink('/config.json');

      const changes = overlay.getChanges();
      expect(changes.created).toHaveLength(1);
      expect(changes.created[0].path).toBe('/new.txt');
      expect(changes.created[0].content).toBe('brand new');

      expect(changes.modified).toHaveLength(1);
      expect(changes.modified[0].path).toBe('/hello.txt');
      expect(changes.modified[0].content).toBe('modified content');

      expect(changes.deleted).toContain('/config.json');
    });
  });

  describe('access control', () => {
    it('allowPaths restricts readable paths', () => {
      const overlay = new OverlayFs(tmpDir, { allowPaths: ['/hello.txt'] });
      expect(overlay.readFile('/hello.txt')).toBe('hello from host');
      expect(() => overlay.readFile('/config.json')).toThrow();
    });

    it('denyPaths blocks listed paths', () => {
      const overlay = new OverlayFs(tmpDir, { denyPaths: ['/config.json'] });
      expect(overlay.readFile('/hello.txt')).toBe('hello from host');
      expect(() => overlay.readFile('/config.json')).toThrow();
    });

    it('denyPaths with glob blocks matching files', () => {
      fs.writeFileSync(path.join(tmpDir, 'secret.key'), 'sensitive');
      const overlay = new OverlayFs(tmpDir, { denyPaths: ['*.key'] });
      expect(() => overlay.readFile('/secret.key')).toThrow();
      expect(overlay.readFile('/config.json')).toBe('{"key":"value"}');
    });
  });

  describe('integration with Shell', () => {
    it('works as Shell fs option', async () => {
      const overlay = new OverlayFs(tmpDir);
      const shell = new Shell({ fs: overlay });

      const result = await shell.exec('cat /hello.txt');
      expect(result.stdout).toBe('hello from host');

      await shell.exec('echo "new content" > /output.txt');
      const changes = overlay.getChanges();
      expect(changes.created.some((c) => c.path === '/output.txt')).toBe(true);
    });
  });

  describe('symlinks', () => {
    it('symlink and readlink round-trip in memory', () => {
      const overlay = new OverlayFs(tmpDir);
      overlay.symlink('/hello.txt', '/link.txt');
      expect(overlay.readlink('/link.txt')).toBe('/hello.txt');
    });
  });

  describe('realpath', () => {
    it('rejects paths resolving outside root', () => {
      const overlay = new OverlayFs(tmpDir);
      // Create a symlink on host pointing outside root
      const outsidePath = path.join(os.tmpdir(), 'outside-overlay-test.txt');
      fs.writeFileSync(outsidePath, 'outside');
      try {
        fs.symlinkSync(outsidePath, path.join(tmpDir, 'escape-link'));
        expect(() => overlay.realpath('/escape-link')).toThrow();
      } finally {
        fs.unlinkSync(outsidePath);
        try {
          fs.unlinkSync(path.join(tmpDir, 'escape-link'));
        } catch {
          // may not exist
        }
      }
    });
  });
});
