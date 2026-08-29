'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

describe('UI navigation', () => {
  let fw;

  beforeEach(() => {
    mockFetch(); // loads on init return empty objects - fine for nav
    fw = loadScript();
  });

  it('starts on the worlds section', () => {
    expect(document.getElementById('worldsSection').classList.contains('active')).toBe(true);
    expect(document.getElementById('worldsBtn').classList.contains('active')).toBe(true);
  });

  it('switches sections exclusively when nav buttons are clicked', () => {
    const sections = ['worlds', 'characters', 'stories', 'write'];

    for (const section of sections) {
      document.getElementById(`${section}Btn`).click();

      for (const other of sections) {
        expect(document.getElementById(`${other}Section`).classList.contains('active')).toBe(other === section);
        expect(document.getElementById(`${other}Btn`).classList.contains('active')).toBe(other === section);
      }
    }
  });

  it('reverts to worlds via the exported showSection', () => {
    document.getElementById('writeBtn').click();
    fw.showSection('worlds');
    expect(document.getElementById('worldsSection').classList.contains('active')).toBe(true);
  });
});

describe('Age gate', () => {
  it('shows once and hides on acceptance', () => {
    window.localStorage.clear();
    mockFetch();
    loadScript();

    const gate = document.getElementById('ageGate');
    expect(gate.hidden).toBe(false);

    document.getElementById('ageGateAccept').click();
    expect(gate.hidden).toBe(true);
    expect(window.localStorage.getItem('fw-age-ok')).toBe('1');

    // second load: stays hidden
    loadScript();
    expect(document.getElementById('ageGate').hidden).toBe(true);
  });
});

describe('Generation loading state', () => {
  let fw;

  beforeEach(() => {
    mockFetch();
    fw = loadScript();
  });

  it('disables buttons and animates scribe flavor while generating', () => {
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
    expect(document.getElementById('generateBtn').textContent).toBe('Generate Page');
  });
});

describe('Page display and navigation', () => {
  let fw;

  beforeEach(() => {
    mockFetch();
    fw = loadScript();
  });

  it('shows a placeholder when no story is selected', () => {
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
  });
});