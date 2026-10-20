// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {test, expect} from 'vitest';
test('settings and library have only a small link to each other; resume search remains available', () => {
    document.body.innerHTML = readFileSync(`${import.meta.dirname}/../ext/settings.html`, 'utf8');
    expect(document.querySelector('.settings-page-title a').getAttribute('href')).toBe('/study-library.html');
    expect(document.querySelector('.settings-product-nav')).toBeNull();
    document.body.innerHTML = readFileSync(`${import.meta.dirname}/../ext/study-library.html`, 'utf8');
    expect(document.querySelector('header a').textContent).toBe('设置 ↗');
    expect(document.querySelector('a[href="/search.html"]')).toBeNull();
    expect(readFileSync(`${import.meta.dirname}/../ext/search.html`, 'utf8')).toContain('search-textbox');
});
