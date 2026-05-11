// const azureService = require('./azure')
const EdgeService = require('./edge')

async function getTTSData(
  Format,
  SSML,
) {
  const result = await new EdgeService().convert(SSML, Format)
  return result
}

exports.getTTSData = getTTSData
