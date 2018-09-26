#!/usr/bin/env node

//console.log('I\'m not over here!')

/*
   This is a command-line tool for converting CrowdAnki-JSON-style data to
   much simpler LLab style JSON.
   Adds fingerprint id and stemmed word field based on language.

   To use, point to a folder containing an anki scraped .json file
   > ankiscrape <ankidir>
   // outputs to new directory llab_<ankidir>
*/

const shell = require("shelljs")
const program = require('commander')
const path = require("path");
const fs = require('fs-extra')
const json = require('jsonfile')
const hash = require('hash.js')
const trim = require('trim-character')
const  { transliterate, slugify } = require('transliteration')
const stringSimilarity = require('string-similarity')
const metaphone = require('metaphone')

// stemmers
var natural = require('natural')
var snowball = require('node-snowball');



var deckFolder = 'media/'
var deckFile = 'source.json'
var fullDeckPath = ''
var outputFolder = 'output/'
const MAX_WORDS = 5


program
  .version('0.0.2')
  .arguments('<folderPath> <langCode>')
  // .option('-i, --import', 'Import Deck to Corpus')
  // .option('-d, --deck <folderpath>', "Path to CrowdAnki export folder containing a JSON file and a folder of assets.")
  .action((folderPath, langCode) => {
    console.log('Ankiscraper', '0.0.3')
    if (!langCode || langCode.length>2) {
      console.error('Language code should be two characters')
      process.exit(1)
    }
    let error = false
    deckFolder = path.resolve((folderPath || __dirname).trim('/'))
    deckFile = getFirstJsonFile(deckFolder)
    if (!deckFile || !fs.existsSync(deckFolder+'/'+deckFile)) {
      console.error('No anki JSON file found', deckFile)
      process.exit(1)
    }
    outputFolder = path.resolve(deckFolder, '..')+'/'+ deckFolder.split('/').pop()+'_llab'
      // console.log(' - deck folder', deckFolder)
      // console.log(' - deck file', deckFile)
      // console.log(' - output folder', outputFolder)
    Anki2LLab(deckFolder, deckFile, outputFolder, langCode)
  })
  .parse(process.argv)

function count_words(phrase) {
  return phrase.split(';')[0].split(',')[0].split('(')[0].split('/')[0]
   .trim().split(' ').length
}

function getFirstJsonFile(folder) {
  try {
    return fs.readdirSync(deckFolder).filter(e => path.extname(e).toLowerCase() === '.json')[0]
  } catch(err) {
    error = true
  }
}

