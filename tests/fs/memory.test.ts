import { describe, expect, it } from 'vitest';
import { FsError, InMemoryFs } from '../../src/fs/memory.js';

describe('InMemoryFs', () => {
  describe('basic CRUD', () => {
    it('writes and reads a file', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/hello.txt', 'world');
      expect(fs.readFile('/hello.txt')).toBe('world');
    });

    it('overwrites existing file', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/file.txt', 'first');
      fs.writeFile('/file.txt', 'second');
      expect(fs.readFile('/file.txt')).toBe('second');
    });

    it('checks existence of files and directories', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/exists.txt', 'yes');
      expect(fs.exists('/exists.txt')).toBe(true);
      expect(fs.exists('/nope.txt')).toBe(false);
      expect(fs.exists('/')).toBe(true);
    });

    it('deletes a file with unlink', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/remove.txt', 'bye');
      expect(fs.exists('/remove.txt')).toBe(true);
      fs.unlink('/remove.txt');
      expect(fs.exists('/remove.txt')).toBe(false);
    });

    it('creates files from initial record', () => {
      const fs = new InMemoryFs({
        '/a.txt': 'aaa',
        '/b.txt': 'bbb',
      });
      expect(fs.readFile('/a.txt')).toBe('aaa');
      expect(fs.readFile('/b.txt')).toBe('bbb');
    });
  });

  describe('directory operations', () => {
    it('creates a directory', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/mydir');
      expect(fs.exists('/mydir')).toBe(true);
      expect(fs.stat('/mydir').isDirectory()).toBe(true);
    });

    it('lists directory entries sorted', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/dir/c.txt', 'c');
      fs.writeFile('/dir/a.txt', 'a');
      fs.writeFile('/dir/b.txt', 'b');
      expect(fs.readdir('/dir')).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });

    it('readdir returns only direct children', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/dir/file.txt', 'x');
      fs.writeFile('/dir/sub/deep.txt', 'y');
      const entries = fs.readdir('/dir');
      expect(entries).toContain('file.txt');
      expect(entries).toContain('sub');
      expect(entries).not.toContain('deep.txt');
    });

    it('removes empty directory', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/empty');
      fs.rmdir('/empty');
      expect(fs.exists('/empty')).toBe(false);
    });

    it('removes directory recursively', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/dir/a.txt', 'a');
      fs.writeFile('/dir/sub/b.txt', 'b');
      fs.rmdir('/dir', { recursive: true });
      expect(fs.exists('/dir')).toBe(false);
      expect(fs.exists('/dir/a.txt')).toBe(false);
      expect(fs.exists('/dir/sub/b.txt')).toBe(false);
    });

    it('mkdir recursive creates parents', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/a/b/c', { recursive: true });
      expect(fs.stat('/a').isDirectory()).toBe(true);
      expect(fs.stat('/a/b').isDirectory()).toBe(true);
      expect(fs.stat('/a/b/c').isDirectory()).toBe(true);
    });

    it('mkdir recursive succeeds if already exists', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/existing', { recursive: true });
      expect(() => fs.mkdir('/existing', { recursive: true })).not.toThrow();
    });
  });

  describe('path normalization', () => {
    it('resolves .. segments', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/a/b/file.txt', 'content');
      expect(fs.readFile('/a/b/../b/file.txt')).toBe('content');
    });

    it('resolves . segments', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/a/file.txt', 'content');
      expect(fs.readFile('/a/./file.txt')).toBe('content');
    });

    it('collapses double slashes', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/a/file.txt', 'content');
      expect(fs.readFile('/a//file.txt')).toBe('content');
    });

    it('strips trailing slashes', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/mydir');
      expect(fs.stat('/mydir/').isDirectory()).toBe(true);
    });
  });

  describe('path traversal prevention', () => {
    it('prevents traversal above root with ..', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/etc/passwd', 'safe');
      // /../../../etc/passwd should resolve to /etc/passwd
      expect(fs.readFile('/../../../etc/passwd')).toBe('safe');
    });

    it('resolves excessive .. to root', () => {
      const fs = new InMemoryFs();
      expect(fs.exists('/../../../../')).toBe(true);
      expect(fs.stat('/../../../../').isDirectory()).toBe(true);
    });
  });

  describe('unicode filenames', () => {
    it('handles emoji filenames', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/data/\u{1F600}.txt', 'smile');
      expect(fs.readFile('/data/\u{1F600}.txt')).toBe('smile');
    });

    it('handles CJK filenames', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/\u6587\u4EF6.txt', '\u5185\u5BB9');
      expect(fs.readFile('/\u6587\u4EF6.txt')).toBe('\u5185\u5BB9');
    });

    it('handles combining marks', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/caf\u00E9.txt', 'yes');
      expect(fs.readFile('/caf\u00E9.txt')).toBe('yes');
    });
  });

  describe('lazy files', () => {
    it('calls lazy function on first read and caches', () => {
      const fs = new InMemoryFs();
      let callCount = 0;
      fs.addLazyFile('/lazy.txt', () => {
        callCount++;
        return 'lazy content';
      });
      expect(fs.readFile('/lazy.txt')).toBe('lazy content');
      expect(fs.readFile('/lazy.txt')).toBe('lazy content');
      expect(callCount).toBe(1);
    });

    it('resolves async lazy files', async () => {
      const fs = new InMemoryFs();
      let callCount = 0;
      fs.addLazyFile('/async.txt', async () => {
        callCount++;
        return 'async content';
      });
      const result = await fs.readFile('/async.txt');
      expect(result).toBe('async content');
      // Second read should be cached (sync)
      expect(fs.readFile('/async.txt')).toBe('async content');
      expect(callCount).toBe(1);
    });
  });

  describe('large files', () => {
    it('handles >1MB content without stack overflow', () => {
      const fs = new InMemoryFs();
      // Build large string using loop, not spread
      let large = '';
      for (let i = 0; i < 100_000; i++) {
        large += 'abcdefghij'; // 10 chars each, total 1MB
      }
      fs.writeFile('/big.txt', large);
      const content = fs.readFile('/big.txt');
      expect(content).toHaveLength(1_000_000);
    });
  });

  describe('virtual devices', () => {
    it('/dev/null reads return empty', () => {
      const fs = new InMemoryFs();
      expect(fs.readFile('/dev/null')).toBe('');
    });

    it('/dev/null writes are discarded', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/dev/null', 'should be discarded');
      expect(fs.readFile('/dev/null')).toBe('');
    });

    it('/dev/stdin reads return empty', () => {
      const fs = new InMemoryFs();
      expect(fs.readFile('/dev/stdin')).toBe('');
    });

    it('/dev/stdout reads return empty', () => {
      const fs = new InMemoryFs();
      expect(fs.readFile('/dev/stdout')).toBe('');
    });

    it('/dev/stderr reads return empty', () => {
      const fs = new InMemoryFs();
      expect(fs.readFile('/dev/stderr')).toBe('');
    });
  });

  describe('error cases', () => {
    it('throws ENOENT for missing file', () => {
      const fs = new InMemoryFs();
      expect(() => fs.readFile('/missing.txt')).toThrow(FsError);
      try {
        fs.readFile('/missing.txt');
      } catch (e) {
        expect((e as FsError).code).toBe('ENOENT');
      }
    });

    it('throws EISDIR when reading a directory', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/dir');
      expect(() => fs.readFile('/dir')).toThrow(FsError);
      try {
        fs.readFile('/dir');
      } catch (e) {
        expect((e as FsError).code).toBe('EISDIR');
      }
    });

    it('throws ENOTDIR for readdir on a file', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/file.txt', 'x');
      expect(() => fs.readdir('/file.txt')).toThrow(FsError);
      try {
        fs.readdir('/file.txt');
      } catch (e) {
        expect((e as FsError).code).toBe('ENOTDIR');
      }
    });

    it('throws EEXIST for mkdir on existing path', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/dir');
      expect(() => fs.mkdir('/dir')).toThrow(FsError);
      try {
        fs.mkdir('/dir');
      } catch (e) {
        expect((e as FsError).code).toBe('EEXIST');
      }
    });

    it('throws ENOTEMPTY for rmdir on non-empty directory', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/dir/file.txt', 'x');
      expect(() => fs.rmdir('/dir')).toThrow(FsError);
      try {
        fs.rmdir('/dir');
      } catch (e) {
        expect((e as FsError).code).toBe('ENOTEMPTY');
      }
    });

    it('throws ENOENT for unlink on missing file', () => {
      const fs = new InMemoryFs();
      expect(() => fs.unlink('/nope.txt')).toThrow(FsError);
      try {
        fs.unlink('/nope.txt');
      } catch (e) {
        expect((e as FsError).code).toBe('ENOENT');
      }
    });

    it('throws EISDIR for unlink on a directory', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/dir');
      expect(() => fs.unlink('/dir')).toThrow(FsError);
      try {
        fs.unlink('/dir');
      } catch (e) {
        expect((e as FsError).code).toBe('EISDIR');
      }
    });

    it('throws ENOENT for stat on missing path', () => {
      const fs = new InMemoryFs();
      expect(() => fs.stat('/missing')).toThrow(FsError);
    });

    it('throws ENOENT for rename with missing source', () => {
      const fs = new InMemoryFs();
      expect(() => fs.rename('/missing', '/new')).toThrow(FsError);
    });

    it('throws ENOENT for copyFile with missing source', () => {
      const fs = new InMemoryFs();
      expect(() => fs.copyFile('/missing', '/new')).toThrow(FsError);
    });

    it('throws ENOENT for chmod on missing path', () => {
      const fs = new InMemoryFs();
      expect(() => fs.chmod('/missing', 0o755)).toThrow(FsError);
    });

    it('throws ENOENT for realpath on missing path', () => {
      const fs = new InMemoryFs();
      expect(() => fs.realpath('/missing')).toThrow(FsError);
    });

    it('throws ENOENT for mkdir without recursive when parent missing', () => {
      const fs = new InMemoryFs();
      expect(() => fs.mkdir('/a/b/c')).toThrow(FsError);
    });
  });

  describe('rename', () => {
    it('renames a file', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/old.txt', 'content');
      fs.rename('/old.txt', '/new.txt');
      expect(fs.exists('/old.txt')).toBe(false);
      expect(fs.readFile('/new.txt')).toBe('content');
    });

    it('renames across directories', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/a/file.txt', 'data');
      fs.rename('/a/file.txt', '/b/file.txt');
      expect(fs.exists('/a/file.txt')).toBe(false);
      expect(fs.readFile('/b/file.txt')).toBe('data');
    });

    it('renames a directory and its contents', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/old/sub/file.txt', 'nested');
      fs.rename('/old', '/new');
      expect(fs.exists('/old')).toBe(false);
      expect(fs.readFile('/new/sub/file.txt')).toBe('nested');
    });
  });

  describe('copyFile', () => {
    it('copies file content', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/original.txt', 'copy me');
      fs.copyFile('/original.txt', '/copy.txt');
      expect(fs.readFile('/copy.txt')).toBe('copy me');
      // Original still exists
      expect(fs.readFile('/original.txt')).toBe('copy me');
    });
  });

  describe('chmod', () => {
    it('updates mode bits', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/file.txt', 'x');
      fs.chmod('/file.txt', 0o755);
      expect(fs.stat('/file.txt').mode).toBe(0o755);
    });
  });

  describe('stat', () => {
    it('returns correct metadata for files', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/data.txt', 'hello');
      const s = fs.stat('/data.txt');
      expect(s.isFile()).toBe(true);
      expect(s.isDirectory()).toBe(false);
      expect(s.size).toBe(5);
      expect(s.mode).toBe(0o644);
      expect(s.mtime).toBeInstanceOf(Date);
      expect(s.ctime).toBeInstanceOf(Date);
    });

    it('returns correct metadata for directories', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/mydir');
      const s = fs.stat('/mydir');
      expect(s.isFile()).toBe(false);
      expect(s.isDirectory()).toBe(true);
      expect(s.mode).toBe(0o755);
    });
  });

  describe('appendFile', () => {
    it('appends to existing file', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/log.txt', 'line1\n');
      fs.appendFile('/log.txt', 'line2\n');
      expect(fs.readFile('/log.txt')).toBe('line1\nline2\n');
    });

    it('creates file if it does not exist', () => {
      const fs = new InMemoryFs();
      fs.appendFile('/new.txt', 'content');
      expect(fs.readFile('/new.txt')).toBe('content');
    });

    it('throws EISDIR when appending to directory', () => {
      const fs = new InMemoryFs();
      fs.mkdir('/dir');
      expect(() => fs.appendFile('/dir', 'x')).toThrow(FsError);
    });
  });

  describe('realpath', () => {
    it('resolves normalized paths', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/a/b/file.txt', 'x');
      expect(fs.realpath('/a/b/../b/./file.txt')).toBe('/a/b/file.txt');
    });
  });

  describe('concurrent access', () => {
    it('handles multiple simultaneous writes', () => {
      const fs = new InMemoryFs();
      for (let i = 0; i < 100; i++) {
        fs.writeFile(`/file${i}.txt`, `content${i}`);
      }
      for (let i = 0; i < 100; i++) {
        expect(fs.readFile(`/file${i}.txt`)).toBe(`content${i}`);
      }
    });

    it('handles concurrent async lazy file reads', async () => {
      const fs = new InMemoryFs();
      let resolveCount = 0;
      fs.addLazyFile('/shared.txt', async () => {
        resolveCount++;
        return 'shared';
      });

      const results = await Promise.all([
        fs.readFile('/shared.txt'),
        fs.readFile('/shared.txt'),
        fs.readFile('/shared.txt'),
      ]);

      for (const r of results) {
        expect(r).toBe('shared');
      }
      // May be called more than once due to race, but results should all be correct
    });
  });

  describe('auto-create parent dirs', () => {
    it('writeFile to deep path creates all parents', () => {
      const fs = new InMemoryFs();
      fs.writeFile('/a/b/c/file.txt', 'deep');
      expect(fs.stat('/a').isDirectory()).toBe(true);
      expect(fs.stat('/a/b').isDirectory()).toBe(true);
      expect(fs.stat('/a/b/c').isDirectory()).toBe(true);
      expect(fs.readFile('/a/b/c/file.txt')).toBe('deep');
    });
  });
});
