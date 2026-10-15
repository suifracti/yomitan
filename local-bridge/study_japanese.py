#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""User-clicked preparation only. Never changes an existing model or creates cards."""
FIELDS = ['Word', 'Expression', 'Reading', 'Question', 'Sentence', 'Definition', 'DictionaryNotes', 'Source', 'URL', 'Audio', 'Image']
MODEL = '日语语境卡'
DECK = '外语::日语语境'


def prepare(anki):
    names = anki('modelNames', {})
    if not isinstance(names, list):
        raise ValueError('Anki 笔记类型列表无效。')
    if MODEL in names:
        if anki('modelFieldNames', {'modelName': MODEL}) != FIELDS:
            raise ValueError('已有同名日语笔记类型字段不同，未覆盖；请人工核对。')
    else:
        anki('createModel', {'modelName': MODEL, 'inOrderFields': FIELDS,
                            'css': '.card {font:22px sans-serif;text-align:left;line-height:1.65;padding:20px;} .context {font-size:20px;} .detail {font-size:16px;} img{max-width:100%;} rt{font-size:0.65em;}',
                            'cardTemplates': [{'Name': '语境理解', 'Front': '{{Question}}<hr><div class="context">{{Sentence}}</div>{{Audio}}{{Image}}',
                              'Back': '{{FrontSide}}<hr id="answer"><ruby>{{Expression}}<rt>{{Reading}}</rt></ruby><div>{{Definition}}</div><details class="detail"><summary>词典形态与读音资料</summary>{{DictionaryNotes}}</details><div class="detail">{{Source}}</div>'}]})
        if anki('modelFieldNames', {'modelName': MODEL}) != FIELDS:
            raise ValueError('日语笔记类型创建后读回不同；停止继续配置。')
    decks = anki('deckNames', {})
    if not isinstance(decks, list):
        raise ValueError('Anki 牌组列表无效。')
    if DECK not in decks:
        anki('createDeck', {'deck': DECK})
    if DECK not in anki('deckNames', {}):
        raise ValueError('日语牌组未能读回。')
    return {'prepared': True, 'message': '日语空牌组与模板已准备，未创建学习卡，也未切换英语配置。'}
