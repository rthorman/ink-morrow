'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

describe('Disk-space banner', () => {
  let fw;

  beforeEach(() => {
    mockFetch();
    fw = loadScript();
  });

  function banner() {
    return {
      el: document.getElementById('diskBanner'),
      text: document.getElementById('diskBannerText').textContent,
      hidden: document.getElementById('diskBanner').hidden,
    };
  }

  it('stays hidden while storage is ample', () => {
    fw.updateDiskBanner({ free_bytes: 23.7 * 1024 ** 3, total_bytes: 110 * 1024 ** 3 });
    expect(banner().hidden).toBe(true);
  });

  it('warns persistently when free space drops below 1 GB', () => {
    fw.updateDiskBanner({ free_bytes: 812 * 1024 ** 2, total_bytes: 64 * 1024 ** 3 });
    const b = banner();
    expect(b.hidden).toBe(false);
    expect(b.text).toContain('running low');
    expect(b.text).toContain('812 MB');
    // Persistent: it only leaves when space actually recovers
    fw.updateDiskBanner({ free_bytes: 812 * 1024 ** 2, total_bytes: 64 * 1024 ** 3 });
    expect(banner().hidden).toBe(false);
    fw.updateDiskBanner({ free_bytes: 5 * 1024 ** 3, total_bytes: 64 * 1024 ** 3 });
    expect(banner().hidden).toBe(true);
  });

  it('flags a nearly-empty volume even when the absolute number is large', () => {
    fw.updateDiskBanner({ free_bytes: 100 * 1024 ** 3, total_bytes: 4 * 1024 ** 4 }); // 2.4% of 4 TB
    expect(banner().hidden).toBe(false);
    expect(banner().text).toContain('running low');
    expect(banner().text).toContain('100.0 GB');
  });

  it('escalates the wording when the disk is almost full', () => {
    fw.updateDiskBanner({ free_bytes: 200 * 1024 ** 2, total_bytes: 64 * 1024 ** 3 });
    const b = banner();
    expect(b.hidden).toBe(false);
    expect(b.text).toContain('almost full');
    expect(b.text).toContain('200 MB');
  });

  it('hides when the filesystem stays silent (nulls), never nags on unknowns', () => {
    fw.updateDiskBanner({ free_bytes: null, total_bytes: null });
    expect(banner().hidden).toBe(true);
  });

  it('checks the live endpoint on demand and after plates are bound', async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes('/disk')) {
        return Promise.resolve(jsonResponse(200, { free_bytes: 700 * 1024 ** 2, total_bytes: 64 * 1024 ** 3 }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    await fw.checkDiskSpace();
    await new Promise((r) => setTimeout(r, 0));
    expect(banner().hidden).toBe(false);
    expect(banner().text).toContain('700 MB');

    // The endpoint failing changes nothing (server trouble is reported elsewhere)
    fetch.mockImplementation(() => Promise.resolve(jsonResponse(500, { error: 'no' })));
    await fw.checkDiskSpace();
    await new Promise((r) => setTimeout(r, 0));
    expect(banner().hidden).toBe(false); // keeps its last honest state
  });
});
