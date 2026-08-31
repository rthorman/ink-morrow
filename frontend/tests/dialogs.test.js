
import { loadScript, mockFetch } from './dom-helpers.js';

function dialogEl() {
  return document.querySelector('.dialog-manager');
}

function buttons() {
  return [...dialogEl().querySelectorAll('button')];
}

function press(key, opts = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
}

describe('Shared dialog manager', () => {
  let fw;

  beforeEach(async () => {
    mockFetch();
    fw = await loadScript();
  });

  it('destructive dialog names the object and count; confirm resolves true', async () => {
    const pending = fw.dialogs.confirmDestructive({
      title: 'Delete 4 later pages?',
      body: 'Pages 9–12 of "The Ashen Marches" will be permanently removed.',
      confirmLabel: 'Delete 4 pages',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(dialogEl().hidden).toBe(false);
    expect(dialogEl().querySelector('.dialog-manager__title').textContent).toBe('Delete 4 later pages?');
    expect(dialogEl().querySelector('.dialog-manager__body').textContent).toContain('Pages 9–12');
    const confirmBtn = buttons().find((b) => b.textContent === 'Delete 4 pages');
    expect(confirmBtn.className).toContain('btn-danger');
    confirmBtn.click();
    expect(await pending).toBe(true);
    expect(dialogEl().hidden).toBe(true);
  });

  it('cancel resolves false and nothing else fires', async () => {
    const pending = fw.dialogs.confirmDestructive({
      title: 'Delete world "X"?',
      body: 'It goes.',
      confirmLabel: 'Delete world',
    });
    await new Promise((r) => setTimeout(r, 0));
    buttons().find((b) => b.textContent === 'Cancel').click();
    expect(await pending).toBe(false);
    expect(dialogEl().hidden).toBe(true);
  });

  it('paid review carries the price on the confirm button', async () => {
    const pending = fw.dialogs.confirmPaid({
      title: 'Paint this scene?',
      body: 'Grok Imagine · 1K · ≈$0.04',
      confirmLabel: 'Paint scene (≈$0.04)',
    });
    await new Promise((r) => setTimeout(r, 0));
    const confirmBtn = buttons().find((b) => b.textContent === 'Paint scene (≈$0.04)');
    expect(confirmBtn.className).toContain('btn-primary');
    confirmBtn.click();
    expect(await pending).toBe(true);
  });

  it('a disabled paid action cannot confirm', async () => {
    const pending = fw.dialogs.confirmPaid({
      title: 'Create audiobook?',
      body: 'Approximate cost: $0.05.',
      confirmLabel: 'Create audiobook',
      disabled: true,
    });
    await new Promise((r) => setTimeout(r, 0));
    const confirmBtn = buttons().find((b) => b.textContent === 'Create audiobook');
    expect(confirmBtn.disabled).toBe(true);
    confirmBtn.click(); // a disabled button click is a no-op by platform rules
    await new Promise((r) => setTimeout(r, 0));
    expect(dialogEl().hidden).toBe(false); // still open
    buttons().find((b) => b.textContent === 'Cancel').click();
    expect(await pending).toBe(false);
  });

  it('traps Tab focus inside the dialog and restores the opener on close', async () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fw.dialogs.confirmDestructive({ title: 'Delete?', body: 'x', confirmLabel: 'Delete' });
    await new Promise((r) => setTimeout(r, 0));

    // Focus starts inside the dialog (the panel or first control)
    expect(dialogEl().contains(document.activeElement)).toBe(true);

    // Tab cycles within the dialog: from last button it wraps to the first
    const btns = buttons();
    btns[btns.length - 1].focus();
    press('Tab');
    expect(document.activeElement).toBe(btns[0]);

    // Shift+Tab from the first wraps to the last
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(btns[btns.length - 1]);

    // Escape closes and focus returns to the opener
    press('Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(dialogEl().hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('a dirty dialog asks before Escape closes it, then discards on demand', async () => {
    let dirty = true;
    fw.dialogs.openDialog({
      title: 'Edit something',
      body: 'draft work',
      dirty: () => dirty,
      actions: [{ label: 'Close', className: 'btn-secondary' }],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(dialogEl().hidden).toBe(false);

    press('Escape');
    await new Promise((r) => setTimeout(r, 0));
    // The dirty guard opened a discard confirmation INSTEAD of closing
    expect(dialogEl().querySelector('.dialog-manager__title').textContent).toContain('Discard');
    expect(dialogEl().hidden).toBe(false);

    // Confirming the discard closes everything
    buttons().find((b) => b.textContent === 'Discard changes').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(dialogEl().hidden).toBe(true);

    // A clean dialog closes immediately on Escape
    dirty = false;
    fw.dialogs.openDialog({ title: 'Clean', body: 'no draft' });
    await new Promise((r) => setTimeout(r, 0));
    press('Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(dialogEl().hidden).toBe(true);
  });

  it('locks body scroll while open and unlocks on close', async () => {
    fw.dialogs.openDialog({ title: 'Scroll lock', body: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.style.overflow).toBe('hidden');
    fw.dialogs.close(true);
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('Paid review (structured grammar)', () => {
  it('renders left-structured rows, carries the estimate, and explains one-time consent', async () => {
    window.localStorage.clear();
    mockFetch();
    const fw = await loadScript();
    const pending = fw.dialogs.confirmPaid({
      title: 'Send this to the paid scribe?',
      review: {
        action: 'Write page 2.',
        object: '"T", new page 2',
        model: 'x-model',
        quantity: '≈400 words',
        sends: 'your direction and the tale so far',
        also: 'prepare the next page (≈$0.01)',
        estimate: 0.03,
        maximum: 0.09,
      },
      confirmLabel: 'Write it (≈$0.0300)',
    });
    await new Promise((r) => setTimeout(r, 0));
    const dlg = document.querySelector('.dialog-manager');
    expect(dlg.hidden).toBe(false);
    const body = dlg.querySelector('.dialog-manager__body').textContent;
    expect(body).toContain('Write page 2.');
    expect(body).toContain('"T", new page 2');
    expect(body).toContain('x-model');
    expect(body).toContain('≈400 words');
    expect(body).toContain('prepare the next page (≈$0.01)');
    expect(body).toContain('Est. cost');
    expect(body).toContain('≈$0.0300');
    expect(body).toContain('Retry ceiling');
    expect(body).toContain('≈$0.0900');
    expect(body).toContain('Approve once');
    expect(body).toContain('Future paid actions run without another approval');
    expect(dlg.querySelectorAll('.review-list dt')).toHaveLength(7);
    expect(dlg.querySelectorAll('.review-list dd')).toHaveLength(7);
    const confirm = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Write it (≈$0.0300)');
    expect(confirm).toBeTruthy();
    confirm.click();
    expect(await pending).toBe(true);
    expect(window.localStorage.getItem('st-paid-consent-v1')).toBe('1');
  });

  it('uses a rough ballpark when catalogue pricing is missing', async () => {
    window.localStorage.clear();
    mockFetch();
    const fw = await loadScript();
    const pending = fw.dialogs.confirmPaid({
      title: 'Draft it?',
      review: { action: 'Draft a world.', estimate: null },
      confirmLabel: 'Draft it (rough estimate)',
    });
    await new Promise((r) => setTimeout(r, 0));
    const body = document.querySelector('.dialog-manager__body').textContent;
    expect(body).toContain('≈$0.0500 (rough ballpark)');
    expect(body).not.toMatch(/unknown|unavailable/i);
    document.querySelector('.dialog-manager .btn-secondary').click();
    expect(await pending).toBe(false);
    expect(window.localStorage.getItem('st-paid-consent-v1')).toBeNull();
  });

  it('bypasses every later review, including after a fresh app boot', async () => {
    window.localStorage.clear();
    mockFetch();
    let fw = await loadScript();
    const first = fw.dialogs.confirmPaid({
      title: 'First paid action?',
      review: { action: 'Write a page.', estimate: 0.02 },
      confirmLabel: 'Write it',
    });
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector('.dialog-manager .btn-primary').click();
    expect(await first).toBe(true);

    const second = fw.dialogs.confirmPaid({
      title: 'Second paid action?',
      review: { action: 'Write another page.', estimate: 0.02 },
      confirmLabel: 'Write it',
    });
    expect(await second).toBe(true);
    expect(document.querySelector('.dialog-manager').hidden).toBe(true);

    mockFetch();
    fw = await loadScript({ preservePaidConsent: true });
    expect(fw.dialogs.hasPaidConsent()).toBe(true);
    const afterReload = fw.dialogs.confirmPaid({
      title: 'Paid action after reload?',
      review: { action: 'Write again.', estimate: 0.02 },
      confirmLabel: 'Write it',
    });
    expect(await afterReload).toBe(true);
    expect(document.querySelector('.dialog-manager')).toBeNull();
  });
});
