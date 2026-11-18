#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Source identity and links; the site/key tables also ship with the browser."""
import re
import urllib.parse

YOUTUBE_HOSTS = ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be')
BILIBILI_HOST = 'bilibili.com'
FILE_DURATION_KEY = 'study-duration'
VIDEO_QUERY_KEYS = ('v', 'p', 'id', 'vid', 'ep', 'episode', 'video', 'list', 'index')


def media_key_of(url):
    """Stable reader/index key, not a note ID or a source link."""
    try:
        parsed = urllib.parse.urlsplit(url or '')
    except ValueError:
        return ''
    if parsed.scheme == 'file':
        duration = urllib.parse.parse_qs(parsed.fragment).get(FILE_DURATION_KEY, [''])[0]
        return 'file:' + urllib.parse.unquote(parsed.path.rsplit('/', 1)[-1]) + '|' + duration if duration.isdigit() else ''
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return ''
    host = parsed.hostname.lower()
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    if host in YOUTUBE_HOSTS:
        if host == 'youtu.be':
            video = parsed.path[1:12]
        elif parsed.path.startswith(('/shorts/', '/embed/')):
            video = (parsed.path.split('/') + [''])[2]
        else:
            video = query.get('v', [''])[0]
        return 'youtube:' + video if re.fullmatch(r'[\w-]{11}', video or '') else ''
    picked = '&'.join(f'{key}={query[key][0]}' for key in VIDEO_QUERY_KEYS if key in query)
    path = parsed.path.rstrip('/') or '/'
    return ('web:' + host + path + ('?' + picked if picked else ''))[:400]


def time_link(url, seconds, label=None):
    """A clickable moment for notes, e.g. [36:02](https://youtu.be/…&t=2162s).
    Only YouTube and Bilibili understand t=; other pages get a plain link next to the time."""
    whole = max(0, int(seconds))
    hours, rest = divmod(whole, 3600)
    label = label or (f'{hours}:{rest // 60:02d}:{rest % 60:02d}' if hours else f'{rest // 60}:{rest % 60:02d}')
    try:
        parsed = urllib.parse.urlsplit(url or '')
    except ValueError:
        return f'{label}（{whole} 秒）'
    if parsed.scheme not in ('http', 'https'):
        return f'{label}（{whole} 秒）'
    host = (parsed.hostname or '').lower()
    if host in YOUTUBE_HOSTS:
        stamp = f'{whole}s'
    elif host == BILIBILI_HOST or host.endswith('.' + BILIBILI_HOST):
        stamp = str(whole)
    else:
        return source_link(label, url)
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True) if k != 't'] + [('t', stamp)]
    link = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query),
                                    '' if parsed.fragment.startswith('t=') else parsed.fragment))
    return source_link(label, link)


def source_link(label, url):
    # Keep parentheses in article titles from closing a Markdown link early.
    return f'[{label}]({url.replace("(", "%28").replace(")", "%29")})'


def article_href(entry):
    """An optional browser text fragment for a plain page, never its saved identity."""
    url = entry.get('url', '')
    sentence = ' '.join(entry.get('sentence', '').split())
    if 'videoTime' in entry or len(sentence) > 400 or len(sentence.split()) < 3:
        return ''
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return ''
    host = parsed.hostname or ''
    if (parsed.scheme not in ('http', 'https') or not host or parsed.fragment or
            host in YOUTUBE_HOSTS or host == BILIBILI_HOST or host.endswith('.' + BILIBILI_HOST)):
        return ''
    selected = urllib.parse.quote(sentence, safe='').replace('-', '%2D')
    return url.partition('#')[0] + '#:~:text=' + selected


def with_article_href(row):
    href = article_href(row['entry'])
    return {**row, 'articleHref': href} if href else row
