'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('UI navigation (hash routes)', () => {
  beforeEach(async () => {
    mockFetch(); // loads on init return empty objects - fine for nav
    await loadScript();
  });

  it('starts on Home with the hash set', async () => {
    expect(window.location.hash).toBe('#/home');
    expect(document.getElementById('homeSection').classList.contains('active')).toBe(true);
    expect(document.getElementById('homeBtn').classList.contains('active')).toBe(true);
    expect(document.getElementById('homeBtn').getAttribute('aria-current')).toBe('page');
  });

  it('switches destinations exclusively when nav buttons are clicked', async () => {
    const destinations = [
      ['write', 'writeSection'],
      ['library', 'librarySection'],
      ['worlds', 'worldsSection'],
      ['characters', 'charactersSection'],
    ];
    for (const [btn, section] of destinations) {
      document.getElementById(`${btn}Btn`).click();
      await flush(); // hashchange dispatches async
      expect(document.getElementById(section).classList.contains('active')).toBe(true);
      expect(document.getElementById(`${btn}Btn`).classList.contains('active')).toBe(true);
      for (const [otherBtn, otherSection] of destinations) {
        if (otherBtn === btn) continue;
        expect(document.getElementById(otherSection).classList.contains('active')).toBe(false);
      }
    }
    expect(window.location.hash).toBe('#/characters');
  });

  it('Library tabs follow the route and restore on tab clicks', async () => {
    document.getElementById('libraryBtn').click();
    await flush();
    expect(window.location.hash).toBe('#/library/stories');
    expect(document.getElementById('storiesPanel').hidden).toBe(false);
    expect(document.getElementById('bookshelfPanel').hidden).toBe(true);
    expect(document.getElementById('libraryStoriesTab').getAttribute('aria-selected')).toBe('true');

    document.getElementById('libraryBookshelfTab').click();
    await flush();
    expect(window.location.hash).toBe('#/library/bookshelf');
    expect(document.getElementById('bookshelfPanel').hidden).toBe(false);
    expect(document.getElementById('storiesPanel').hidden).toBe(true);
    expect(document.getElementById('libraryBookshelfTab').getAttribute('aria-selected')).toBe('true');
  });

  it('a deep link restores the surface on load', async () => {
    await loadScript({ hash: '#/settings' });
    expect(window.location.hash).toBe('#/settings');
    expect(document.getElementById('settingsSection').classList.contains('active')).toBe(true);
  });

  it('an invalid hash recovers to Home with a message', async () => {
    window.location.hash = '#/nonsense';
    await flush();
    await flush();
    expect(window.location.hash).toBe('#/home');
    expect(document.getElementById('homeSection').classList.contains('active')).toBe(true);
  });

  it('an unknown story deep-link recovers to the Library with an honest message', async () => {
    mockFetch([
      { match: '/api/stories', response: jsonResponse(200, { stories: [] }) },
    ]);
    window.location.hash = '#/write/does-not-exist';
    await flush();
    await flush();
    await flush();
    expect(window.location.hash).toBe('#/library/stories');
    expect(document.querySelector('.error-message')).toBeTruthy();
    expect(document.querySelector('.error-message').textContent).toContain('could not be found');
  });
});

describe('Generation loading state', () => {
  let fw;

  beforeEach(async () => {
    mockFetch();
    fw = await loadScript();
  });

  it('disables buttons and animates scribe flavor while generating', async () => {
    expect(document.getElementById('generateBtn').disabled).toBe(false);
    fw.setGenerating(true);

    expect(fw.state().generating).toBe(true);
    expect(document.getElementById('generateBtn').disabled).toBe(true);
    expect(document.getElementById('retryBtn').disabled).toBe(true);
    expect(document.getElementById('generateBtn').textContent).toBe('The scribe is writing…');
    expect(fw.SCRIBE_FLAVOR).toContain(document.getElementById('scribeStatus').textContent);

    fw.setGenerating(false);
    expect(fw.state().generating).toBe(false);
    expect(document.getElementById('generateBtn').disabled).toBe(false);
    expect(document.getElementById('generateBtn').textContent).toBe('Write next page');
  });
});

describe('Page display and navigation', () => {
  let fw;

  beforeEach(async () => {
    mockFetch();
    fw = await loadScript();
  });

  it('shows a placeholder when no story is selected', async () => {
    fw.resetStoryReader();
    const content = document.getElementById('storyContent');
    expect(content.querySelector('.placeholder')).toBeTruthy();
    expect(document.getElementById('prevPageBtn').disabled).toBe(true);
    expect(document.getElementById('nextPageBtn').disabled).toBe(true);
    expect(document.getElementById('retryBtn').disabled).toBe(true);
  });

  it('renders page text safely via textContent and updates the indicator', async () => {
    const evil = '<img src=x onerror="window.pwned=1"> Page text.';
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 2 },
      storyPages: [
        { page_number: 1, content: evil, user_input: 'direction one' },
        { page_number: 2, content: 'Second page.', user_input: null },
      ],
      currentPage: 1,
    });
    fw.displayCurrentPage();

    const content = document.getElementById('storyContent');
    expect(content.textContent).toContain('Page text.');
    expect(content.querySelector('img')).toBeNull(); // XSS payload not parsed as HTML
    expect(window.pwned).toBeUndefined();
    expect(content.querySelector('.page-direction').textContent).toContain('direction one');

    expect(document.getElementById('pageIndicator').textContent).toBe('Page 1 of 2');
    expect(document.getElementById('prevPageBtn').disabled).toBe(true);
    expect(document.getElementById('nextPageBtn').disabled).toBe(false);
    expect(document.getElementById('retryBtn').disabled).toBe(true); // not on last page

    fw.navigatePage(1);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 2 of 2');
    expect(document.getElementById('retryBtn').disabled).toBe(false); // on last page now
    expect(document.getElementById('nextPageBtn').disabled).toBe(true);
    // The hash follows the reader
    expect(window.location.hash).toBe('#/write/s1/page/2');
  });
});
