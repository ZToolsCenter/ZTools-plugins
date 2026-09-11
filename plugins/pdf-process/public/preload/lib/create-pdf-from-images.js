/**
 * Build a multi-page PDF from image files.
 * When pageSizes (PDF points) are provided, page geometry stays independent of pixel density.
 */
const fs = require('node:fs')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')

async function createPdfFromImages(imagePaths, outputPath, options = {}) {
  const pageSizes = Array.isArray(options.pageSizes) ? options.pageSizes : null
  const pdfDoc = await PDFDocument.create()
  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i]
    const imgBytes = fs.readFileSync(imgPath)
    const ext = path.extname(imgPath).toLowerCase()
    const embeddedImage =
      ext === '.jpg' || ext === '.jpeg'
        ? await pdfDoc.embedJpg(imgBytes)
        : await pdfDoc.embedPng(imgBytes)
    const px = embeddedImage.scale(1)
    const sizeHint = pageSizes && pageSizes[i]
    const pageW =
      sizeHint && Number(sizeHint.widthPt) > 0 ? Number(sizeHint.widthPt) : px.width
    const pageH =
      sizeHint && Number(sizeHint.heightPt) > 0 ? Number(sizeHint.heightPt) : px.height
    const page = pdfDoc.addPage([pageW, pageH])
    page.drawImage(embeddedImage, { x: 0, y: 0, width: pageW, height: pageH })
  }
  const pdfBytes = await pdfDoc.save({ useObjectStreams: true })
  fs.writeFileSync(outputPath, pdfBytes)
  return outputPath
}

module.exports = { createPdfFromImages }
