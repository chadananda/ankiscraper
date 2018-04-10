#!/usr/bin/env node

const shell = require("shelljs")
const program = require('commander')
const path = require("path");
const fs = require('fs-extra')
const json = require('jsonfile')
const hash = require('hash.js')
const trim = require('trim-character')

var deckFolder = 'media/'
var sourceFile = 'source.json'
var outputFolder = 'output/'
const MAX_WORDS = 6


program
  .version('0.0.1')
  .option('-i, --import', 'Import Deck to Corpus')
  .option('-d, --deck <folderpath>', "Path to anki export folder. Anki JSON should be named anki.json")
  .parse(process.argv)

  program.deck = (program.deck || __dirname).trim('/')
  sourceFile = program.deck + '/anki.json'
  outputFolder = path.resolve(program.deck, '..')+'/'+ program.deck.split('/').pop()+'_output'

if (!fs.existsSync(sourceFile)) {
  console.error('Anki import JSON should be named "anki.json" and be inside the source folder: \n   ', sourceFile)
  process.exit(1)
}

// make sure output folder exists
fs.mkdirp(outputFolder)


// utilities
var _hash = (str) => hash.sha256().update(str).digest('hex')

var wordcount=0, phrasecount=0, highest_difficulty=0
// load js file
var dli = json.readFileSync(sourceFile)
// parse out the part we need
var items = dli.notes.map(note => {
  let en = trim(note.fields[0], '.').trim()
    en = en.split(' ').map(w => w.trim()).filter(w => w.length).join(' ')
  let fa = trim(note.fields[1], '.').trim()
    fa = fa.split(' ').map(w => w.trim()).filter(w => w.length).join(' ')
  let fa_file = trim(trim(trim(note.fields[3],"]"),"["),'sound:').trim()

  let isNum = en.match(/^[0-9]+$/m)
  let words = fa.split(' ')
  let wordscount = words.length
  let type = wordscount>1 ? 'phrase' : 'word'
  let difficulty = parseInt(note.fields[4].trim(),10) * wordscount

  let decknum = note.fields[5].replace(/^([0-9]+)?\-.*?$/m, '$1')
  if (type==='phrase') phrasecount++; else wordcount++

  let isQ = en.indexOf('?')>-1

  let strip = function(str) {
    return str.replace(/\!\?\:\)\(\.\"/g, '').toLowerCase().trim()
  }
  let id = _hash('lang_flashcard'+strip(en+fa)).slice(0,10)

  if (difficulty > highest_difficulty) highest_difficulty = difficulty

  if (words.length<=MAX_WORDS) return {
    en: en,
    fa: fa,
    audio_fa: fa_file,
    difficulty: difficulty,
    deck: decknum,
    type: type,
    words: fa.split(' ') ,
    isQ: isQ,
    id: id,
    wcount: wordscount,
    len: fa.length+en.length,
    isNum: isNum
  }
}).filter(card => card)

// organize into lists by word length
//

var completedcards = []
var difficulty_ratio = 0

for (i=1; i<=MAX_WORDS; i++) {
  var list = items.filter(card => card.wcount===i).sort((a,b) => a.difficulty-b.difficulty)

  // for each card gather up best wrong answers
  list.forEach(card => {
    let result = {
      id: card.id, type: 'lang_vocab', difficulty: (card.difficulty/highest_difficulty*70+10).toFixed(2),
      wordcount: card.wcount, isPhrase: card.type==='phrase',
      content: {
        lang:  ["en","fa"],
        words: [card.en, card.fa],
        description: "Translate to or from Farsi",
      },
      files: {
        aud: ['', card.audio_fa]
      }
    }
    // try to
    let options = list.filter(c => c.id!=card.id)
    let match = list.filter(c => (c.isQ === card.isQ))
    // sort by length difference
    let matches = match.sort((a,b) => Math.abs(card.len-a.len)-Math.abs(card.len-b.len) )
      .filter(c =>!(c.isNum || c.en==card.en || c.fa===card.fa))
      .slice(0,20)
    result.content.incorrect = []
    result.content.incorrect[0] = matches.map(c => c.en)
    result.content.incorrect[1] = matches.map(c => c.fa)
    if (result.content.incorrect[0].length>3) completedcards.push(result)
  })
}
completedcards = completedcards.sort((a,b) => a.difficulty-b.difficulty)


// output JSON

var outputfile = outputFolder+'deck.json'

json.writeFileSync(outputfile, completedcards, {spaces: 2, EOL: '\r\n'})
completedcards.forEach(card => fs.copyFileSync(deckFolder+card.files.aud[1], outputFolder+card.files.aud[1]))



