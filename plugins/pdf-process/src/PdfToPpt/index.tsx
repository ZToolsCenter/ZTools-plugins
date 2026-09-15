import PdfConvertPage from '../components/PdfConvertPage'

export default function PdfToPpt(props: { onBack?: () => void; onOpenSettings?: () => void }) {
  return <PdfConvertPage format="ppt" {...props} />
}
