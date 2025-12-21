// import puppeteer from 'puppeteer';
// import { parsePage } from "../parser/parser";
const puppeteer = require('puppeteer')
const parsePage = require('./parser')

module.exports = {
  async run(params) {
    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    // const url  = 'https://translate.google.com/'
    const url = 'https://google-translate.ours.day/'
    console.log('🚀 ~ url >>>', url)

    await page.goto(url, {
      waitUntil: 'networkidle2',
    })

    const res = await parsePage.googleParsePage(url, page, {
      text: params.text,
      from: params.from,
      to: params.to,
      lite: false,
    })
    // console.log("🚀 ~ file: pagepoolTest.ts:18 ~ res >>>", res)
    const response = {
      result: res.result,
      pronunciation: res.pronunciation,
      from: {
        // iso: res.fromISO,
        pronunciation: res.fromPronunciation,
        didYouMean: res.fromDidYouMean,
        suggestions: res.fromSuggestions,
      },
      definitions: res.definitions,
      examples: res.examples,
      translations: res.translations,
    }

    try {
      const btnSelector = 'button[aria-label="Reject all"]'
      await page.waitForSelector(btnSelector, { timeout: 1000 })
      await page.$eval(btnSelector, (btn) => {
        btn.click()
      })
      console.log('rejected privacy consent')
    }
    catch {
      console.log('no privacy consent')
    }

    await browser.close()
    console.log('🚀 ~ file: pagepoolTest.ts:35 ~ response >>>', response)

    return response
  }
  ,
}
