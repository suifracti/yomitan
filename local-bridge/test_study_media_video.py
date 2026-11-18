import base64
import io
import json
import pathlib
import struct
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from study_settings import YomitanLibrary

WEBM = b'\x1aE\xdf\xa3' + b'\x00' * 64
JPEG = b'\xff\xd8\xff' + b'\x00' * 64


def asset(kind, mime, data):
    return {'kind': kind, 'mime': mime, 'data': base64.b64encode(data).decode()}


class VideoMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.vault = root / 'vault'
        self.vault.mkdir()
        config = root / 'bridge-config.json'
        config.write_text(json.dumps({'vault': str(self.vault), 'codex': '/fake/codex'}))
        self.notes = {}
        self.library = YomitanLibrary(config, anki=self.anki)
        settings = self.library.handle({'action': 'librarySettingsGet'})
        self.library.handle({'action': 'librarySettingsSave', 'settings': {**settings, 'deck': '外语', 'model': '外语语境卡'}})

    def tearDown(self):
        self.temp.cleanup()

    def anki(self, action, params):
        if action == 'deckNames': return ['外语']
        if action == 'modelNames': return ['外语语境卡']
        if action == 'modelFieldNames': return ['Word', 'Sentence', 'Definition', 'Source', 'URL', 'Audio', 'Image']
        if action == 'storeMediaFile': return params['filename']
        if action == 'findNotes': return []
        if action == 'addNote':
            self.notes[1] = params['note']
            return 1
        if action == 'notesInfo': return [{'noteId': 1, 'fields': {k: {'value': v} for k, v in self.notes[1]['fields'].items()}, 'cards': [10]}]
        if action == 'cardsInfo': return [{'cardId': 10, 'deckName': '外语'}]
        return []

    def test_sentence_clip_is_saved_embedded_and_played_from_the_audio_field(self):
        entry = {'word': 'brick', 'sentence': 'A brick wall.', 'meaning': '砖', 'url': 'https://www.youtube.com/watch?v=abcdefghijk', 'videoTime': 12}
        saved = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        record = saved['items'][0] if 'items' in saved else saved
        row = self.library.handle({'action': 'libraryMedia', 'id': record['id'], 'version': record['version'], 'start': 12, 'end': 15, 'origin': 'capture',
                                   'assets': [asset('audio', 'audio/webm', WEBM + b'a'), asset('image', 'image/jpeg', JPEG), asset('video', 'video/webm', WEBM + b'v')]})
        row = row['items'][0] if 'items' in row else row
        self.assertEqual(set(row['media']), {'audio', 'image', 'video'})
        body = next(self.vault.rglob('*brick*.md')).read_text()
        self.assertIn('场景媒体 · 视频片段', body)
        self.assertIn('视频位置：[0:12](https://www.youtube.com/watch?v=abcdefghijk&t=12s)', body)
        self.assertIn('![[' + row['media']['video']['name'] + ']]', body)
        self.library.handle({'action': 'libraryCardsAdd', 'id': record['id'], 'cards': [{'front': '听原声', 'back': 'A brick wall.', 'kind': 'listening'}]})
        fields = self.notes[1]['fields']
        self.assertEqual(fields['Audio'], '[sound:' + row['media']['video']['name'] + ']')
        self.assertIn(row['media']['image']['name'], fields['Image'])

    def test_reads_only_the_saved_original_audio_of_this_record_over_the_native_port(self):
        from study_translator import ORIGIN, main, write_frame

        source = {'word': 'just', 'url': 'https://example.test/video'}
        first = self.library.handle({'action': 'librarySave', 'makeCard': False,
                                     'entry': {**source, 'sentence': 'This just happened.', 'videoTime': 12}})
        other = self.library.handle({'action': 'librarySave', 'makeCard': False,
                                     'entry': {**source, 'sentence': 'This just happened.', 'videoTime': 30}})
        audio = WEBM + b'a' * 720000
        row = self.library.handle({'action': 'libraryMedia', 'id': first['id'], 'version': first['version'],
                                   'start': 12, 'end': 15, 'origin': 'capture',
                                   'assets': [asset('audio', 'audio/webm', audio), asset('video', 'video/webm', WEBM + b'different')]})
        p = self.vault / row['media']['audio']['name']
        before = [(file, file.stat().st_mtime_ns) for file in self.vault.rglob('*') if file.is_file()]

        def request(ident):
            source, destination = io.BytesIO(), io.BytesIO()
            write_frame(source, {'action': 'libraryAudioRead', 'id': ident})
            source.seek(0)
            with patch('study_settings.YomitanLibrary', return_value=self.library), patch('study_health.record_error'), \
                    patch('sys.argv', ['bridge', ORIGIN]), patch('sys.stdin', SimpleNamespace(buffer=source)), \
                    patch('sys.stdout', SimpleNamespace(buffer=destination)):
                main()
            destination.seek(0)
            replies = []
            while header := destination.read(4):
                size = struct.unpack('=I', header)[0]
                self.assertLessEqual(size, 900000)
                replies.append(json.loads(destination.read(size)))
            return replies

        with patch.object(self.library, 'anki', side_effect=AssertionError('readback must not contact Anki')):
            replies = request(first['id'])
            self.assertTrue(replies[0]['ok'], replies[0])
            self.assertGreater(len(replies), 1)
            self.assertTrue(all(frame['more'] for frame in replies[:-1]))
            self.assertNotIn('more', replies[-1])
            self.assertEqual(replies[-1]['library']['mime'], 'audio/webm')
            self.assertEqual(base64.b64decode(''.join(part for frame in replies for part in frame['library']['parts'])), audio)
            self.assertFalse(request(other['id'])[0]['ok'])
            self.assertEqual([(file, file.stat().st_mtime_ns) for file in self.vault.rglob('*') if file.is_file()], before)
            p.write_bytes(audio + b'changed')
            self.assertFalse(request(first['id'])[0]['ok'])

    def test_editing_a_sentence_never_plays_or_cards_the_old_audio(self):
        entry = {'word': 'brick', 'sentence': 'There is a brick wall.', 'url': 'https://example.test/video', 'videoTime': 12}
        first = self.library.handle({'action': 'librarySave', 'makeCard': False, 'entry': entry})
        attach = {'action': 'libraryMedia', 'id': first['id'], 'start': 12, 'end': 15, 'origin': 'capture'}
        old = self.library.handle({**attach, 'version': first['version'],
                                   'assets': [asset('audio', 'audio/webm', WEBM+b'old'), asset('video', 'video/webm', WEBM+b'video')]})
        old_file = self.vault / old['media']['audio']['name']
        changed = self.library.handle({'action': 'libraryUpdate', 'id': first['id'], 'entry': {'sentence': 'I picked up a brick.'}})
        play = {'action': 'libraryAudioRead', 'id': first['id']}
        create = {'action': 'libraryCardsAdd', 'id': first['id'],
                  'cards': [{'front': '听本句的 brick', 'back': '砖', 'kind': 'listening'}]}

        with self.assertRaisesRegex(ValueError, '原句或来源'):
            self.library.handle(play)
        with self.assertRaisesRegex(ValueError, '原句或来源'):
            self.library.handle(create)
        self.assertEqual(self.notes, {})
        self.assertEqual(old_file.read_bytes(), WEBM+b'old')
        page = self.library.handle({'action': 'libraryList', 'scope': 'all'})
        self.assertTrue(page['items'][0]['audioContextChanged'])

        new = self.library.handle({**attach, 'version': changed['version'], 'assets': [asset('audio', 'audio/webm', WEBM+b'new')]})
        self.assertEqual(base64.b64decode(''.join(self.library.handle(play)['parts'])), WEBM+b'new')
        self.library.handle(create)
        self.assertEqual(self.notes[1]['fields']['Audio'], '[sound:' + new['media']['audio']['name'] + ']')
        self.assertEqual(old_file.read_bytes(), WEBM+b'old')

    def test_video_words_list_only_this_video_in_time_order(self):
        for word, url, t in [('wall', 'https://www.youtube.com/watch?v=abcdefghijk', 40), ('brick', 'https://youtu.be/abcdefghijk', 12), ('other', 'https://www.youtube.com/watch?v=zzzzzzzzzzz', 5)]:
            self.library.handle({'action': 'librarySave', 'entry': {'word': word, 'sentence': f'A {word} here.', 'meaning': '义', 'url': url, 'videoTime': t}, 'makeCard': False})
        rows = self.library.handle({'action': 'libraryVideoWords', 'videoId': 'abcdefghijk'})['items']
        self.assertEqual([(r['word'], r['videoTime']) for r in rows], [('brick', 12), ('wall', 40)])
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoWords', 'videoId': '../etc'})

    def test_video_words_on_other_sites_use_the_media_key(self):
        for word, url, t in [('ring', 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm=abc', 30),
                             ('chime', 'https://m.bilibili.com/video/BV1xx411c7mD?p=2&t=12', 12),
                             ('bell', 'https://www.bilibili.com/video/BV1xx411c7mD?p=1', 4),
                             ('lamp', 'https://course.example.org/watch?id=7&utm=x', 9)]:
            self.library.handle({'action': 'librarySave', 'entry': {'word': word, 'sentence': f'A {word} here.', 'meaning': '义', 'url': url, 'videoTime': t}, 'makeCard': False})
        rows = self.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'web:www.bilibili.com/video/BV1xx411c7mD?p=2'})['items']
        self.assertEqual([r['word'] for r in rows], ['ring'])
        source = {'action': 'libraryVideoWords', 'mediaKey': 'web:www.bilibili.com/video/BV1xx411c7mD?p=2',
                  'sourceUrl': 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'}
        self.library.handle({'action': 'librarySave', 'entry': {'word': 'untimed', 'sentence': 'This note has no timestamp.',
                             'url': 'https://m.bilibili.com/video/BV1xx411c7mD?p=2'}, 'makeCard': False})
        grouped = self.library.handle(source)['items']
        listed = self.library.handle({'action': 'libraryList', 'scope': 'source', 'url': source['sourceUrl'], 'title': ''})['items']
        self.assertEqual([r['word'] for r in grouped], ['chime', 'ring', 'untimed'])
        self.assertEqual({r['id'] for r in grouped}, {r['id'] for r in listed})
        summary = self.library.handle({'action': 'libraryVideoSummary', 'mediaKey': source['mediaKey'],
                                       'url': source['sourceUrl'], 'title': 'Temporary second part'})
        summary_text = (self.vault / summary['path']).read_text()
        self.assertIn('记住了 3 个词', summary_text)
        self.assertNotIn('**bell**', summary_text)
        with self.assertRaises(ValueError):
            self.library.handle({**source, 'sourceUrl': source['sourceUrl'].replace('p=2', 'p=1')})
        rows = self.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'web:course.example.org/watch?id=7'})['items']
        self.assertEqual([r['word'] for r in rows], ['lamp'])
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'file:/etc/passwd'})

    def test_time_links_only_add_t_where_sites_understand_it(self):
        from study_library_core import time_link
        url = 'https://www.youtube.com/watch?v=abcdefghijk&t=83s'
        row = self.library.handle({'action': 'librarySave', 'entry': {
            'word': 'brick', 'sentence': 'A brick wall.', 'title': 'Building', 'url': url}, 'makeCard': False})
        self.assertIn(f'来源：[Building]({url})', (self.vault / row['path']).read_text())
        self.assertEqual(time_link('https://www.youtube.com/watch?v=abcdefghijk', 72), '[1:12](https://www.youtube.com/watch?v=abcdefghijk&t=72s)')
        self.assertEqual(time_link('https://www.bilibili.com/video/BV1xx411c7mD?p=2', 72), '[1:12](https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=72)')
        self.assertEqual(time_link('https://course.example.org/watch?id=7#chapter-2', 72), '[1:12](https://course.example.org/watch?id=7#chapter-2)')

    def test_study_summary_goes_into_one_marked_block_of_the_video_note(self):
        url = 'https://www.youtube.com/watch?v=abcdefghijk'
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoSummary', 'mediaKey': 'youtube:abcdefghijk', 'url': url, 'title': 'Bricks'})
        for word, t in [('wall', 40), ('brick', 12)]:
            self.library.handle({'action': 'librarySave', 'entry': {'word': word, 'sentence': f'A {word} | here.', 'meaning': '义', 'url': url, 'videoTime': t}, 'makeCard': False})
        # The page cannot ask for another video's summary.
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoSummary', 'mediaKey': 'youtube:zzzzzzzzzzz', 'url': url, 'title': 'Bricks'})
        first = self.library.handle({'action': 'libraryVideoSummary', 'mediaKey': 'youtube:abcdefghijk', 'url': url + '&t=5s', 'title': 'Bricks: a / story'})
        note = self.vault / first['path']
        self.assertTrue(first['path'].startswith('02-个人与生活/阅读与观影/观影/视频记录/Bricks- a - story--'))
        body = note.read_text()
        self.assertIn('来源：[打开视频](https://www.youtube.com/watch?v=abcdefghijk)', body)
        self.assertIn('记住了 2 个词', body)
        self.assertLess(body.index('**brick**'), body.index('**wall**'))
        self.assertIn('[0:12](https://www.youtube.com/watch?v=abcdefghijk&t=12s) **brick** · 只记了笔记 · [[', body)
        # The learner's own writing around the block survives a refresh.
        note.write_text(body.replace('来源：', '我的看法：好视频。\n\n来源：') + '\n## 我的笔记\n\n自己写的。\n')
        self.library.handle({'action': 'librarySave', 'entry': {'word': 'mortar', 'sentence': 'Mortar.', 'meaning': '灰浆', 'url': url, 'videoTime': 50}, 'makeCard': False})
        again = self.library.handle({'action': 'libraryVideoSummary', 'mediaKey': 'youtube:abcdefghijk', 'url': url, 'title': 'Other title'})
        self.assertEqual(again['path'], first['path'])
        body = note.read_text()
        self.assertEqual(body.count('<!-- study-video-summary:start -->'), 1)
        self.assertIn('记住了 3 个词', body)
        self.assertIn('我的看法：好视频。', body)
        self.assertIn('自己写的。', body)
        # A broken marker stops the write instead of guessing.
        note.write_text(body.replace('<!-- study-video-summary:end -->', ''))
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoSummary', 'mediaKey': 'youtube:abcdefghijk', 'url': url, 'title': 'Bricks'})
        # Saving a word now links the video note that the summary created.
        record = self.library.handle({'action': 'librarySave', 'entry': {'word': 'lintel', 'sentence': 'A lintel.', 'meaning': '过梁', 'url': url, 'videoTime': 60}, 'makeCard': False})
        record = record['items'][0] if 'items' in record else record
        self.assertIn('视频材料与完整字幕', (self.vault / record['path']).read_text())

    def test_video_over_eight_megabytes_is_refused(self):
        entry = {'word': 'wall', 'sentence': 'A wall.', 'meaning': '墙', 'url': 'https://www.youtube.com/watch?v=abcdefghijk', 'videoTime': 1}
        saved = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        record = saved['items'][0] if 'items' in saved else saved
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryMedia', 'id': record['id'], 'version': record['version'], 'start': 1, 'end': 2, 'origin': 'capture',
                                 'assets': [asset('video', 'video/webm', WEBM + b'\x00' * 8_000_001)]})


if __name__ == '__main__':
    unittest.main()
