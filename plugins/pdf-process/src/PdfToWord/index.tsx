import PdfConvertPage from '../components/PdfConvertPage'

export default function PdfToWord(props: { onBack?: () => void; onOpenSettings?: () => void }) {
  return <PdfConvertPage format="word" {...props} />
}
