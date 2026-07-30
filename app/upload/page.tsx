import Link from "next/link";

export default function UploadPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link className="text-sm font-semibold text-[#1d4ed8] hover:underline" href="/">
          ← 今日の原価状況へ戻る
        </Link>
        <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-10">
          <p className="text-sm font-semibold tracking-[0.16em] text-[#1d4ed8]">仕入伝票の取込</p>
          <h1 className="mt-2 text-3xl font-bold">納品書・レシートを追加</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            PDFまたは写真を選ぶと、商品名・数量・単価を読み取り、確認画面へ進む予定です。
          </p>
          <div className="mt-8 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 text-center">
            <p className="font-semibold">PDF・写真を選択</p>
            <p className="mt-2 text-sm text-slate-500">複数の納品書・レシートに対応予定</p>
            <input accept=".pdf,image/*" className="mt-6 max-w-full text-sm" type="file" />
            <p className="mt-5 text-xs text-slate-500">この試作画面では、まだ保存・読取りは行いません。</p>
          </div>
        </div>
      </div>
    </main>
  );
}
