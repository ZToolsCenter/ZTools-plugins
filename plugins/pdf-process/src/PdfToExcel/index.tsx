import PdfConvertPage from '../components/PdfConvertPage'

export default function PdfToExcel(props: { onBack?: () => void; onOpenSettings?: () => void }) {
  return <PdfConvertPage format="excel" {...props} />
}
