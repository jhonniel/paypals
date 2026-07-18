import { ReceiptEditor } from "@/features/receipts/receipt-editor";
import { SplitAssignPanel } from "@/features/splits/split-assign-panel";

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-8">
      <ReceiptEditor receiptId={id} />
      <SplitAssignPanel receiptId={id} />
    </div>
  );
}
