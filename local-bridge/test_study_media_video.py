import base64
import json
import pathlib
import tempfile
import unittest

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

    def test_video_words_list_only_this_video_in_time_order(self):
        for word, url, t in [('wall', 'https://www.youtube.com/watch?v=abcdefghijk', 40), ('brick', 'https://youtu.be/abcdefghijk', 12), ('other', 'https://www.youtube.com/watch?v=zzzzzzzzzzz', 5)]:
            self.library.handle({'action': 'librarySave', 'entry': {'word': word, 'sentence': f'A {word} here.', 'meaning': '义', 'url': url, 'videoTime': t}, 'makeCard': False})
        rows = self.library.handle({'action': 'libraryVideoWords', 'videoId': 'abcdefghijk'})['items']
        self.assertEqual([(r['word'], r['videoTime']) for r in rows], [('brick', 12), ('wall', 40)])
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoWords', 'videoId': '../etc'})

    def test_video_words_on_other_sites_use_the_media_key(self):
        for word, url, t in [('ring', 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm=abc', 30), ('bell', 'https://www.bilibili.com/video/BV1xx411c7mD?p=1', 4), ('lamp', 'https://course.example.org/watch?id=7&utm=x', 9)]:
            self.library.handle({'action': 'librarySave', 'entry': {'word': word, 'sentence': f'A {word} here.', 'meaning': '义', 'url': url, 'videoTime': t}, 'makeCard': False})
        rows = self.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'web:www.bilibili.com/video/BV1xx411c7mD?p=2'})['items']
        self.assertEqual([r['word'] for r in rows], ['ring'])
        rows = self.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'web:course.example.org/watch?id=7'})['items']
        self.assertEqual([r['word'] for r in rows], ['lamp'])
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryVideoWords', 'mediaKey': 'file:/etc/passwd'})

    def test_time_links_only_add_t_where_sites_understand_it(self):
        from study_library_core import time_link
        self.assertEqual(time_link('https://www.youtube.com/watch?v=abcdefghijk', 72), '[1:12](https://www.youtube.com/watch?v=abcdefghijk&t=72s)')
        self.assertEqual(time_link('https://www.bilibili.com/video/BV1xx411c7mD?p=2', 72), '[1:12](https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=72)')
        self.assertEqual(time_link('https://course.example.org/watch?id=7#frag', 72), '[1:12](https://course.example.org/watch?id=7)')

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