function Anki2LLab(deckFolder, deckFile, outputFolder, langCode) {

  // utilities
  var _hash = (str) => hash.sha256().update(str).digest('hex')
  fullDeckPath = deckFolder + '/' + deckFile
  var wordcount=0, phrasecount=0, highest_difficulty=0
  // load js file
  var dli = json.readFileSync(fullDeckPath)

  // parse out the part we need
  var items = dli.notes.map((note, num) => {
    //console.log(langCode)
    let en, l1, audio1, difficulty
    if (langCode==='ar') {
      en = note.fields[1]
      l1 = note.fields[0]
      audio1 = note.fields.length>2 ? note.fields[2] : ''
      difficulty = num
    } else if (langCode==='fa') {
      en = note.fields[0]
      l1 = note.fields[1]
      audio1 = note.fields.length>3 ? note.fields[3] : ''
      difficulty = note.fields.length>4 ? note.fields[4] : num
    } else if (langCode==='fr') {
      l1 = note.fields[1]
      en = note.fields[2]
      audio1 = note.fields.length>5 ? note.fields[5] : ''
      difficulty = note.fields.length>0 ? note.fields[0] : num
    } else if (langCode==='es') {
      en = note.fields[2]
      l1 = note.fields[0]
      audio1 = note.fields.length>3 ? note.fields[3] : ''
      difficulty = note.fields.length>4 ? note.fields[4] : num
    }

    en = trim(en, '.').trim().split(';')[0].replace('&nbsp;', ' ').split(',')[0].split('/')[0].split('(')[0]
    en = en.replace('<div>', '').replace('<div>', '').replace('</div>', '').replace('</div>', '')
    // remove pos
    en = en.replace(/\(.*?\)/g, '')
    en = en.split(' ').map(w => w.trim()).filter(w => w.length).join(' ')
      if (en.substr(-1)==='.') en = en.slice(0, -1)
    en = en.trim()
    l1 = trim(l1, '.').trim().split(';')[0].replace('&nbsp;', ' ').split(',')[0].split('/')[0].split('(')[0]
    l1 = l1.replace('<div>', '').replace('<div>', '').replace('</div>', '').replace('</div>', '')
    l1 = l1.replace(/\(.*?\)/g, '')
    l1 = l1.split(' ').map(w => w.trim()).filter(w => w.length).join(' ')
      if (l1[l1.length-1]==='.')  l1 = l1.slice(0, -1)
      if (l1[0]==='.') l1 = l1.substr(1)
    l1 = l1.trim()
    audio1 = trim(trim(trim(audio1,"]"),"["),'sound:').trim()
    //console.log(audio1)

    // difficulty calculation
    if (!isNaN(difficulty)) difficulty = num;
    let wordscount = count_words(l1)
    if (wordscount>1) difficulty += 1000 + (100 * wordscount)
    // adjust difficulty based on similarity, returns 0-1 based on similarity
    // we want to reduce difficulty to 0 if identical (1)
    let l1m = slugify(stemmer(l1, langCode))
    let l2m = slugify(stemmer(en, 'en')).replace('to-', '').replace('the-', '').replace('a-', '').trim()
    let similarity = stringSimilarity.compareTwoStrings( metaphone(l1m), metaphone(l2m))
    // now subtract from difficulty the rate of similarity
    let newDifficulty = difficulty - (difficulty * similarity)
    console.log(l1m, l2m, `(${Math.round(similarity * 100)}%) `, difficulty, '->', newDifficulty)
    difficulty = newDifficulty
    similarity = Math.round(similarity * 100)

    let isNum = en.match(/^[0-9]+$/m)

    if ( wordscount>1) phrasecount++; else wordcount++

    let isQ = en.indexOf('?')>-1

    let strip = function(str) {
      return str.replace(/\!\?\:\)\(\.\"/g, '').toLowerCase().trim()
    }
    let id = `${langCode}_${_hash('lang_flashcard'+strip(en+l1)).slice(0,8)}`

    if (difficulty > highest_difficulty) highest_difficulty = difficulty

    if (wordscount<=MAX_WORDS) return {
      id: id,
      lang: langCode,
      l1: l1,
      l2: en,
      audio1,
      difficulty,
      wcount: wordscount,
      len: l1.length+en.length,
      isQ,
      isNum,
      similarity
    }
  }).filter(card => card && card.l1.length && card.l2.length && card.audio1)

  console.log('Processing ', items.length, 'cards')


  // organize into lists by word length
  //
  var completedcards = []
  var difficulty_ratio = 0

  for (i=1; i<=MAX_WORDS; i++) {
    var list = items.filter(card => card.wcount===i).sort((a,b) => a.difficulty-b.difficulty)

    // for each card gather up best wrong answers
    list.forEach(card => {
      let result = {
        id: card.id,
        lang:  card.lang,
        l1: card.l1,
        l2: card.l2,
        audio1: card.audio1,
        difficulty: (card.difficulty/highest_difficulty*70+10).toFixed(2),
        wcount: card.wcount,
        stem: stemmer(card.l1, card.lang),
        similar: card.similarity
      }
      // try to
      let options = list.filter(c => c.id!=card.id)
      let match = list.filter(c => (c.isQ === card.isQ))
      // sort by length difference
      let matches = match.sort((a,b) => Math.abs(card.len-a.len)-Math.abs(card.len-b.len) )
        .filter(c =>!(c.isNum || c.l1==card.l1 || c.l2===card.l2))
        .slice(0,20)
      let i1 = matches.map(c => c.l1)
      let i2 = matches.map(c => c.l2)
      result.i2 = i2.join(',')
      result.i1 = i1.join(',')
      if (i2.length>3) completedcards.push(result)
    })
  }
  completedcards = completedcards.sort((a,b) => a.difficulty-b.difficulty)


  // output JSON
  // make sure output folder exists
  fs.mkdirp(outputFolder)
  // copy and rename audio files
  completedcards.forEach((card,index) => {
    let l2 = []
    card.l2.split(';')[0].split(',')[0].split('(')[0].split('/')[0].trim().split(' ').map(w=> {
    // card.l2.substr(0,30).split('/')[0].split(' ').map(w => {
      if (l2.length<10 || l2.length + w.length <30) l2.push(w)
    })
    card.id = card.id.substr(0,7) +'_'+
      slugify(l2.join('-')).replace('to-', '').replace('the-', '').replace('a-', '').trim()
    fs.copyFileSync(deckFolder +'/media/'+ card.audio1, outputFolder+'/'+card.id+ path.extname(card.audio1) )
    delete card.audio1
  })
  // save new json
  var outputfile = outputFolder+'/deck.json'
  json.writeFileSync(outputfile, completedcards, {spaces: 2, EOL: '\r\n'})
  //

}

// function slug(id, phrase, ext) {
//   return card.id+'_'+ slugify(card.l2.substr(0,20))+ path.extname(card.audio1)
// }


function stemmer(word, lang) {
  word = word.split(';')[0].split(',')[0].split('(')[0].split('/')[0].trim()
  if (!word.length) return ''
  if (lang==='fa') {
    var tokenizer = new natural.AggressiveTokenizerFa()
    return tokenizer.tokenize(word).join(',')
  } if (lang==='fr') {
    var tokenizer = new natural.AggressiveTokenizerFr()
    return tokenizer.tokenize(word).join(',')
  } if (lang==='es') {
    var tokenizer = new natural.AggressiveTokenizerEs()
    return tokenizer.tokenize(word).join(',')
  } if (lang==='it') {
    var tokenizer = new natural.AggressiveTokenizerIt()
    return tokenizer.tokenize(word).join(',')
  } if (lang==='ar') {
    word = word.split(' ')
    return snowball.stemword(word, 'arabic').join(' ')
  } if (lang==='en') {
    word = word.split(' ')
    return snowball.stemword(word, 'en').join(' ')
  }
}



