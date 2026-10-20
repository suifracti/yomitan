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

    def test_video_over_eight_megabytes_is_refused(self):
        entry = {'word': 'wall', 'sentence': 'A wall.', 'meaning': '墙', 'url': 'https://www.youtube.com/watch?v=abcdefghijk', 'videoTime': 1}
        saved = self.library.handle({'action': 'librarySave', 'entry': entry, 'makeCard': False})
        record = saved['items'][0] if 'items' in saved else saved
        with self.assertRaises(ValueError):
            self.library.handle({'action': 'libraryMedia', 'id': record['id'], 'version': record['version'], 'start': 1, 'end': 2, 'origin': 'capture',
                                 'assets': [asset('video', 'video/webm', WEBM + b'\x00' * 8_000_001)]})


if __name__ == '__main__':
    unittest.main()
